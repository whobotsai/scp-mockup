// Samples each tracked pool's instantaneous price into sho_price_samples, for twapOracle.js
// to average. One sample per keeper tick per token -- see twapOracle.js's file header for
// why a real 30-minute TWAP genuinely needs that much wall-clock sampling history.
//
// Two documented simplifications, same spirit as tradeSources/uniswapV2.js/uniswapV4.js's
// own USD-proxy caveat:
//   - Assumes the pool's counter asset is USD-pegged (true for this project's own
//     "Mock USD" test token; not true in general for an arbitrary quote asset).
//   - Assumes both tokens use 18 decimals (true for MockERC20; a real token with different
//     decimals would need the raw reserve ratio adjusted for that before it's a real price).
"use strict";
const { ethers } = require("ethers");
const db = require("./db");

const PAIR_ABI = [
  "function getReserves() view returns (uint112, uint112, uint32)",
];

async function samplePrice(provider, token, poolConfig) {
  if (poolConfig.venue !== "uniswap_v2") {
    console.log(`[priceSampler] venue "${poolConfig.venue}" sampling not implemented yet for token ${token} -- skipping`);
    return;
  }

  const pair = new ethers.Contract(poolConfig.pair_address, PAIR_ABI, provider);
  const [reserve0, reserve1] = await pair.getReserves();
  const campaignReserve = poolConfig.campaign_token_is_token0 ? reserve0 : reserve1;
  const counterReserve = poolConfig.campaign_token_is_token0 ? reserve1 : reserve0;

  if (campaignReserve === 0n) return; // no liquidity yet, nothing to price

  const priceUsd = Number(counterReserve) / Number(campaignReserve);
  await db.insertPriceSample(token, poolConfig.venue, priceUsd, new Date());
}

module.exports = { samplePrice };
