"use strict";
const { test, assertEqual, summary } = require("./helpers/harness");
const { computeNetBuyVolume } = require("../src/volumeAggregator");

test("net buyer ranks with their net figure", () => {
  const trades = [
    { wallet: "0xA", side: "buy", usd_value: "100" },
    { wallet: "0xA", side: "sell", usd_value: "30" },
  ];
  assertEqual(computeNetBuyVolume(trades), [{ wallet: "0xA", netBuyUsd: 70 }]);
});

test("net seller is excluded entirely, not floored to zero", () => {
  const trades = [
    { wallet: "0xA", side: "buy", usd_value: "10" },
    { wallet: "0xA", side: "sell", usd_value: "50" },
  ];
  assertEqual(computeNetBuyVolume(trades), []);
});

test("exact zero net is excluded (not > 0)", () => {
  const trades = [
    { wallet: "0xA", side: "buy", usd_value: "10" },
    { wallet: "0xA", side: "sell", usd_value: "10" },
  ];
  assertEqual(computeNetBuyVolume(trades), []);
});

test("sorted descending by net-buy volume, multiple wallets", () => {
  const trades = [
    { wallet: "0xA", side: "buy", usd_value: "50" },
    { wallet: "0xB", side: "buy", usd_value: "200" },
    { wallet: "0xC", side: "buy", usd_value: "120" },
    { wallet: "0xC", side: "sell", usd_value: "20" },
  ];
  assertEqual(computeNetBuyVolume(trades), [
    { wallet: "0xB", netBuyUsd: 200 },
    { wallet: "0xC", netBuyUsd: 100 },
    { wallet: "0xA", netBuyUsd: 50 },
  ]);
});

test("wash trading nets to the fee-only residual, not the full round-trip volume", () => {
  // A round-trip buy-then-sell of the same size should never look like real bought volume.
  const trades = [
    { wallet: "0xA", side: "buy", usd_value: "1000" },
    { wallet: "0xA", side: "sell", usd_value: "1000" },
  ];
  assertEqual(computeNetBuyVolume(trades), []);
});

test("empty input yields empty leaderboard", () => {
  assertEqual(computeNetBuyVolume([]), []);
});

summary();
