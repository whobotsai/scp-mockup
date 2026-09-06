"use strict";
const { test, assertEqual, summary } = require("./helpers/harness");
const { timeWeightedAveragePrice, WINDOW_MS } = require("../src/twapOracle");

const NOW = new Date("2026-01-01T01:00:00.000Z");

test("returns null with no samples", () => {
  assertEqual(timeWeightedAveragePrice([], NOW), null);
});

test("returns null when sample history spans less than the full window", () => {
  const samples = [{ price_usd: "1.0", sampled_at: new Date(NOW.getTime() - 10 * 60 * 1000).toISOString() }];
  assertEqual(timeWeightedAveragePrice(samples, NOW), null);
});

test("a constant price over the full window returns exactly that price", () => {
  const samples = [];
  for (let i = 0; i <= 30; i++) {
    samples.push({ price_usd: "2.5", sampled_at: new Date(NOW.getTime() - (30 - i) * 60 * 1000).toISOString() });
  }
  const result = timeWeightedAveragePrice(samples, NOW);
  if (Math.abs(result - 2.5) > 1e-9) throw new Error(`expected ~2.5, got ${result}`);
});

test("weights by time held, not by sample count -- a late spike barely moves it", () => {
  // Price 1.0 for the first 29 minutes, then a huge one-tick spike to 100 for the last minute.
  const samples = [
    { price_usd: "1.0", sampled_at: new Date(NOW.getTime() - 30 * 60 * 1000).toISOString() },
    { price_usd: "100", sampled_at: new Date(NOW.getTime() - 1 * 60 * 1000).toISOString() },
  ];
  const result = timeWeightedAveragePrice(samples, NOW);
  // Expected: 1.0 held for 29/30 of the window, 100 held for 1/30.
  const expected = (1.0 * 29 + 100 * 1) / 30;
  if (Math.abs(result - expected) > 1e-6) throw new Error(`expected ~${expected}, got ${result}`);
  if (result > 10) throw new Error("a single late spike should not dominate a real time-weighted average");
});

test("a sample from before the window only contributes its in-window portion", () => {
  const samples = [
    { price_usd: "1.0", sampled_at: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString() }, // 1h before, outside window
    { price_usd: "3.0", sampled_at: new Date(NOW.getTime() - 15 * 60 * 1000).toISOString() }, // 15 min ago
  ];
  const result = timeWeightedAveragePrice(samples, NOW);
  // First sample only counts for the first 15 min of the 30-min window (clipped to windowStart).
  const expected = (1.0 * 15 + 3.0 * 15) / 30;
  if (Math.abs(result - expected) > 1e-6) throw new Error(`expected ~${expected}, got ${result}`);
});

test("WINDOW_MS is exactly 30 minutes", () => {
  assertEqual(WINDOW_MS, 30 * 60 * 1000);
});

summary();
