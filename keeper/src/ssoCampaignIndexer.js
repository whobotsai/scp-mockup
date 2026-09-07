// SSO's campaign-discovery half of the Chain Indexer (KEEPER_SERVICE_DESIGN.md §4.1/§4.3):
// watches SSOFactory's CampaignCreated event and populates the shared `campaigns` table.
// Structurally identical to campaignIndexer.js's SHO half (same backfill/cursor/progress-
// logging pattern, deliberately duplicated rather than abstracted this pass -- see that
// module for the reasoning behind each piece if changing this).
"use strict";
const { ethers } = require("ethers");
const { SSO_FACTORY_ABI, SSO_CAMPAIGN_ABI } = require("./abis/sso");
const db = require("./db");

const CURSOR_KEY = "sso_campaign_indexer";
const MAX_BLOCK_RANGE = BigInt(process.env.GET_LOGS_MAX_BLOCK_RANGE || 9);

async function pollNewSsoCampaigns(provider, factoryAddress, deployBlock) {
  const factory = new ethers.Contract(factoryAddress, SSO_FACTORY_ABI, provider);
  const latest = BigInt(await provider.getBlockNumber());

  let fromBlock = (await db.getCursor(CURSOR_KEY)) ?? BigInt(deployBlock);
  if (fromBlock > latest) return;

  const chunkSize = MAX_BLOCK_RANGE + 1n;
  const totalBlocks = latest - fromBlock + 1n;
  if (totalBlocks > chunkSize) {
    console.log(
      `[ssoCampaignIndexer] backfilling ${totalBlocks} blocks (${fromBlock} to ${latest}) in chunks ` +
        `of ${chunkSize} -- see README's "If a backfill is taking a very long time" section for a ` +
        `faster option (fast-forward-cursor.js).`
    );
  }

  let lastLoggedAt = Date.now();
  while (fromBlock <= latest) {
    const toBlock = fromBlock + MAX_BLOCK_RANGE < latest ? fromBlock + MAX_BLOCK_RANGE : latest;

    const logs = await factory.queryFilter(factory.filters.CampaignCreated(), fromBlock, toBlock);
    for (const log of logs) {
      await indexSsoCampaign(provider, log);
    }

    await db.setCursor(CURSOR_KEY, toBlock);
    fromBlock = toBlock + 1n;

    if (fromBlock <= latest && Date.now() - lastLoggedAt > 5000) {
      console.log(`[ssoCampaignIndexer] backfill progress: at block ${toBlock} of ${latest}`);
      lastLoggedAt = Date.now();
    }
  }
}

async function indexSsoCampaign(provider, log) {
  const { id, campaign, creator, token, rewardToken, keyword } = log.args;
  const campaignContract = new ethers.Contract(campaign, SSO_CAMPAIGN_ABI, provider);

  const [duration, leaderboardSize, createdAt] = await Promise.all([
    campaignContract.duration(),
    campaignContract.leaderboardSize(),
    campaignContract.createdAt(),
  ]);

  await db.upsertCampaign({
    campaignId: id.toString(),
    factory: "sso",
    campaignAddress: campaign,
    token,
    rewardToken,
    creator,
    createdAt: new Date(Number(createdAt) * 1000),
    durationSeconds: duration.toString(),
    leaderboardSize: Number(leaderboardSize),
    keyword,
  });

  console.log(`[ssoCampaignIndexer] indexed campaign #${id} at ${campaign} (keyword "${keyword}")`);
}

module.exports = { pollNewSsoCampaigns, indexSsoCampaign, CURSOR_KEY };
