// Entry point: runs the Chain Indexer (campaign discovery + per-campaign trade indexing)
// on a polling loop. This is Stage 1 build-order step 1 (KEEPER_SERVICE_DESIGN.md §8) —
// Volume Aggregator results are logged, not yet acted on (no milestone detection, no root
// posting — those are later steps).
"use strict";
require("dotenv").config();
const { ethers } = require("ethers");
const { pollNewCampaigns } = require("./campaignIndexer");
const { netBuyVolumeForCampaign } = require("./volumeAggregator");
const db = require("./db");

async function tick(provider) {
  const factoryAddress = process.env.SHO_FACTORY_ADDRESS;
  const deployBlock = Number(process.env.SHO_FACTORY_DEPLOY_BLOCK || 0);

  await pollNewCampaigns(provider, factoryAddress, deployBlock);

  // Per-campaign trade indexing is intentionally not wired in here yet: it needs a venue
  // adapter selected per campaign's token (uniswap_v4 once graduated, pons_bonding_curve
  // before that — the latter isn't implemented, see tradeSources/ponsBondingCurve.js), which
  // means knowing a token's graduation status and its pool/curve address. That mapping isn't
  // available yet (it depends on Pons.family's own API/contracts, same gap as the trade
  // source itself) — flagged here rather than guessed at.
  //
  // What *does* run already: net-buy volume reporting against whatever sho_trades rows exist
  // for each known campaign, so the Volume Aggregator itself is exercised end-to-end as soon
  // as trades land in the table by any means (including a manual insert for testing).
  const campaigns = await db.listCampaigns();
  for (const c of campaigns) {
    const leaderboard = await netBuyVolumeForCampaign(c.campaign_address, Number(c.window_seconds));
    console.log(
      `[volumeAggregator] ${c.campaign_address}: ${leaderboard.length} eligible wallet(s)` +
        (leaderboard.length ? `, top: ${leaderboard[0].wallet} ($${leaderboard[0].netBuyUsd.toFixed(2)})` : "")
    );
  }
}

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS || 15000);

  console.log(`Keeper (Stage 1, step 1) starting. Polling every ${pollIntervalMs}ms.`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick(provider);
    } catch (e) {
      console.error("[keeper] tick failed:", e);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
