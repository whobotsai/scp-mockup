// Read/aggregation endpoints for SSO campaigns -- SSO's half of what shoRoutes.js does for
// SHO. Mirrors its structure closely since the underlying data (a shared `campaigns` row,
// per-period reached/finalized state, a leaderboard) is genuinely the same shape, per
// KEEPER_SERVICE_DESIGN.md §4.5.
"use strict";
const express = require("express");
const { ethers } = require("ethers");
const db = require("./db");
const { SSO_CAMPAIGN_ABI } = require("./abis");
const { daysLeft } = require("./shared");

function router(provider) {
  const r = express.Router();

  /// epochs[] with a status per period. Unlike SHO's milestones (unlock independently, any
  /// order), SSO epochs are strictly chronological -- exactly one is ever "current" (open,
  /// not yet closed), everything after it is 'pending' by construction (PRD §12.3: the pool
  /// pays out on a fixed schedule, not a market condition).
  async function loadEpochs(campaignContract, now) {
    const count = Number(await campaignContract.epochCount());
    const epochs = [];
    for (let i = 0; i < count; i++) {
      const e = await campaignContract.getEpoch(i);
      let status;
      if (!e.finalized) {
        status = now < Number(e.endsAt) ? "active" : "pending"; // "pending" here: window closed, root not posted yet -- transient
      } else if (now < Number(e.challengeWindowEnds)) {
        status = "challenge_window";
      } else {
        status = e.totalClaimed > 0n ? "claimed" : "claimable";
      }
      epochs.push({ index: i, bps: Number(e.rewardBps), endsAt: Number(e.endsAt), status });
    }
    return epochs;
  }

  async function loadCampaignSummary(row) {
    const contract = new ethers.Contract(row.campaign_address, SSO_CAMPAIGN_ABI, provider);
    const now = Math.floor(Date.now() / 1000);
    const [totalLocked, epochs] = await Promise.all([contract.totalLocked(), loadEpochs(contract, now)]);
    const currentEpoch = epochs.find((e) => e.status === "active") ?? null;

    return {
      id: row.campaign_address,
      contract: row.campaign_address,
      keyword: row.keyword,
      tokenAddress: row.token,
      creator: row.creator,
      locked: totalLocked.toString(),
      leaderboardSize: row.leaderboard_size,
      durationSeconds: Number(row.duration_seconds),
      createdAt: row.created_at,
      daysLeft: daysLeft(row.created_at, row.duration_seconds),
      currentEpochIndex: currentEpoch ? currentEpoch.index : null,
      epochs,
    };
  }

  r.get("/sso/campaigns", async (req, res) => {
    try {
      const rows = await db.listCampaignsByFactory("sso");
      const campaigns = await Promise.all(rows.map(loadCampaignSummary));
      res.json({ campaigns });
    } catch (e) {
      res.status(502).json({ error: "failed to load SSO campaigns", detail: e.message });
    }
  });

  r.get("/sso/campaigns/:address", async (req, res) => {
    try {
      const row = await db.getCampaign(req.params.address);
      if (!row || row.factory !== "sso") return res.status(404).json({ error: "campaign not found" });
      const summary = await loadCampaignSummary(row);
      const leaderboard =
        summary.currentEpochIndex !== null ? await db.ssoLeaderboard(row.campaign_address, summary.currentEpochIndex, 10) : [];
      res.json({ ...summary, topLeaderboard: leaderboard });
    } catch (e) {
      res.status(502).json({ error: "failed to load campaign", detail: e.message });
    }
  });

  r.get("/sso/campaigns/:address/leaderboard", async (req, res) => {
    try {
      const row = await db.getCampaign(req.params.address);
      if (!row || row.factory !== "sso") return res.status(404).json({ error: "campaign not found" });
      const epochIndex = Number(req.query.epoch);
      if (!Number.isInteger(epochIndex) || epochIndex < 0) {
        return res.status(400).json({ error: "query param 'epoch' (integer >= 0) is required" });
      }
      const limit = Math.min(500, Number(req.query.limit) || 100);
      const leaderboard = await db.ssoLeaderboard(row.campaign_address, epochIndex, limit);
      res.json({ leaderboard: leaderboard.map((e, i) => ({ rank: i + 1, ...e })) });
    } catch (e) {
      res.status(502).json({ error: "failed to load leaderboard", detail: e.message });
    }
  });

  return r;
}

module.exports = { router };
