// Entry point: runs the Chain Indexer (campaign discovery + per-campaign trade indexing)
// on a polling loop. This is Stage 1 build-order step 1 (KEEPER_SERVICE_DESIGN.md section 8)
// — Volume Aggregator results are logged, not yet acted on (no milestone detection, no root
// posting — those are later steps).
"use strict";
require("dotenv").config();
const { ethers } = require("ethers");
const { pollNewCampaigns } = require("./campaignIndexer");
const { pollTradesForCampaign } = require("./tradeIndexer");
const { netBuyVolumeForCampaign } = require("./volumeAggregator");
const db = require("./db");

async function tick(provider) {
  const factoryAddress = process.env.SHO_FACTORY_ADDRESS;
  const deployBlock = Number(process.env.SHO_FACTORY_DEPLOY_BLOCK || 0);

  await pollNewCampaigns(provider, factoryAddress, deployBlock);

  const campaigns = await db.listCampaigns();
  for (const c of campaigns) {
    // Deliberate simplification: tokens go straight to a Uniswap V4 pool at launch, no
    // Pons.family bonding-curve phase (its contract ABI still isn't available — see
    // tradeSources/ponsBondingCurve.js). A token with no registered pool config
    // (scripts/register-token-pool.js) simply has nothing indexed yet, logged inside
    // pollTradesForCampaign rather than treated as an error.
    await pollTradesForCampaign(provider, c);

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
