// Performs one swap against a test pool (see setup-test-pool.js), generating a real Swap
// event on-chain for the keeper's Chain Indexer to pick up. Run it repeatedly (with
// different token/amount combos) to simulate ongoing trading activity for testing the
// Volume Aggregator against something real.
//
// Usage: node scripts/test-swap.js <pairAddress> <tokenInAddress> [amountIn=10]
"use strict";
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

function loadArtifact(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "build", `${name}.json`), "utf8"));
}

async function main() {
  const [pairAddress, tokenIn, amountInStr] = process.argv.slice(2);
  if (!pairAddress || !tokenIn) {
    console.error("Usage: node scripts/test-swap.js <pairAddress> <tokenInAddress> [amountIn=10]");
    process.exit(1);
  }

  const rpcUrl = process.env.RPC_URL;
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!rpcUrl || !privateKey) {
    console.error("Set RPC_URL and DEPLOYER_PRIVATE_KEY in .env first.");
    process.exit(1);
  }

  // Reuses the deployer wallet as "the trader" -- fine for a single-wallet demo. To simulate
  // a *different* trader's activity, point DEPLOYER_PRIVATE_KEY at a second funded wallet
  // that also holds some of tokenIn (mint it more via MockERC20.mint if needed).
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const trader = new ethers.Wallet(privateKey, provider);

  const amountIn = ethers.parseUnits(amountInStr || "10", 18);

  const pairArtifact = loadArtifact("UniswapV2Pair");
  const pair = new ethers.Contract(pairAddress, pairArtifact.abi, trader);
  const erc20Artifact = loadArtifact("MockERC20");
  const tokenInContract = new ethers.Contract(tokenIn, erc20Artifact.abi, trader);

  const token0 = await pair.token0();
  const isToken0 = tokenIn.toLowerCase() === token0.toLowerCase();
  const [reserve0, reserve1] = await pair.getReserves();
  const [reserveIn, reserveOut] = isToken0 ? [reserve0, reserve1] : [reserve1, reserve0];

  // Standard V2 getAmountOut formula (0.3% fee) -- must match UniswapV2Pair.sol's own swap()
  // check exactly, or this transaction reverts on the k-invariant assertion.
  const amountInWithFee = amountIn * 997n;
  const amountOut = (amountInWithFee * reserveOut) / (reserveIn * 1000n + amountInWithFee);

  console.log(
    `Swapping ${ethers.formatUnits(amountIn, 18)} of ${tokenIn} for ~${ethers.formatUnits(amountOut, 18)} of the other token...`
  );

  let tx = await tokenInContract.transfer(pairAddress, amountIn);
  await tx.wait();

  const [amount0Out, amount1Out] = isToken0 ? [0n, amountOut] : [amountOut, 0n];
  tx = await pair.swap(amount0Out, amount1Out, trader.address);
  const receipt = await tx.wait();
  console.log(`Swapped. Tx: ${receipt.hash}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
