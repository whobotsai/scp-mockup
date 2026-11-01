// Replaces the frontend prototype's MY_SHO_POSITIONS/MY_SSO_POSITIONS/MY_CREATED_*/
// CLAIM_HISTORY mock arrays (docs/BACKEND_ROADMAP.md's Stage 2 scope) with data reconstructed
// live from the keeper's indexed trades/posts, stored snapshots, and direct contract/account
// reads. Split into two genuinely different things the mock conflated into one status field:
// "standings" (a live, mutable, still-open leaderboard position -- for display only, matches
// db.js's own leaderboard-query caveat) and "claims" (an immutable position frozen into an
// actually-posted snapshot -- the only thing a wallet can ever really claim() against).
//
// Dispatches EVM vs Solana the same way claimRoutes.js does: by what shape the :address param
// actually is (isValidSolanaAddress / ethers.isAddress), not an explicit ?network= query param
// -- the two address formats never collide, so there's nothing to disambiguate.
//
// The Solana branches were never exercised against a live program or a real Postgres instance
// with real Solana rows in it (same standing caveat as every other Solana code path in this
// project) -- only reasoned through against solanaAbis.js's decoders and the claim_receipt PDA
// seeds in contracts-solana/programs/{sho_solana,sso_solana}/src/lib.rs.
"use strict";
const express = require("express");
const { ethers } = require("ethers");
const { PublicKey } = require("@solana/web3.js");
const db = require("./db");
const { SHO_CAMPAIGN_ABI, SSO_CAMPAIGN_ABI } = require("./abis");
const solanaAbis = require("./solanaAbis");
const { netBuyVolumeForSolanaToken } = require("./solanaTraderIndexer");

function isValidSolanaAddress(address) {
  try {
    // eslint-disable-next-line no-new
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}

function rankOf(leaderboard, wallet) {
  const idx = leaderboard.findIndex((e) => e.wallet.toLowerCase() === wallet.toLowerCase());
  return idx === -1 ? null : { rank: idx + 1, score: leaderboard[idx].score };
}

// Base58 is case-sensitive (unlike an EVM hex address), so this is an exact match, not
// rankOf's lower-cased one -- see db.js's own header comment on its Solana functions for why.
function rankOfExact(leaderboard, wallet) {
  const idx = leaderboard.findIndex((e) => e.wallet === wallet);
  return idx === -1 ? null : { rank: idx + 1, score: leaderboard[idx].score };
}

// claim_receipt's PDA seeds: [CLAIM_SEED, campaign, index, claimant] -- epoch_index (SSO) is a
// u16 (2 raw bytes, LE); milestone_index (SHO) is a u8 (1 byte). Same distinction
// tests/sho.ts / tests/sso.ts's own claimReceiptPda helpers call out in contracts-solana/.
function solanaClaimReceiptPda(programId, campaign, factory, index, claimant) {
  const idxBuf = factory === "sso" ? Buffer.from([index & 0xff, (index >> 8) & 0xff]) : Buffer.from([index]);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("claim"), campaign.toBuffer(), idxBuf, claimant.toBuffer()],
    programId
  );
  return pda;
}

function decodeSolanaCampaign(factory, data) {
  return factory === "sso" ? solanaAbis.decodeSsoCampaign(data) : solanaAbis.decodeShoCampaign(data);
}

// Solana SHO has no local trades table to look up "which campaigns has this wallet traded in"
// the way tokenTradeCampaigns does for EVM (net-buy volume is computed live from Birdeye, not
// indexed -- see solanaTraderIndexer.js's own header), so this checks every known Solana SHO
// campaign's live leaderboard instead. Bounded by how many Solana SHO campaigns exist, which
// is small right now -- revisit (e.g. skip campaigns past their duration) if that stops being
// true. Returns [] outright without a Birdeye call at all when BIRDEYE_API_KEY isn't
// configured, same "stays off without it" posture shoRoutes.js's own solanaLeaderboard uses.
async function solanaShoStandings(wallet) {
  if (!process.env.BIRDEYE_API_KEY) return [];
  const campaigns = await db.solanaShoCampaigns();
  const sho = [];
  for (const row of campaigns) {
    try {
      const leaderboard = await netBuyVolumeForSolanaToken(row.token, Number(row.window_seconds), 100_000);
      const position = rankOfExact(leaderboard, wallet);
      if (position) sho.push({ campaignAddress: row.campaign_address, ...position });
    } catch (e) {
      console.error(`[walletRoutes] Solana SHO standings check failed for ${row.campaign_address}:`, e.message);
    }
  }
  return sho;
}

// sso_posts is a shared table (Solana rows go through the same db.insertSsoPost the EVM path
// uses), so solanaSocialPostCampaigns + the existing db.ssoLeaderboard (plain column equality,
// no case-folding) are both already correct for Solana -- only "which epoch is currently
// open" needs a Solana-specific read, decoding the Campaign account directly instead of an
// EVM contract call (Solana has no "view function" distinct from reading account data).
async function solanaSsoStandings(wallet, solanaConnection) {
  const campaignAddresses = await db.solanaSocialPostCampaigns(wallet);
  const sso = [];
  for (const campaignAddress of campaignAddresses) {
    try {
      const info = await solanaConnection.getAccountInfo(new PublicKey(campaignAddress));
      if (!info) continue;
      const c = solanaAbis.decodeSsoCampaign(info.data);
      const now = Math.floor(Date.now() / 1000);
      const currentEpochIndex = c.epochs.findIndex((e) => !e.finalized && now < Number(e.endsAt));
      if (currentEpochIndex === -1) continue; // no open epoch to stand in right now
      const leaderboard = await db.ssoLeaderboard(campaignAddress, currentEpochIndex, 100_000);
      const position = rankOfExact(leaderboard, wallet);
      if (position) sso.push({ campaignAddress, epochIndex: currentEpochIndex, ...position });
    } catch (e) {
      console.error(`[walletRoutes] Solana SSO standings check failed for ${campaignAddress}:`, e.message);
    }
  }
  return sso;
}

async function solanaClaims(wallet, solanaConnection) {
  const snapshots = await db.solanaSnapshotsForWallet(wallet);
  const now = Math.floor(Date.now() / 1000);
  const claims = [];
  const claimantPubkey = new PublicKey(wallet);

  for (const snap of snapshots) {
    const entry = snap.entries.find((e) => e.account === wallet);
    if (!entry) continue; // shouldn't happen given the query, but never trust it blindly

    const campaignPubkey = new PublicKey(snap.campaign_address);
    const campaignInfo = await solanaConnection.getAccountInfo(campaignPubkey);
    if (!campaignInfo) continue; // campaign account unreachable -- skip this one, not the whole response

    const c = decodeSolanaCampaign(snap.factory, campaignInfo.data);
    const period = snap.factory === "sso" ? c.epochs[snap.index] : c.milestones[snap.index];
    if (!period) continue;

    // The owning program -- read off the account itself rather than needing a
    // SHO_SOLANA_PROGRAM_ID/SSO_SOLANA_PROGRAM_ID env var here, since the campaign account
    // already carries it.
    const programId = campaignInfo.owner;
    const claimReceiptPda = solanaClaimReceiptPda(programId, campaignPubkey, snap.factory, snap.index, claimantPubkey);

    let status;
    let claimedAt = null;
    let txHash = null;
    if (now < Number(period.challengeWindowEnds)) {
      status = "challenge_window";
    } else {
      const receiptInfo = await solanaConnection.getAccountInfo(claimReceiptPda);
      if (receiptInfo) {
        status = "claimed";
        // claim_receipt is created once (init) and never touched again, so its only
        // transaction is the claim itself -- no event-log query needed the way EVM's
        // queryFilter(RewardClaimed) is.
        const sigs = await solanaConnection.getSignaturesForAddress(claimReceiptPda, { limit: 1 }).catch(() => []);
        if (sigs.length) {
          claimedAt = sigs[0].blockTime ? new Date(sigs[0].blockTime * 1000) : null;
          txHash = sigs[0].signature;
        }
      } else {
        status = "claimable";
      }
    }

    claims.push({
      factory: snap.factory,
      campaignAddress: snap.campaign_address,
      index: snap.index,
      amount: entry.amount,
      status,
      claimedAt,
      txHash,
    });
  }

  return claims;
}

async function solanaCreated(wallet, solanaConnection) {
  const rows = await db.solanaCreatedCampaigns(wallet);
  return Promise.all(
    rows.map(async (row) => {
      let totalLocked = null;
      try {
        const info = await solanaConnection.getAccountInfo(new PublicKey(row.campaign_address));
        if (info) totalLocked = decodeSolanaCampaign(row.factory, info.data).totalLocked.toString();
      } catch (e) {
        console.error(`[walletRoutes] Solana created-campaign read failed for ${row.campaign_address}:`, e.message);
      }
      return {
        id: row.campaign_address,
        factory: row.factory,
        token: row.token,
        keyword: row.keyword,
        createdAt: row.created_at,
        locked: totalLocked,
      };
    })
  );
}

function router(provider, solanaConnection) {
  const r = express.Router();

  r.get("/wallets/:address/standings", async (req, res) => {
    const wallet = req.params.address;
    const isSolana = isValidSolanaAddress(wallet);
    if (!isSolana && !ethers.isAddress(wallet)) return res.status(400).json({ error: "not a valid address" });

    try {
      if (isSolana) {
        if (!solanaConnection) return res.status(503).json({ error: "SOLANA_RPC_URL is not configured on this API instance" });
        const [sho, sso] = await Promise.all([solanaShoStandings(wallet), solanaSsoStandings(wallet, solanaConnection)]);
        return res.json({ sho, sso });
      }

      const shoCampaignAddresses = await db.tokenTradeCampaigns(wallet);
      const sho = [];
      for (const campaignAddress of shoCampaignAddresses) {
        const row = await db.getCampaign(campaignAddress);
        if (!row) continue;
        const leaderboard = await db.shoLeaderboard(campaignAddress, new Date(Date.now() - Number(row.window_seconds) * 1000), 100_000);
        const position = rankOf(leaderboard, wallet);
        if (position) sho.push({ campaignAddress, ...position });
      }

      const ssoCampaignAddresses = await db.socialPostCampaigns(wallet);
      const sso = [];
      for (const campaignAddress of ssoCampaignAddresses) {
        const row = await db.getCampaign(campaignAddress);
        if (!row) continue;
        const contract = new ethers.Contract(campaignAddress, SSO_CAMPAIGN_ABI, provider);
        const epochCount = Number(await contract.epochCount());
        const now = Math.floor(Date.now() / 1000);
        let currentEpochIndex = null;
        for (let i = 0; i < epochCount; i++) {
          const e = await contract.getEpoch(i);
          if (!e.finalized && now < Number(e.endsAt)) {
            currentEpochIndex = i;
            break;
          }
        }
        if (currentEpochIndex === null) continue; // no open epoch to stand in right now
        const leaderboard = await db.ssoLeaderboard(campaignAddress, currentEpochIndex, 100_000);
        const position = rankOf(leaderboard, wallet);
        if (position) sso.push({ campaignAddress, epochIndex: currentEpochIndex, ...position });
      }

      res.json({ sho, sso });
    } catch (e) {
      console.error(`[GET /wallets/${wallet}/standings]`, e);
      res.status(502).json({ error: "failed to load standings", detail: e.message });
    }
  });

  r.get("/wallets/:address/claims", async (req, res) => {
    const wallet = req.params.address;
    const isSolana = isValidSolanaAddress(wallet);
    if (!isSolana && !ethers.isAddress(wallet)) return res.status(400).json({ error: "not a valid address" });

    try {
      if (isSolana) {
        if (!solanaConnection) return res.status(503).json({ error: "SOLANA_RPC_URL is not configured on this API instance" });
        const claims = await solanaClaims(wallet, solanaConnection);
        return res.json({ claims });
      }

      const snapshots = await db.snapshotsForWallet(wallet);
      const now = Math.floor(Date.now() / 1000);
      const claims = [];

      for (const snap of snapshots) {
        const entry = snap.entries.find((e) => e.account.toLowerCase() === wallet.toLowerCase());
        if (!entry) continue; // shouldn't happen given the query, but never trust it blindly

        const abi = snap.factory === "sso" ? SSO_CAMPAIGN_ABI : SHO_CAMPAIGN_ABI;
        const contract = new ethers.Contract(snap.campaign_address, abi, provider);
        const period = snap.factory === "sso" ? await contract.getEpoch(snap.index) : await contract.getMilestone(snap.index);
        const isClaimed = await contract.claimed(snap.index, wallet);

        let status;
        let claimedAt = null;
        let txHash = null;
        if (now < Number(period.challengeWindowEnds)) {
          status = "challenge_window";
        } else if (isClaimed) {
          status = "claimed";
          const logs = await contract.queryFilter(contract.filters.RewardClaimed(snap.index, wallet));
          if (logs.length) {
            const block = await provider.getBlock(logs[0].blockNumber);
            claimedAt = new Date(block.timestamp * 1000);
            txHash = logs[0].transactionHash;
          }
        } else {
          status = "claimable";
        }

        claims.push({
          factory: snap.factory,
          campaignAddress: snap.campaign_address,
          index: snap.index,
          amount: entry.amount,
          status,
          claimedAt,
          txHash,
        });
      }

      res.json({ claims });
    } catch (e) {
      console.error(`[GET /wallets/${wallet}/claims]`, e);
      res.status(502).json({ error: "failed to load claims", detail: e.message });
    }
  });

  r.get("/wallets/:address/created", async (req, res) => {
    const wallet = req.params.address;
    const isSolana = isValidSolanaAddress(wallet);
    if (!isSolana && !ethers.isAddress(wallet)) return res.status(400).json({ error: "not a valid address" });

    try {
      if (isSolana) {
        if (!solanaConnection) return res.status(503).json({ error: "SOLANA_RPC_URL is not configured on this API instance" });
        const created = await solanaCreated(wallet, solanaConnection);
        return res.json({ created });
      }

      const rows = await db.createdCampaigns(wallet);
      const created = await Promise.all(
        rows.map(async (row) => {
          const abi = row.factory === "sso" ? SSO_CAMPAIGN_ABI : SHO_CAMPAIGN_ABI;
          const contract = new ethers.Contract(row.campaign_address, abi, provider);
          const totalLocked = await contract.totalLocked().catch(() => null);
          return {
            id: row.campaign_address,
            factory: row.factory,
            token: row.token,
            keyword: row.keyword,
            createdAt: row.created_at,
            locked: totalLocked !== null ? totalLocked.toString() : null,
          };
        })
      );
      res.json({ created });
    } catch (e) {
      console.error(`[GET /wallets/${wallet}/created]`, e);
      res.status(502).json({ error: "failed to load created campaigns", detail: e.message });
    }
  });

  return r;
}

module.exports = { router, isValidSolanaAddress, rankOf, rankOfExact, solanaClaimReceiptPda };
