// Entry point: runs the Chain Indexer (campaign discovery + trade indexing), price sampling,
// the Milestone Engine, the Snapshot Publisher, the On-chain Poster, and the missed-root
// alert on a polling loop. This is Stage 1 build-order steps 1-3 (KEEPER_SERVICE_DESIGN.md
// section 8) — root posting is now automatic too (see src/onchainPoster.js for the one
// deliberate simplification in that step: a single-signer EOA standing in for the design
// doc's 3-of-5 Gnosis Safe). scripts/post-milestone-root.js still exists for a manual
// override, but is no longer needed for the normal path.
"use strict";
require("dotenv").config();
const { ethers } = require("ethers");
const { pollNewCampaigns } = require("./campaignIndexer");
const { pollTradesForCampaign } = require("./tradeIndexer");
const { netBuyVolumeForCampaign } = require("./volumeAggregator");
const { samplePrice } = require("./priceSampler");
const { checkMilestones } = require("./milestoneEngine");
const { publishPendingSnapshots, DEFAULT_PUBLISH_INTERVAL_MS } = require("./snapshotPublisher");
const { postPendingRoots } = require("./onchainPoster");
const { checkMissedRootAlerts } = require("./alerts");
const db = require("./db");

async function tick(provider, keeperWallet, publishIntervalMs) {
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

  // Build-order step 3: publish any newly computed snapshot to IPFS, post any published
  // snapshot's root on-chain, then check whether anything crossed too long ago with still no
  // confirmed root. Each stage is idempotent on its own DB state (section 6), so running all
  // three every tick is safe even though most ticks find nothing pending in any of them.
  // publishPendingSnapshots throttles itself internally (see its own comment) -- posting and
  // the alert stay on the regular tick cadence since neither costs an external API call.
  await publishPendingSnapshots(publishIntervalMs);
  if (keeperWallet) {
    await postPendingRoots(provider, keeperWallet);
  }
  await checkMissedRootAlerts();
}

// No RPC call anywhere in this keeper (getBlockNumber, queryFilter, a contract read, ...) had
// any timeout -- confirmed live: a slow/unresponsive RPC endpoint hung the very first call of
// a tick (campaignIndexer.js's provider.getBlockNumber()) forever, with no error and no further
// log line at all, indistinguishable from the process being frozen. A FetchRequest with a
// timeout bounds every call this provider makes, not just one call site -- a hung request now
// rejects instead, gets caught by main()'s own try/catch below, logged, and retried next tick.
const RPC_TIMEOUT_MS = 30_000;

function buildProvider(rpcUrl) {
  const fetchRequest = new ethers.FetchRequest(rpcUrl);
  fetchRequest.timeout = RPC_TIMEOUT_MS;
  return new ethers.JsonRpcProvider(fetchRequest);
}

async function main() {
  const provider = buildProvider(process.env.RPC_URL);
  const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS || 15000);
  const publishIntervalMs = Number(process.env.SNAPSHOT_PUBLISH_INTERVAL_MS || DEFAULT_PUBLISH_INTERVAL_MS);

  // KEEPER_PRIVATE_KEY is now used by the main process itself, not just the manual scripts --
  // build-order step 3 automates postMilestoneRoot, which needs a signer. Still optional here
  // (rather than a hard exit) so the rest of the pipeline keeps running for anyone who hasn't
  // set it up yet; onchainPoster.js simply doesn't run without it, same as a token with no
  // registered pool skipping price sampling above.
  const keeperWallet = process.env.KEEPER_PRIVATE_KEY
    ? new ethers.Wallet(process.env.KEEPER_PRIVATE_KEY, provider)
    : null;
  if (!keeperWallet) {
    console.log("[keeper] KEEPER_PRIVATE_KEY not set -- automatic root posting is disabled this run.");
  }

  console.log(`Keeper (Stage 1, steps 1-3) starting. Polling every ${pollIntervalMs}ms.`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick(provider, keeperWallet, publishIntervalMs);
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
