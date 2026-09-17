// Read/aggregation endpoints for SHO campaigns -- replaces the frontend prototype's
// hand-authored SHO_CAMPAIGNS mock array (docs/BACKEND_ROADMAP.md's Stage 2 scope) with real
// on-chain reads plus the keeper's indexed trades/price samples. Every response here is
// reconstructable from chain history plus the keeper's own Postgres state -- nothing here is
// a second source of truth.
"use strict";
const express = require("express");
const { ethers } = require("ethers");
const db = require("./db");
const { ERC20_ABI, SHO_CAMPAIGN_ABI, MILESTONE_USD_THRESHOLDS } = require("./abis");
const { timeWeightedAveragePrice, TWAP_WINDOW_MS, daysLeft } = require("./shared");

const TIER_LABELS = ["100K", "250K", "1M", "5M"];

function router(provider) {
  const r = express.Router();

  async function tokenTwapMcap(tokenAddress) {
    const samples = await db.priceSamplesSince(tokenAddress, new Date(Date.now() - TWAP_WINDOW_MS - 60_000));
    const price = timeWeightedAveragePrice(samples);
    if (price === null) return null; // same "not enough real time has passed yet" case as the keeper
    const erc20 = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const totalSupply = await erc20.totalSupply();
    return price * Number(ethers.formatUnits(totalSupply, 18));
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
  async function resolveRewardToken(rewardTokenAddress, tokenAddress, tokenSymbol) {
    if (rewardTokenAddress === ethers.ZeroAddress) return { rewardToken: rewardTokenAddress, rewardTokenSymbol: "ETH" };
    if (rewardTokenAddress.toLowerCase() === tokenAddress.toLowerCase()) {
      return { rewardToken: rewardTokenAddress, rewardTokenSymbol: tokenSymbol };
    }
    const symbol = await new ethers.Contract(rewardTokenAddress, ERC20_ABI, provider).symbol().catch(() => null);
    return { rewardToken: rewardTokenAddress, rewardTokenSymbol: symbol };
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
    const { rewardToken, rewardTokenSymbol } = await resolveRewardToken(rewardTokenAddress, row.token, erc20Symbol);

    return {
      id: row.campaign_address,
      contract: row.campaign_address,
      name: erc20Name,
      token: erc20Symbol,
      tokenAddress: row.token,
      rewardToken,
      rewardTokenSymbol,
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

  r.get("/sho/campaigns", async (req, res) => {
    try {
      const rows = await db.listCampaignsByFactory("sho");
      const campaigns = await Promise.all(rows.map(loadCampaignSummary));
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
      const summary = await loadCampaignSummary(row);
      const leaderboard = await db.shoLeaderboard(row.campaign_address, new Date(Date.now() - Number(row.window_seconds) * 1000), 10);
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
      const leaderboard = await db.shoLeaderboard(row.campaign_address, new Date(Date.now() - Number(row.window_seconds) * 1000), limit);
      res.json({ leaderboard: leaderboard.map((e, i) => ({ rank: i + 1, ...e })) });
    } catch (e) {
      console.error(`[GET /sho/campaigns/${req.params.address}/leaderboard]`, e);
      res.status(502).json({ error: "failed to load leaderboard", detail: e.message });
    }
  });

  return r;
}

module.exports = { router };
