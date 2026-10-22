// Read/aggregation endpoints for SSO campaigns -- SSO's half of what shoRoutes.js does for
// SHO. Mirrors its structure closely since the underlying data (a shared `campaigns` row,
// per-period reached/finalized state, a leaderboard) is genuinely the same shape, per
// KEEPER_SERVICE_DESIGN.md §4.5.
"use strict";
const express = require("express");
const { ethers } = require("ethers");
const { PublicKey } = require("@solana/web3.js");
const db = require("./db");
const { ERC20_ABI, SSO_CAMPAIGN_ABI, EPOCH_LENGTH_SECONDS } = require("./abis");
const solanaAbis = require("./solanaAbis");
const { daysLeft } = require("./shared");

function router(provider, solanaConnection) {
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

  // Same reasoning as shoRoutes.js's resolveRewardToken -- resolved once here rather than
  // making the frontend issue its own extra RPC calls per campaign card. Also resolves
  // decimals (see shoRoutes.js's own resolveRewardToken for why that matters for Solana).
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
    const contract = new ethers.Contract(row.campaign_address, SSO_CAMPAIGN_ABI, provider);
    const now = Math.floor(Date.now() / 1000);
    const [erc20Name, erc20Symbol, totalLocked, epochs, rewardTokenAddress, epochLengthIndex] = await Promise.all([
      new ethers.Contract(row.token, ERC20_ABI, provider).name().catch(() => null),
      new ethers.Contract(row.token, ERC20_ABI, provider).symbol().catch(() => null),
      contract.totalLocked(),
      loadEpochs(contract, now),
      contract.rewardToken(),
      contract.epochLength(),
    ]);
    const { rewardToken, rewardTokenSymbol, rewardDecimals } = await resolveRewardToken(rewardTokenAddress, row.token, erc20Symbol);
    const currentEpoch = epochs.find((e) => e.status === "active") ?? null;

    return {
      network: "evm",
      id: row.campaign_address,
      contract: row.campaign_address,
      name: erc20Name,
      token: erc20Symbol,
      keyword: row.keyword,
      tokenAddress: row.token,
      rewardToken,
      rewardTokenSymbol,
      rewardDecimals,
      epochSeconds: EPOCH_LENGTH_SECONDS[Number(epochLengthIndex)],
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

  /// Solana counterpart of loadCampaignSummary above, against a decoded sso_solana Campaign
  /// account. SSO never had an mcap concept, so there's no equivalent gap to flag there;
  /// token name/symbol/decimals come from solanaAbis.js's fetchSplTokenInfo, same as
  /// shoRoutes.js's Solana path.
  async function loadSolanaCampaignSummary(row) {
    if (!solanaConnection) throw new Error("SOLANA_RPC_URL is not configured on this API instance");
    const campaignPubkey = new PublicKey(row.campaign_address);
    const info = await solanaConnection.getAccountInfo(campaignPubkey);
    if (!info) throw new Error(`Solana campaign account ${row.campaign_address} not found on-chain`);
    const c = solanaAbis.decodeSsoCampaign(info.data);
    const now = Math.floor(Date.now() / 1000);

    const epochs = c.epochs.map((e) => {
      let status;
      if (!e.finalized) {
        status = now < Number(e.endsAt) ? "active" : "pending";
      } else if (now < Number(e.challengeWindowEnds)) {
        status = "challenge_window";
      } else {
        status = e.totalClaimed > 0n ? "claimed" : "claimable";
      }
      return { index: e.epochIndex, bps: e.rewardBps, endsAt: Number(e.endsAt), status };
    });
    const currentEpoch = epochs.find((e) => e.status === "active") ?? null;
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
      keyword: c.keyword,
      tokenAddress: c.token,
      rewardToken: c.rewardMint,
      rewardTokenSymbol: rewardInfo.symbol,
      rewardDecimals: rewardInfo.decimals ?? 9,
      epochSeconds: solanaAbis.EPOCH_LENGTH_SECONDS[c.epochLength],
      creator: c.creator,
      locked: c.totalLocked.toString(),
      leaderboardSize: c.leaderboardSize,
      durationSeconds: Number(c.duration),
      createdAt,
      daysLeft: daysLeft(createdAt, c.duration),
      currentEpochIndex: currentEpoch ? currentEpoch.index : null,
      epochs,
    };
  }

  async function loadSummarySafe(row) {
    try {
      return row.network === "solana" ? await loadSolanaCampaignSummary(row) : await loadCampaignSummary(row);
    } catch (e) {
      console.error(`[ssoRoutes] failed to load campaign ${row.campaign_address} (network=${row.network}):`, e.message);
      return null;
    }
  }

  r.get("/sso/campaigns", async (req, res) => {
    try {
      const rows = await db.listCampaignsByFactory("sso");
      const campaigns = (await Promise.all(rows.map(loadSummarySafe))).filter(Boolean);
      res.json({ campaigns });
    } catch (e) {
      console.error("[GET /sso/campaigns]", e);
      res.status(502).json({ error: "failed to load SSO campaigns", detail: e.message });
    }
  });

  r.get("/sso/campaigns/:address", async (req, res) => {
    try {
      const row = await db.getCampaign(req.params.address);
      if (!row || row.factory !== "sso") return res.status(404).json({ error: "campaign not found" });
      const summary = row.network === "solana" ? await loadSolanaCampaignSummary(row) : await loadCampaignSummary(row);
      const leaderboard =
        summary.currentEpochIndex !== null ? await db.ssoLeaderboard(row.campaign_address, summary.currentEpochIndex, 10) : [];
      res.json({ ...summary, topLeaderboard: leaderboard });
    } catch (e) {
      console.error(`[GET /sso/campaigns/${req.params.address}]`, e);
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
      console.error(`[GET /sso/campaigns/${req.params.address}/leaderboard]`, e);
      res.status(502).json({ error: "failed to load leaderboard", detail: e.message });
    }
  });

  return r;
}

module.exports = { router };
