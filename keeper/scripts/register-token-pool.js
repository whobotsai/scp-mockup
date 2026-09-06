// Registers a token's real pool config so the Chain Indexer knows where to pull real trades
// from (see ../src/tradeSources/uniswapV2.js and uniswapV4.js). Run this once, after the
// token and its pool actually exist -- there is nothing to register before that.
//
// Usage:
//   node scripts/register-token-pool.js <token> uniswap_v2 <pairAddress> <true|false>
//   node scripts/register-token-pool.js <token> uniswap_v4 <poolManagerAddress> <poolId> <true|false>
//
// The final argument is always "is the campaigning token the first token in the pair/pool"
// (token0 for V2, currency0 for V4) -- check it against the pool creation transaction rather
// than guessing; getting it backwards silently flips every trade's buy/sell label.
"use strict";
require("dotenv").config();
const { ethers } = require("ethers");
const db = require("../src/db");
const { cursorKeyFor } = require("../src/tradeIndexer");

function usageAndExit() {
  console.error("Usage:");
  console.error("  node scripts/register-token-pool.js <token> uniswap_v2 <pairAddress> <true|false>");
  console.error("  node scripts/register-token-pool.js <token> uniswap_v4 <poolManagerAddress> <poolId> <true|false>");
  process.exit(1);
}

async function main() {
  const [token, venue, ...rest] = process.argv.slice(2);

  if (!token || !ethers.isAddress(token)) {
    console.error(`Not a valid token address: ${token}`);
    usageAndExit();
  }

  let cfg;
  if (venue === "uniswap_v2") {
    const [pairAddress, isToken0Str] = rest;
    if (!pairAddress || !ethers.isAddress(pairAddress) || (isToken0Str !== "true" && isToken0Str !== "false")) {
      usageAndExit();
    }
    cfg = { venue, pairAddress, campaignTokenIsToken0: isToken0Str === "true" };
  } else if (venue === "uniswap_v4") {
    const [poolManagerAddress, poolId, isCurrency0Str] = rest;
    if (
      !poolManagerAddress ||
      !ethers.isAddress(poolManagerAddress) ||
      !poolId ||
      !/^0x[0-9a-fA-F]{64}$/.test(poolId) ||
      (isCurrency0Str !== "true" && isCurrency0Str !== "false")
    ) {
      usageAndExit();
    }
    cfg = { venue, poolManagerAddress, poolId, campaignTokenIsCurrency0: isCurrency0Str === "true" };
  } else {
    console.error(`Unknown venue: ${venue} (must be "uniswap_v2" or "uniswap_v4")`);
    usageAndExit();
  }

  await db.upsertTokenPool(token, cfg);

  // Fast-forward the trade cursor to the current chain head, same rationale as
  // contracts/scripts/test/*.js's manual walkthrough and keeper/scripts/seed-known-campaign.js:
  // there's no need to scan for trades before this pool existed, and doing so at a
  // free-tier RPC's small getLogs block-range cap would be needlessly slow.
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const latest = await provider.getBlockNumber();
  await db.setCursor(cursorKeyFor(token), BigInt(latest));

  console.log(`Registered ${venue} pool config for token ${token}:`);
  console.log(JSON.stringify(cfg, null, 2));
  console.log(`\nTrade cursor set to block ${latest}. The indexer will pick up trades from here forward.`);

  await db.pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
