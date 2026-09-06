// Trade source adapter for a Uniswap-V2-style pair (contracts/src/mocks/UniswapV2Pair.sol
// on testnet, or a real Uniswap V2 deployment elsewhere -- the event shape is identical
// either way). This is the venue actually used for testnet indexing right now (see
// ../../README.md's "Deliberate simplification" section) -- unlike uniswapV4.js, this one
// has been exercised against a real deployed pair, not just written from a spec.
//
// Correctness note: V2's Swap event's `sender` is whoever called the pair directly, which in
// real-world usage is almost always a router contract, not the actual trader -- attributing
// volume to `sender` would silently credit the router's address instead of the wallet that
// actually traded. This adapter uses the transaction's own `from` (the EOA that signed it)
// instead, which is correct whether a router was used or not.
"use strict";
const { ethers } = require("ethers");

const PAIR_ABI = [
  "event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)",
  "function token0() view returns (address)",
];

/// Pure function, independently unit-testable (see ../../test/uniswapV2.test.js): given one
/// Swap event's four amounts, decides buy/sell and the counter-asset's USD-proxy value.
/// The trader received the campaign token (campaignOut > 0) -> buy; gave it up
/// (campaignIn > 0) -> sell. Exactly one of the two is ever nonzero in a real V2 swap.
function classifySwap({ amount0In, amount1In, amount0Out, amount1Out }, campaignTokenIsToken0) {
  const campaignOut = campaignTokenIsToken0 ? amount0Out : amount1Out;
  const campaignIn = campaignTokenIsToken0 ? amount0In : amount1In;
  const counterOut = campaignTokenIsToken0 ? amount1Out : amount0Out;
  const counterIn = campaignTokenIsToken0 ? amount1In : amount0In;

  if (campaignOut === 0n && campaignIn === 0n) {
    throw new Error("classifySwap: campaign token side of the swap is zero on both legs");
  }

  const side = campaignOut > 0n ? "buy" : "sell";
  const counterAmount = counterOut > 0n ? counterOut : counterIn;
  const usdValue = Number(ethers.formatUnits(counterAmount, 18));
  return { side, usdValue };
}

/// @param config.pairAddress The UniswapV2Pair's address.
/// @param config.campaignTokenIsToken0 Whether the campaign token is token0 in this pair.
async function fetchTrades(provider, { fromBlock, toBlock, pairAddress, campaignTokenIsToken0 }) {
  const pair = new ethers.Contract(pairAddress, PAIR_ABI, provider);
  const logs = await pair.queryFilter(pair.filters.Swap(), fromBlock, toBlock);

  const trades = [];
  for (const log of logs) {
    const { side, usdValue } = classifySwap(log.args, campaignTokenIsToken0);

    const [block, tx] = await Promise.all([
      provider.getBlock(log.blockNumber),
      provider.getTransaction(log.transactionHash),
    ]);

    trades.push({
      wallet: tx.from,
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

module.exports = { fetchTrades, classifySwap };
