// Read/aggregation endpoints for SHO campaigns -- replaces the frontend prototype's
// hand-authored SHO_CAMPAIGNS mock array (docs/BACKEND_ROADMAP.md's Stage 2 scope) with real
// on-chain reads plus the keeper's indexed trades/price samples. Every response here is
// reconstructable from chain history plus the keeper's own Postgres state -- nothing here is
// a second source of truth.
"use strict";
const express = require("express");
const { ethers } = require("ethers");
const { PublicKey } = require("@solana/web3.js");
const db = require("./db");
const { ERC20_ABI, SHO_CAMPAIGN_ABI, MILESTONE_USD_THRESHOLDS } = require("./abis");
const solanaAbis = require("./solanaAbis");
const { netBuyVolumeForSolanaToken } = require("./solanaTraderIndexer");
const { timeWeightedAveragePrice, TWAP_WINDOW_MS, daysLeft } = require("./shared");

const TIER_LABELS = ["100K", "250K", "1M", "5M"];

function router(provider, solanaConnection) {
  const r = express.Router();

  async function tokenTwapMcap(tokenAddress) {
    const samples = await db.priceSamplesSince(tokenAddress, new Date(Date.now() - TWAP_WINDOW_MS - 60_000));
    const price = timeWeightedAveragePrice(samples);
    if (price === null) return null; // same "not enough real time has passed yet" case as the keeper
    const erc20 = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const totalSupply = await erc20.totalSupply();
    return price * Number(ethers.formatUnits(totalSupply, 18));
  }

  /// Solana counterpart of tokenTwapMcap: same TWAP math (timeWeightedAveragePrice is
  /// chain-agnostic, operating on {price_usd, sampled_at} rows regardless of source), reading
  /// supply/decimals from the SPL mint account directly instead of an ERC20 totalSupply() call
  /// -- Solana has no "view function" distinct from reading account data. Price samples come
  /// from the same sho_price_samples table keeper/src/solanaPriceSampler.js writes into
  /// (keyed by the tracked mint, same as the EVM path), so this needed no new table, only this
  /// new read path.
  async function solanaTokenTwapMcap(tokenMint) {
    const samples = await db.priceSamplesSince(tokenMint, new Date(Date.now() - TWAP_WINDOW_MS - 60_000));
    const price = timeWeightedAveragePrice(samples);
    if (price === null) return null;
    const mintInfo = await solanaConnection.getAccountInfo(new PublicKey(tokenMint));
    if (!mintInfo) return null;
    const mint = solanaAbis.decodeMint(mintInfo.data);
    return price * Number(ethers.formatUnits(mint.supply, mint.decimals));
  }

  /// Solana counterpart of db.shoLeaderboard -- that query only ever reads sho_trades, which
  /// nothing writes Solana rows into (Solana trade data lives in Birdeye's API, not a local
  /// table), so a Solana campaign's leaderboard silently rendered empty without this. Returns
  /// [] (not an error) when BIRDEYE_API_KEY isn't configured on this API instance, same "stays
  /// off without it" posture every other optional-env-var-gated piece of this project uses.
  async function solanaLeaderboard(row, limit) {
    if (!process.env.BIRDEYE_API_KEY) return [];
    try {
      return await netBuyVolumeForSolanaToken(row.token, Number(row.window_seconds), limit);
    } catch (e) {
      console.error(`[shoRoutes] Solana leaderboard fetch failed for ${row.campaign_address}:`, e.message);
      return [];
    }
  }

  /// milestones[] with a `status` per tier. Reached + past its challenge window is split into
  /// 'claimable'/'claimed' by whether anyone has claimed yet (totalClaimed > 0) -- a
  /// campaign-wide signal, not specific to any one wallet (see walletRoutes.js for a wallet's
  /// own claim status). 'challenge_window' is a real on-chain state the original frontend
  /// mock never modeled (it predates this project's actual challenge-window mechanic) --
  /// surfaced honestly here rather than folded into 'claimable'.
  async function loadMilestones(campaignContract, now) {
    const count = Number(await campaignContract.milestoneCount());
    const milestones = [];
    let seenUnreached = false;
    for (let i = 0; i < count; i++) {
      const m = await campaignContract.getMilestone(i);
      let status;
      if (!m.reached) {
        status = seenUnreached ? "pending" : "active";
        seenUnreached = true;
      } else if (now < Number(m.challengeWindowEnds)) {
        status = "challenge_window";
      } else {
        status = m.totalClaimed > 0n ? "claimed" : "claimable";
      }
      milestones.push({ index: i, tier: TIER_LABELS[Number(m.tier)], threshold: MILESTONE_USD_THRESHOLDS[Number(m.tier)], bps: Number(m.rewardBps), status });
    }
    return milestones;
  }

  // Reward token can be the campaign token itself, native ETH (address(0)), or a separate
  // allowlisted stablecoin -- resolved here (rather than left for the frontend to make its own
  // extra RPC calls for) since it's a genuine display need, same rationale as tokenTwapMcap.
  // Also resolves decimals -- the frontend used to assume every reward is 18-decimal (wrong
  // for e.g. USDC's 6), which only mattered cosmetically on EVM but would be badly wrong for
  // Solana's native SOL (9 decimals), so this got fixed for both chains together.
  async function resolveRewardToken(rewardTokenAddress, tokenAddress, tokenSymbol) {
    if (rewardTokenAddress === ethers.ZeroAddress) {
      return { rewardToken: rewardTokenAddress, rewardTokenSymbol: "ETH", rewardDecimals: 18 };
    }
    if (rewardTokenAddress.toLowerCase() === tokenAddress.toLowerCase()) {
      const decimals = await new ethers.Contract(rewardTokenAddress, ERC20_ABI, provider).decimals().catch(() => 18);
      return { rewardToken: rewardTokenAddress, rewardTokenSymbol: tokenSymbol, rewardDecimals: Number(decimals) };
    }
    const rewardContract = new ethers.Contract(rewardTokenAddress, ERC20_ABI, provider);
    const [symbol, decimals] = await Promise.all([
      rewardContract.symbol().catch(() => null),
      rewardContract.decimals().catch(() => 18),
    ]);
    return { rewardToken: rewardTokenAddress, rewardTokenSymbol: symbol, rewardDecimals: Number(decimals) };
  }

  async function loadCampaignSummary(row) {
    const contract = new ethers.Contract(row.campaign_address, SHO_CAMPAIGN_ABI, provider);
    const now = Math.floor(Date.now() / 1000);
    const [erc20Name, erc20Symbol, totalLocked, milestones, mcap, rewardTokenAddress] = await Promise.all([
      new ethers.Contract(row.token, ERC20_ABI, provider).name().catch(() => null),
      new ethers.Contract(row.token, ERC20_ABI, provider).symbol().catch(() => null),
      contract.totalLocked(),
      loadMilestones(contract, now),
      tokenTwapMcap(row.token),
      contract.rewardToken(),
    ]);
    const { rewardToken, rewardTokenSymbol, rewardDecimals } = await resolveRewardToken(rewardTokenAddress, row.token, erc20Symbol);

    return {
      network: "evm",
      id: row.campaign_address,
      contract: row.campaign_address,
      name: erc20Name,
      token: erc20Symbol,
      tokenAddress: row.token,
      rewardToken,
      rewardTokenSymbol,
      rewardDecimals,
      creator: row.creator,
      locked: totalLocked.toString(),
      windowSeconds: Number(row.window_seconds),
      leaderboardSize: row.leaderboard_size,
      durationSeconds: Number(row.duration_seconds),
      createdAt: row.created_at,
      daysLeft: daysLeft(row.created_at, row.duration_seconds),
      mcap,
      milestones,
    };
  }

  // Same status derivation as loadMilestones above, against a decoded sho_solana Campaign
  // account instead of live contract calls (there's nothing to call — Solana has no "view
  // function" distinct from reading account data, see contracts-solana/README.md).
  function solanaMilestoneStatus(m, now) {
    if (!m.reached) return null; // caller fills in 'active'/'pending' by position, same as EVM
    if (now < Number(m.challengeWindowEnds)) return "challenge_window";
    return m.totalClaimed > 0n ? "claimed" : "claimable";
  }

  /// `mcap` now comes from solanaTokenTwapMcap (same "not ready yet" semantics tokenTwapMcap
  /// already uses for a too-young campaign -- null, not a crash, when there's no valid 30-min
  /// TWAP yet). Token name/symbol come from Metaplex metadata when the tracked mint has any
  /// (solanaAbis.js's fetchSplTokenInfo) -- still null for a mint with none, same honest-gap
  /// posture as the website/twitter/holders fields already null everywhere in this API.
  async function loadSolanaCampaignSummary(row) {
    if (!solanaConnection) throw new Error("SOLANA_RPC_URL is not configured on this API instance");
    const campaignPubkey = new PublicKey(row.campaign_address);
    const info = await solanaConnection.getAccountInfo(campaignPubkey);
    if (!info) throw new Error(`Solana campaign account ${row.campaign_address} not found on-chain`);
    const c = solanaAbis.decodeShoCampaign(info.data);
    const now = Math.floor(Date.now() / 1000);
    const mcap = await solanaTokenTwapMcap(c.token);

    let seenUnreached = false;
    const milestones = c.milestones.map((m, i) => {
      let status = solanaMilestoneStatus(m, now);
      if (status === null) {
        status = seenUnreached ? "pending" : "active";
        seenUnreached = true;
      }
      return { index: i, tier: TIER_LABELS[m.tier], threshold: MILESTONE_USD_THRESHOLDS[m.tier], bps: m.rewardBps, status };
    });

    const isNative = c.rewardMint === solanaAbis.NATIVE_SOL_SENTINEL;
    const createdAt = new Date(Number(c.createdAt) * 1000);
    const tokenInfo = await solanaAbis
      .fetchSplTokenInfo(solanaConnection, new PublicKey(c.token))
      .catch(() => ({ decimals: null, name: null, symbol: null }));
    const rewardInfo = isNative
      ? { decimals: 9, name: null, symbol: "SOL" }
      : await solanaAbis
          .fetchSplTokenInfo(solanaConnection, new PublicKey(c.rewardMint))
          .catch(() => ({ decimals: null, name: null, symbol: null }));

    return {
      network: "solana",
      id: row.campaign_address,
      contract: row.campaign_address,
      name: tokenInfo.name,
      token: tokenInfo.symbol,
      tokenAddress: c.token,
      rewardToken: c.rewardMint,
      rewardTokenSymbol: rewardInfo.symbol,
      rewardDecimals: rewardInfo.decimals ?? 9,
      creator: c.creator,
      locked: c.totalLocked.toString(),
      windowSeconds: solanaAbis.WINDOW_SECONDS[c.window],
      leaderboardSize: c.leaderboardSize,
      durationSeconds: Number(c.duration),
      createdAt,
      daysLeft: daysLeft(createdAt, c.duration),
      mcap,
      milestones,
    };
  }

  /// Dispatches by row.network and never lets one bad campaign's live read take down the
  /// whole list (a single Solana row failing because solanaConnection isn't configured, or
  /// an EVM row failing because its RPC hiccupped, shouldn't 502 every other campaign) --
  /// matches this file's existing per-field .catch(() => null) posture, just per-row.
  async function loadSummarySafe(row) {
    try {
      return row.network === "solana" ? await loadSolanaCampaignSummary(row) : await loadCampaignSummary(row);
    } catch (e) {
      console.error(`[shoRoutes] failed to load campaign ${row.campaign_address} (network=${row.network}):`, e.message);
      return null;
    }
  }

  r.get("/sho/campaigns", async (req, res) => {
    try {
      const rows = await db.listCampaignsByFactory("sho");
      const campaigns = (await Promise.all(rows.map(loadSummarySafe))).filter(Boolean);
      res.json({ campaigns });
    } catch (e) {
      console.error("[GET /sho/campaigns]", e);
      res.status(502).json({ error: "failed to load SHO campaigns", detail: e.message });
    }
  });

  r.get("/sho/campaigns/:address", async (req, res) => {
    try {
      const row = await db.getCampaign(req.params.address);
      if (!row || row.factory !== "sho") return res.status(404).json({ error: "campaign not found" });
      const summary = row.network === "solana" ? await loadSolanaCampaignSummary(row) : await loadCampaignSummary(row);
      const leaderboard = row.network === "solana"
        ? await solanaLeaderboard(row, 10)
        : await db.shoLeaderboard(row.campaign_address, new Date(Date.now() - Number(row.window_seconds) * 1000), 10);
      res.json({ ...summary, topLeaderboard: leaderboard });
    } catch (e) {
      console.error(`[GET /sho/campaigns/${req.params.address}]`, e);
      res.status(502).json({ error: "failed to load campaign", detail: e.message });
    }
  });

  r.get("/sho/campaigns/:address/leaderboard", async (req, res) => {
    try {
      const row = await db.getCampaign(req.params.address);
      if (!row || row.factory !== "sho") return res.status(404).json({ error: "campaign not found" });
      const limit = Math.min(500, Number(req.query.limit) || 100);
      const leaderboard = row.network === "solana"
        ? await solanaLeaderboard(row, limit)
        : await db.shoLeaderboard(row.campaign_address, new Date(Date.now() - Number(row.window_seconds) * 1000), limit);
      res.json({ leaderboard: leaderboard.map((e, i) => ({ rank: i + 1, ...e })) });
    } catch (e) {
      console.error(`[GET /sho/campaigns/${req.params.address}/leaderboard]`, e);
      res.status(502).json({ error: "failed to load leaderboard", detail: e.message });
    }
  });

  return r;
}

module.exports = { router };
