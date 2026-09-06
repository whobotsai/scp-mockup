// Registers a token's Uniswap V4 pool config so the Chain Indexer knows where to pull real
// trades from (see ../src/tradeSources/uniswapV4.js). Run this once, after the token and its
// pool actually exist -- there is nothing to register before that.
//
// Usage:
//   node scripts/register-token-pool.js <token> <poolManagerAddress> <poolId> <true|false>
//
// The last argument is campaignTokenIsCurrency0 -- whether the campaigning token is
// currency0 in the pool's PoolKey (check via the pool creation tx or the interface you used
// to create the pool; getting this backwards silently flips every trade's buy/sell label).
"use strict";
require("dotenv").config();
const { ethers } = require("ethers");
const db = require("../src/db");
const { cursorKeyFor } = require("../src/tradeIndexer");

async function main() {
  const [token, poolManagerAddress, poolId, isCurrency0Str] = process.argv.slice(2);

  if (!token || !poolManagerAddress || !poolId || !isCurrency0Str) {
    console.error(
      "Usage: node scripts/register-token-pool.js <token> <poolManagerAddress> <poolId> <true|false>"
    );
    process.exit(1);
  }
  if (!ethers.isAddress(token)) {
    console.error(`Not a valid address: ${token}`);
    process.exit(1);
  }
  if (!ethers.isAddress(poolManagerAddress)) {
    console.error(`Not a valid address: ${poolManagerAddress}`);
    process.exit(1);
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(poolId)) {
    console.error(`poolId should be a 32-byte hex string (0x + 64 hex chars), got: ${poolId}`);
    process.exit(1);
  }
  if (isCurrency0Str !== "true" && isCurrency0Str !== "false") {
    console.error(`Last argument must be exactly "true" or "false", got: ${isCurrency0Str}`);
    process.exit(1);
  }

  await db.upsertTokenPool(token, {
    poolManagerAddress,
    poolId,
    campaignTokenIsCurrency0: isCurrency0Str === "true",
  });

  // Fast-forward the trade cursor to the current chain head, same rationale as
  // contracts/scripts/test/*.js's manual walkthrough and keeper/scripts/seed-known-campaign.js:
  // there's no need to scan for trades before this pool existed, and doing so at a
  // free-tier RPC's small getLogs block-range cap would be needlessly slow.
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const latest = await provider.getBlockNumber();
  await db.setCursor(cursorKeyFor(token), BigInt(latest));

  console.log(`Registered pool config for token ${token}:`);
  console.log(`  poolManagerAddress: ${poolManagerAddress}`);
  console.log(`  poolId: ${poolId}`);
  console.log(`  campaignTokenIsCurrency0: ${isCurrency0Str}`);
  console.log(`\nTrade cursor set to block ${latest}. The indexer will pick up trades from here forward.`);

  await db.pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
