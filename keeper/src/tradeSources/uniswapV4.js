// Trade source adapter for a token's post-graduation venue: its Uniswap V4 pool
// (PRD.md §2.2, §3.2). Uniswap V4 uses a single singleton `PoolManager` contract for every
// pool (not one contract per pair like V2/V3), so this indexes PoolManager's own `Swap`
// event, filtered to one pool via its `PoolId`.
//
// CAVEAT — verify before relying on this: this is written against Uniswap V4 core's
// publicly documented `Swap` event and delta-sign convention (negative amount = token paid
// out of the pool to the trader, mirroring V3's convention) from written specification, not
// from a transaction this codebase has actually decoded and checked against a block explorer.
// Confirm both the event signature and the sign convention against the specific PoolManager
// deployment/version in use before trusting this for anything fund-affecting.
//
// Computing a pool's PoolId from its PoolKey (currency0/currency1/fee/tickSpacing/hooks)
// requires exactly matching Solidity's struct encoding — rather than risk getting that
// encoding subtly wrong here, this adapter takes a pre-computed `poolId` as config; look it
// up via the Uniswap V4 interface/subgraph for the specific pool being tracked.
//
// USD valuation caveat: this adapter values a trade using the pool's *other* currency amount
// directly as a USD proxy — correct only when that currency is a USD stablecoin. Converting
// a non-stable counter-asset (e.g. native ETH) to USD needs the Price/TWAP Oracle
// (KEEPER_SERVICE_DESIGN.md §4.3, build order step 2) — not yet wired in here.
"use strict";
const { ethers } = require("ethers");

const POOL_MANAGER_ABI = [
  "event Swap(bytes32 indexed id, address indexed sender, int128 amount0, int128 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick, uint24 fee)",
];

/// @param config.poolManagerAddress The PoolManager singleton's address on this chain.
/// @param config.poolId The specific pool's PoolId (bytes32), pre-computed off-chain.
/// @param config.campaignTokenIsCurrency0 Whether the campaign token is currency0 in this
///   pool's PoolKey — determines which of amount0/amount1 to read as the campaign-token leg.
async function fetchTrades(provider, { fromBlock, toBlock, poolManagerAddress, poolId, campaignTokenIsCurrency0 }) {
  const poolManager = new ethers.Contract(poolManagerAddress, POOL_MANAGER_ABI, provider);
  const logs = await poolManager.queryFilter(poolManager.filters.Swap(poolId), fromBlock, toBlock);

  const trades = [];
  for (const log of logs) {
    const { sender, amount0, amount1 } = log.args;
    const campaignTokenDelta = campaignTokenIsCurrency0 ? amount0 : amount1;
    const counterDelta = campaignTokenIsCurrency0 ? amount1 : amount0;

    // Negative delta = pool paid this currency out to the trader (V3/V4 convention).
    const side = campaignTokenDelta < 0n ? "buy" : "sell";
    const usdValue = Number(ethers.formatUnits(counterDelta < 0n ? -counterDelta : counterDelta, 18));

    const block = await provider.getBlock(log.blockNumber);
    trades.push({
      wallet: sender,
      side,
      usdValue,
      blockNumber: log.blockNumber,
      blockTime: new Date(block.timestamp * 1000),
      txHash: log.transactionHash,
      logIndex: log.index,
    });
  }
  return trades;
}

module.exports = { fetchTrades };
