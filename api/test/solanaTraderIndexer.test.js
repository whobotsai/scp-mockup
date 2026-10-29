"use strict";
const { test, assertEqual, summary } = require("./helpers/harness");
const {
  PAGE_SIZE,
  timeFrameForWindowSeconds,
  fetchTopTraders,
  computeNetBuyVolumeFromTraders,
  netBuyVolumeForSolanaToken,
} = require("../src/solanaTraderIndexer");

// Same tests as keeper/test/solanaTraderIndexer.test.js -- this is a direct port of that
// module (see this file's own header).

test("timeFrameForWindowSeconds: maps H24/D7/D30 seconds to Birdeye's time_frame strings", () => {
  assertEqual(timeFrameForWindowSeconds(24 * 60 * 60), "24h");
  assertEqual(timeFrameForWindowSeconds(7 * 24 * 60 * 60), "7d");
  assertEqual(timeFrameForWindowSeconds(30 * 24 * 60 * 60), "30d");
});

test("timeFrameForWindowSeconds: throws on an unsupported value", () => {
  let threw = false;
  try {
    timeFrameForWindowSeconds(3600);
  } catch (e) {
    threw = true;
  }
  assertEqual(threw, true);
});

test("computeNetBuyVolumeFromTraders: net-buy is volumeBuyUSD minus volumeSellUSD, net-negative omitted", () => {
  const traders = [
    { owner: "WalletA", volumeBuyUSD: "1000", volumeSellUSD: "200" },
    { owner: "WalletB", volumeBuyUSD: "100", volumeSellUSD: "900" },
  ];
  const result = computeNetBuyVolumeFromTraders(traders);
  assertEqual(result.length, 1);
  assertEqual(result[0].wallet, "WalletA");
  assertEqual(result[0].score, 800);
});

const realFetch = global.fetch;
const realApiKey = process.env.BIRDEYE_API_KEY;

function mockPaginatedFetch(pages) {
  let call = 0;
  global.fetch = async () => {
    const items = pages[call] || [];
    call += 1;
    return { ok: true, status: 200, json: async () => ({ success: true, data: { items } }) };
  };
}
function restoreMocks() {
  global.fetch = realFetch;
  process.env.BIRDEYE_API_KEY = realApiKey;
}

test("fetchTopTraders: stops once an empty page is returned", async () => {
  process.env.BIRDEYE_API_KEY = "test-key";
  const page0 = Array.from({ length: PAGE_SIZE }, (_, i) => ({ owner: `W${i}`, volumeBuyUSD: "10", volumeSellUSD: "0" }));
  mockPaginatedFetch([page0, []]);
  try {
    const traders = await fetchTopTraders("MintXYZ", "24h", 15);
    assertEqual(traders.length, PAGE_SIZE);
  } finally {
    restoreMocks();
  }
});

test("netBuyVolumeForSolanaToken: fetches, computes net-buy, and caps at leaderboardSize", async () => {
  process.env.BIRDEYE_API_KEY = "test-key";
  const page0 = [
    { owner: "Whale", volumeBuyUSD: "5000", volumeSellUSD: "100" },
    { owner: "SmallBuyer", volumeBuyUSD: "200", volumeSellUSD: "0" },
  ];
  mockPaginatedFetch([page0, []]);
  try {
    const leaderboard = await netBuyVolumeForSolanaToken("MintXYZ", 24 * 60 * 60, 1);
    assertEqual(leaderboard.length, 1);
    assertEqual(leaderboard[0].wallet, "Whale");
  } finally {
    restoreMocks();
  }
});

summary();
