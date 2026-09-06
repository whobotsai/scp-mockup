// Entry point: runs the Chain Indexer (campaign discovery + trade indexing), price sampling,
// and the Milestone Engine on a polling loop. This is Stage 1 build-order steps 1 and 2
// (KEEPER_SERVICE_DESIGN.md section 8) — root *posting* stays manual (step 2's own scope,
// see scripts/post-milestone-root.js); everything upstream of that is now automatic.
"use strict";
require("dotenv").config();
const { ethers } = require("ethers");
const { pollNewCampaigns } = require("./campaignIndexer");
const { pollTradesForCampaign } = require("./tradeIndexer");
const { netBuyVolumeForCampaign } = require("./volumeAggregator");
const { samplePrice } = require("./priceSampler");
const { checkMilestones } = require("./milestoneEngine");
const db = require("./db");

async function tick(provider) {
  const factoryAddress = process.env.SHO_FACTORY_ADDRESS;
  const deployBlock = Number(process.env.SHO_FACTORY_DEPLOY_BLOCK || 0);

  await pollNewCampaigns(provider, factoryAddress, deployBlock);

  const campaigns = await db.listCampaigns();
  for (const c of campaigns) {
    // Deliberate simplification: no Pons.family bonding-curve phase (its contract ABI still
    // isn't available — see tradeSources/ponsBondingCurve.js). A token with no registered
    // pool config (scripts/register-token-pool.js) simply has nothing indexed/priced yet,
    // logged inside pollTradesForCampaign/samplePrice rather than treated as an error.
    await pollTradesForCampaign(provider, c);

    const leaderboard = await netBuyVolumeForCampaign(c.campaign_address, Number(c.window_seconds));
    console.log(
      `[volumeAggregator] ${c.campaign_address}: ${leaderboard.length} eligible wallet(s)` +
        (leaderboard.length ? `, top: ${leaderboard[0].wallet} ($${leaderboard[0].netBuyUsd.toFixed(2)})` : "")
    );

    const poolConfig = await db.getTokenPool(c.token);
    if (poolConfig) {
      await samplePrice(provider, c.token, poolConfig);
      await checkMilestones(provider, c);
    }
  }
}

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS || 15000);

  console.log(`Keeper (Stage 1, steps 1-2) starting. Polling every ${pollIntervalMs}ms.`);
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
