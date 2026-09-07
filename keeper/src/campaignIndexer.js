// Chain Indexer's campaign-discovery half (KEEPER_SERVICE_DESIGN.md §4.1): watches
// SHOFactory's CampaignCreated event and populates the `campaigns` table. The trade-level
// half (per-token swap indexing) lives in tradeSources/ + index.js, since it needs a
// per-campaign venue adapter this module doesn't know about.
"use strict";
const { ethers } = require("ethers");
const { SHO_FACTORY_ABI, SHO_CAMPAIGN_ABI, WINDOW_SECONDS } = require("./abis/sho");
const db = require("./db");

const CURSOR_KEY = "campaign_indexer";
// getLogs block-range cap — RPC-provider dependent, not a chain limit. Alchemy's free tier
// enforces a 10-block max per eth_getLogs call (a paid plan raises this); default here is
// sized for that free tier and can be widened via .env once/if the plan changes.
const MAX_BLOCK_RANGE = BigInt(process.env.GET_LOGS_MAX_BLOCK_RANGE || 9);

async function pollNewCampaigns(provider, factoryAddress, deployBlock) {
  const factory = new ethers.Contract(factoryAddress, SHO_FACTORY_ABI, provider);
  const latest = BigInt(await provider.getBlockNumber());

  let fromBlock = (await db.getCursor(CURSOR_KEY)) ?? BigInt(deployBlock);
  if (fromBlock > latest) return;

  // A cursor that fell far behind (the keeper wasn't running for a while) used to backfill in
  // total silence here -- the only log line in this loop fires per matching event, and most
  // chunks find nothing -- so a multi-hour backfill at 10 blocks/request looked identical to a
  // genuine hang. Confirmed live. Log the plan up front, then progress periodically.
  const chunkSize = MAX_BLOCK_RANGE + 1n;
  const totalBlocks = latest - fromBlock + 1n;
  if (totalBlocks > chunkSize) {
    console.log(
      `[campaignIndexer] backfilling ${totalBlocks} blocks (${fromBlock} to ${latest}) in chunks of ` +
        `${chunkSize} -- this can take a while on a free-tier RPC; see README's "If a backfill ` +
        `is taking a very long time" section for a faster option (fast-forward-cursor.js).`
    );
  }

  let lastLoggedAt = Date.now();
  while (fromBlock <= latest) {
    const toBlock = fromBlock + MAX_BLOCK_RANGE < latest ? fromBlock + MAX_BLOCK_RANGE : latest;

    const logs = await factory.queryFilter(factory.filters.CampaignCreated(), fromBlock, toBlock);
    for (const log of logs) {
      await indexCampaign(provider, log);
    }

    await db.setCursor(CURSOR_KEY, toBlock);
    fromBlock = toBlock + 1n;

    if (fromBlock <= latest && Date.now() - lastLoggedAt > 5000) {
      console.log(`[campaignIndexer] backfill progress: at block ${toBlock} of ${latest}`);
      lastLoggedAt = Date.now();
    }
  }
}

async function indexCampaign(provider, log) {
  const { id, campaign, creator, token, rewardToken } = log.args;
  const campaignContract = new ethers.Contract(campaign, SHO_CAMPAIGN_ABI, provider);

  const [windowIdx, duration, leaderboardSize, createdAt] = await Promise.all([
    campaignContract.window(),
    campaignContract.duration(),
    campaignContract.leaderboardSize(),
    campaignContract.createdAt(),
  ]);

  await db.upsertCampaign({
    campaignId: id.toString(),
    factory: "sho",
    campaignAddress: campaign,
    token,
    rewardToken,
    creator,
    createdAt: new Date(Number(createdAt) * 1000),
    durationSeconds: duration.toString(),
    leaderboardSize: Number(leaderboardSize),
    windowSeconds: WINDOW_SECONDS[Number(windowIdx)],
  });

  console.log(`[campaignIndexer] indexed campaign #${id} at ${campaign} (token ${token})`);
}

module.exports = { pollNewCampaigns, indexCampaign, CURSOR_KEY };
