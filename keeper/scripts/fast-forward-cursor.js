// Fast-forwards any indexer_cursors row to the current chain head. Useful whenever a cursor
// has fallen far behind (e.g. the keeper was stopped for a while on a chain that produces
// blocks quickly) and there's nothing meaningful to backfill for it -- same rationale as
// seed-known-campaign.js and register-token-pool.js already apply automatically for their
// own cursors.
//
// Usage: node scripts/fast-forward-cursor.js <cursorKey>
// Common keys: "campaign_indexer", or "trades:<tokenAddress>"
"use strict";
require("dotenv").config();
const { ethers } = require("ethers");
const db = require("../src/db");

async function main() {
  const cursorKey = process.argv[2];
  if (!cursorKey) {
    console.error("Usage: node scripts/fast-forward-cursor.js <cursorKey>");
    console.error('Common keys: "campaign_indexer", or "trades:<tokenAddress>"');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const latest = await provider.getBlockNumber();
  await db.setCursor(cursorKey, BigInt(latest));

  console.log(`Cursor "${cursorKey}" fast-forwarded to block ${latest}.`);
  await db.pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
