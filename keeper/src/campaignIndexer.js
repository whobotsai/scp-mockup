// Chain Indexer's campaign-discovery half (KEEPER_SERVICE_DESIGN.md §4.1): watches
// SHOFactory's CampaignCreated event and populates the `campaigns` table. The trade-level
// half (per-token swap indexing) lives in tradeSources/ + index.js, since it needs a
// per-campaign venue adapter this module doesn't know about.
"use strict";
const { ethers } = require("ethers");
const { SHO_FACTORY_ABI, SHO_CAMPAIGN_ABI, WINDOW_SECONDS } = require("./abis/sho");
const db = require("./db");

const CURSOR_KEY = "campaign_indexer";
const MAX_BLOCK_RANGE = 2000n; // getLogs range cap some RPC providers enforce; chunk around it

async function pollNewCampaigns(provider, factoryAddress, deployBlock) {
  const factory = new ethers.Contract(factoryAddress, SHO_FACTORY_ABI, provider);
  const latest = BigInt(await provider.getBlockNumber());

  let fromBlock = (await db.getCursor(CURSOR_KEY)) ?? BigInt(deployBlock);
  if (fromBlock > latest) return;

  while (fromBlock <= latest) {
    const toBlock = fromBlock + MAX_BLOCK_RANGE < latest ? fromBlock + MAX_BLOCK_RANGE : latest;

    const logs = await factory.queryFilter(factory.filters.CampaignCreated(), fromBlock, toBlock);
    for (const log of logs) {
      await indexCampaign(provider, log);
    }

    await db.setCursor(CURSOR_KEY, toBlock);
    fromBlock = toBlock + 1n;
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

module.exports = { pollNewCampaigns };
