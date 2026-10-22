"use strict";
const { test, assertEqual, summary } = require("./helpers/harness");
const db = require("../src/db");
const { pickBestPair, sampleSolanaPrice } = require("../src/solanaPriceSampler");

// pickBestPair -- pure function, no mocking needed.

test("pickBestPair: null with no pairs at all", () => {
  assertEqual(pickBestPair(null), null);
  assertEqual(pickBestPair([]), null);
});

test("pickBestPair: ignores non-Solana pairs entirely", () => {
  const pairs = [{ chainId: "ethereum", liquidity: { usd: 999999 }, priceUsd: "1" }];
  assertEqual(pickBestPair(pairs), null);
});

test("pickBestPair: picks the Solana pair with the most USD liquidity", () => {
  const thin = { chainId: "solana", dexId: "raydium", pairAddress: "thin", liquidity: { usd: 500 }, priceUsd: "0.01" };
  const deep = { chainId: "solana", dexId: "pumpfun", pairAddress: "deep", liquidity: { usd: 50000 }, priceUsd: "0.02" };
  const best = pickBestPair([thin, deep]);
  assertEqual(best.pairAddress, "deep");
});

test("pickBestPair: a pair with no liquidity field at all counts as zero, not a crash", () => {
  const noLiq = { chainId: "solana", dexId: "raydium", pairAddress: "a", priceUsd: "0.01" };
  const hasLiq = { chainId: "solana", dexId: "raydium", pairAddress: "b", liquidity: { usd: 1 }, priceUsd: "0.02" };
  assertEqual(pickBestPair([noLiq, hasLiq]).pairAddress, "b");
});

// sampleSolanaPrice -- mocks both global.fetch (DexScreener) and db's write methods, since
// neither a real network call nor a real Postgres instance is available in this sandbox (see
// solanaPriceSampler.js's own header).

const realFetch = global.fetch;
const realUpsertTokenPool = db.upsertTokenPool;
const realInsertPriceSample = db.insertPriceSample;

function mockFetchJson(status, body) {
  global.fetch = async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
}
function restoreMocks() {
  global.fetch = realFetch;
  db.upsertTokenPool = realUpsertTokenPool;
  db.insertPriceSample = realInsertPriceSample;
}

test("sampleSolanaPrice: on a good DexScreener response, registers the pool and records a sample", async () => {
  const upsertCalls = [];
  const sampleCalls = [];
  db.upsertTokenPool = async (token, cfg) => upsertCalls.push({ token, cfg });
  db.insertPriceSample = async (token, venue, priceUsd, sampledAt) => sampleCalls.push({ token, venue, priceUsd, sampledAt });
  mockFetchJson(200, {
    pairs: [{ chainId: "solana", dexId: "pumpfun", pairAddress: "Pair111", liquidity: { usd: 10000 }, priceUsd: "0.00042" }],
  });

  try {
    await sampleSolanaPrice("Mint111");
    assertEqual(upsertCalls.length, 1);
    assertEqual(upsertCalls[0].token, "Mint111");
    assertEqual(upsertCalls[0].cfg.venue, "pumpfun");
    assertEqual(upsertCalls[0].cfg.pairAddress, "Pair111");
    assertEqual(sampleCalls.length, 1);
    assertEqual(sampleCalls[0].token, "Mint111");
    assertEqual(sampleCalls[0].venue, "dexscreener:pumpfun");
    assertEqual(sampleCalls[0].priceUsd, 0.00042);
  } finally {
    restoreMocks();
  }
});

test("sampleSolanaPrice: no pairs found -- logs and returns, never writes to the DB", async () => {
  const upsertCalls = [];
  const sampleCalls = [];
  db.upsertTokenPool = async (...args) => upsertCalls.push(args);
  db.insertPriceSample = async (...args) => sampleCalls.push(args);
  mockFetchJson(200, { pairs: [] });

  try {
    await sampleSolanaPrice("MintWithNoPair");
    assertEqual(upsertCalls.length, 0);
    assertEqual(sampleCalls.length, 0);
  } finally {
    restoreMocks();
  }
});

test("sampleSolanaPrice: a non-OK HTTP response is caught, not thrown -- one bad token can't crash the tick loop", async () => {
  const sampleCalls = [];
  db.insertPriceSample = async (...args) => sampleCalls.push(args);
  mockFetchJson(500, {});

  try {
    await sampleSolanaPrice("MintThatErrors"); // must not throw
    assertEqual(sampleCalls.length, 0);
  } finally {
    restoreMocks();
  }
});

test("sampleSolanaPrice: a non-numeric priceUsd is treated as no sample, not NaN written to the DB", async () => {
  const sampleCalls = [];
  const upsertCalls = [];
  db.upsertTokenPool = async (...args) => upsertCalls.push(args);
  db.insertPriceSample = async (...args) => sampleCalls.push(args);
  mockFetchJson(200, {
    pairs: [{ chainId: "solana", dexId: "raydium", pairAddress: "P", liquidity: { usd: 1000 }, priceUsd: "not-a-number" }],
  });

  try {
    await sampleSolanaPrice("MintBadPrice");
    assertEqual(sampleCalls.length, 0);
  } finally {
    restoreMocks();
  }
});

summary();
