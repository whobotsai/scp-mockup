"use strict";
const { test, assertEqual, summary } = require("./helpers/harness");
const { timeWeightedAveragePrice, TWAP_WINDOW_MS, daysLeft } = require("../src/shared");

// Same tests as keeper/test/twapOracle.test.js's core cases -- this is a direct port (see
// shared.js's own header), so a displayed mcap always matches what the keeper actually used
// to decide a milestone crossing.
test("returns null when sample history spans less than the full window", () => {
  const now = new Date("2026-01-01T01:00:00Z");
  const samples = [{ price_usd: "1.0", sampled_at: new Date(now.getTime() - 10 * 60 * 1000) }];
  assertEqual(timeWeightedAveragePrice(samples, now), null);
});

test("a constant price over the full window returns exactly that price", () => {
  const now = new Date("2026-01-01T01:00:00Z");
  const samples = [
    { price_usd: "2.5", sampled_at: new Date(now.getTime() - 30 * 60 * 1000) },
    { price_usd: "2.5", sampled_at: new Date(now.getTime() - 15 * 60 * 1000) },
    { price_usd: "2.5", sampled_at: new Date(now.getTime() - 1 * 60 * 1000) },
  ];
  assertEqual(timeWeightedAveragePrice(samples, now), 2.5);
});

test("weights by time held, not by sample count -- a late spike barely moves it", () => {
  // Same scenario/values as keeper/test/twapOracle.test.js's own proven case: price 1.0 for
  // the first 29 minutes, then a one-tick spike to 100 for the last minute.
  const now = new Date("2026-01-01T01:00:00Z");
  const samples = [
    { price_usd: "1.0", sampled_at: new Date(now.getTime() - 30 * 60 * 1000) },
    { price_usd: "100", sampled_at: new Date(now.getTime() - 1 * 60 * 1000) },
  ];
  const result = timeWeightedAveragePrice(samples, now);
  const expected = (1.0 * 29 + 100 * 1) / 30;
  if (Math.abs(result - expected) > 1e-6) throw new Error(`expected ~${expected}, got ${result}`);
  if (result > 10) throw new Error("a single late spike should not dominate a real time-weighted average");
});

test("WINDOW_MS is exactly 30 minutes", () => {
  assertEqual(TWAP_WINDOW_MS, 30 * 60 * 1000);
});

test("daysLeft: a campaign 10 days into a 30-day duration has 20 days left", () => {
  const createdAt = new Date(Date.now() - 10 * 86400 * 1000);
  assertEqual(daysLeft(createdAt, 30 * 86400), 20);
});

test("daysLeft: an expired campaign shows 0, never negative", () => {
  const createdAt = new Date(Date.now() - 40 * 86400 * 1000);
  assertEqual(daysLeft(createdAt, 30 * 86400), 0);
});

summary();
