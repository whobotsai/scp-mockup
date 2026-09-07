// Indexes Registry.sol's HandleRegistered event into handle_registrations, building the
// reverse (x_handle -> wallet) lookup socialIndexer.js needs -- Registry's own on-chain
// mapping only goes wallet -> xHandle (see migrations/007_sso.sql's comment on why). Same
// backfill/cursor/progress-logging pattern as campaignIndexer.js/ssoCampaignIndexer.js.
"use strict";
const { ethers } = require("ethers");
const { REGISTRY_ABI } = require("./abis/sso");
const db = require("./db");

const CURSOR_KEY = "registration_indexer";
const MAX_BLOCK_RANGE = BigInt(process.env.GET_LOGS_MAX_BLOCK_RANGE || 9);

async function pollNewRegistrations(provider, registryAddress, deployBlock) {
  const registry = new ethers.Contract(registryAddress, REGISTRY_ABI, provider);
  const latest = BigInt(await provider.getBlockNumber());

  let fromBlock = (await db.getCursor(CURSOR_KEY)) ?? BigInt(deployBlock);
  if (fromBlock > latest) return;

  const chunkSize = MAX_BLOCK_RANGE + 1n;
  const totalBlocks = latest - fromBlock + 1n;
  if (totalBlocks > chunkSize) {
    console.log(
      `[registrationIndexer] backfilling ${totalBlocks} blocks (${fromBlock} to ${latest}) in chunks ` +
        `of ${chunkSize} -- see README's "If a backfill is taking a very long time" section for a ` +
        `faster option (fast-forward-cursor.js).`
    );
  }

  let lastLoggedAt = Date.now();
  while (fromBlock <= latest) {
    const toBlock = fromBlock + MAX_BLOCK_RANGE < latest ? fromBlock + MAX_BLOCK_RANGE : latest;

    const logs = await registry.queryFilter(registry.filters.HandleRegistered(), fromBlock, toBlock);
    for (const log of logs) {
      const block = await provider.getBlock(log.blockNumber);
      const { wallet, xHandle } = log.args;
      await db.upsertHandleRegistration(wallet, xHandle, new Date(block.timestamp * 1000));
      console.log(`[registrationIndexer] indexed registration: ${wallet} -> @${xHandle}`);
    }

    await db.setCursor(CURSOR_KEY, toBlock);
    fromBlock = toBlock + 1n;

    if (fromBlock <= latest && Date.now() - lastLoggedAt > 5000) {
      console.log(`[registrationIndexer] backfill progress: at block ${toBlock} of ${latest}`);
      lastLoggedAt = Date.now();
    }
  }
}

module.exports = { pollNewRegistrations, CURSOR_KEY };
