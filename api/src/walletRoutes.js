// Replaces the frontend prototype's MY_SHO_POSITIONS/MY_SSO_POSITIONS/MY_CREATED_*/
// CLAIM_HISTORY mock arrays (docs/BACKEND_ROADMAP.md's Stage 2 scope) with data reconstructed
// live from the keeper's indexed trades/posts, stored snapshots, and direct contract reads.
// Split into two genuinely different things the mock conflated into one status field:
// "standings" (a live, mutable, still-open leaderboard position -- for display only, matches
// db.js's own leaderboard-query caveat) and "claims" (an immutable position frozen into an
// actually-posted snapshot -- the only thing a wallet can ever really claim() against).
"use strict";
const express = require("express");
const { ethers } = require("ethers");
const db = require("./db");
const { SHO_CAMPAIGN_ABI, SSO_CAMPAIGN_ABI } = require("./abis");

function rankOf(leaderboard, wallet) {
  const idx = leaderboard.findIndex((e) => e.wallet.toLowerCase() === wallet.toLowerCase());
  return idx === -1 ? null : { rank: idx + 1, score: leaderboard[idx].score };
}

function router(provider) {
  const r = express.Router();

  r.get("/wallets/:address/standings", async (req, res) => {
    const wallet = req.params.address;
    if (!ethers.isAddress(wallet)) return res.status(400).json({ error: "not a valid address" });

    try {
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
      res.status(502).json({ error: "failed to load standings", detail: e.message });
    }
  });

  r.get("/wallets/:address/claims", async (req, res) => {
    const wallet = req.params.address;
    if (!ethers.isAddress(wallet)) return res.status(400).json({ error: "not a valid address" });

    try {
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
      res.status(502).json({ error: "failed to load claims", detail: e.message });
    }
  });

  r.get("/wallets/:address/created", async (req, res) => {
    const wallet = req.params.address;
    if (!ethers.isAddress(wallet)) return res.status(400).json({ error: "not a valid address" });

    try {
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
      res.status(502).json({ error: "failed to load created campaigns", detail: e.message });
    }
  });

  return r;
}

module.exports = { router };
