"use strict";
const { test, assertEqual, summary } = require("./helpers/harness");
const { classifySwap } = require("../src/tradeSources/uniswapV2");

const ONE = 10n ** 18n; // 1 token at 18 decimals

test("campaign token is token0, trader buys it (receives token0)", () => {
  const result = classifySwap({ amount0In: 0n, amount1In: 100n * ONE, amount0Out: 50n * ONE, amount1Out: 0n }, true);
  assertEqual(result, { side: "buy", usdValue: 100 });
});

test("campaign token is token0, trader sells it (gives up token0)", () => {
  const result = classifySwap({ amount0In: 50n * ONE, amount1In: 0n, amount0Out: 0n, amount1Out: 90n * ONE }, true);
  assertEqual(result, { side: "sell", usdValue: 90 });
});

test("campaign token is token1, trader buys it (receives token1)", () => {
  const result = classifySwap({ amount0In: 100n * ONE, amount1In: 0n, amount0Out: 0n, amount1Out: 50n * ONE }, false);
  assertEqual(result, { side: "buy", usdValue: 100 });
});

test("campaign token is token1, trader sells it (gives up token1)", () => {
  const result = classifySwap({ amount0In: 0n, amount1In: 50n * ONE, amount0Out: 90n * ONE, amount1Out: 0n }, false);
  assertEqual(result, { side: "sell", usdValue: 90 });
});

test("getting campaignTokenIsToken0 backwards flips buy into sell -- exactly the risk documented in the adapter's file header", () => {
  const args = { amount0In: 0n, amount1In: 100n * ONE, amount0Out: 50n * ONE, amount1Out: 0n };
  const correct = classifySwap(args, true); // token0 is the campaign token -- correct
  const backwards = classifySwap(args, false); // same event, wrong flag
  if (correct.side === backwards.side) {
    throw new Error("expected getting the flag backwards to change the classification");
  }
});

test("throws if both campaign-token legs are zero (malformed/impossible swap)", () => {
  let threw = false;
  try {
    classifySwap({ amount0In: 0n, amount1In: 0n, amount0Out: 0n, amount1Out: 0n }, true);
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("expected classifySwap to throw");
});

summary();
