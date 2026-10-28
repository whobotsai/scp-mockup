"use strict";
const { test, assertEqual, summary } = require("./helpers/harness");
const {
  PAGE_SIZE,
  timeFrameForWindowSeconds,
  fetchTopTraders,
  computeNetBuyVolumeFromTraders,
  netBuyVolumeForSolanaToken,
} = require("../src/solanaTraderIndexer");

// timeFrameForWindowSeconds -- pure function, no mocking needed.

test("timeFrameForWindowSeconds: maps H24/D7/D30 seconds to Birdeye's time_frame strings", () => {
  assertEqual(timeFrameForWindowSeconds(24 * 60 * 60), "24h");
  assertEqual(timeFrameForWindowSeconds(7 * 24 * 60 * 60), "7d");
  assertEqual(timeFrameForWindowSeconds(30 * 24 * 60 * 60), "30d");
});

test("timeFrameForWindowSeconds: throws on an unsupported value rather than silently misquerying Birdeye", () => {
  let threw = false;
  try {
    timeFrameForWindowSeconds(3600);
  } catch (e) {
    threw = true;
  }
  assertEqual(threw, true);
});

// computeNetBuyVolumeFromTraders -- pure function, no mocking needed.

test("computeNetBuyVolumeFromTraders: net-buy is volumeBuyUSD minus volumeSellUSD", () => {
  const traders = [
    { owner: "WalletA", volumeBuyUSD: "1000", volumeSellUSD: "200" },
    { owner: "WalletB", volumeBuyUSD: "500", volumeSellUSD: "500" },
  ];
  const result = computeNetBuyVolumeFromTraders(traders);
  assertEqual(result.length, 1);
  assertEqual(result[0].wallet, "WalletA");
  assertEqual(result[0].score, 800);
});

test("computeNetBuyVolumeFromTraders: a net-negative or net-zero wallet is omitted, not floored to zero", () => {
  const traders = [
    { owner: "NetSeller", volumeBuyUSD: "100", volumeSellUSD: "900" },
    { owner: "Breakeven", volumeBuyUSD: "300", volumeSellUSD: "300" },
  ];
  assertEqual(computeNetBuyVolumeFromTraders(traders).length, 0);
});

test("computeNetBuyVolumeFromTraders: sorts descending by net-buy score", () => {
  const traders = [
    { owner: "Small", volumeBuyUSD: "150", volumeSellUSD: "50" },
    { owner: "Big", volumeBuyUSD: "9000", volumeSellUSD: "1000" },
  ];
  const result = computeNetBuyVolumeFromTraders(traders);
  assertEqual(result[0].wallet, "Big");
  assertEqual(result[1].wallet, "Small");
});

// fetchTopTraders / netBuyVolumeForSolanaToken -- mock global.fetch, since neither a real
// network call nor a Birdeye API key is available in this sandbox (see the module's own
// header comment).

const realFetch = global.fetch;
const realApiKey = process.env.BIRDEYE_API_KEY;

function mockPaginatedFetch(pages) {
  let call = 0;
  global.fetch = async () => {
    const items = pages[call] || [];
    call += 1;
    return { ok: true, status: 200, json: async () => ({ success: true, data: { items } }) };
  };
  return () => call;
}
function restoreMocks() {
  global.fetch = realFetch;
  process.env.BIRDEYE_API_KEY = realApiKey;
}

test("fetchTopTraders: stops once an empty page is returned, without requesting past it", async () => {
  process.env.BIRDEYE_API_KEY = "test-key";
  const page0 = Array.from({ length: PAGE_SIZE }, (_, i) => ({ owner: `W${i}`, volumeBuyUSD: "10", volumeSellUSD: "0" }));
  const getCallCount = mockPaginatedFetch([page0, []]);

  try {
    const traders = await fetchTopTraders("MintXYZ", "24h", 15);
    assertEqual(traders.length, PAGE_SIZE);
    assertEqual(getCallCount(), 2);
  } finally {
    restoreMocks();
  }
});

test("fetchTopTraders: stops paginating once maxCount is reached", async () => {
  process.env.BIRDEYE_API_KEY = "test-key";
  const page0 = Array.from({ length: PAGE_SIZE }, (_, i) => ({ owner: `A${i}`, volumeBuyUSD: "10", volumeSellUSD: "0" }));
  const page1 = Array.from({ length: PAGE_SIZE }, (_, i) => ({ owner: `B${i}`, volumeBuyUSD: "10", volumeSellUSD: "0" }));
  const getCallCount = mockPaginatedFetch([page0, page1]);

  try {
    const traders = await fetchTopTraders("MintXYZ", "24h", 12);
    assertEqual(traders.length, 20);
    assertEqual(getCallCount(), 2);
  } finally {
    restoreMocks();
  }
});

test("fetchTopTraders: a failed page is caught, returning whatever was fetched so far rather than throwing", async () => {
  process.env.BIRDEYE_API_KEY = "test-key";
  let call = 0;
  global.fetch = async () => {
    call += 1;
    if (call === 1) {
      const items = Array.from({ length: PAGE_SIZE }, (_, i) => ({ owner: `W${i}`, volumeBuyUSD: "10", volumeSellUSD: "0" }));
      return { ok: true, status: 200, json: async () => ({ success: true, data: { items } }) };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };

  try {
    const traders = await fetchTopTraders("MintXYZ", "24h", 100); // must not throw
    assertEqual(traders.length, PAGE_SIZE);
  } finally {
    restoreMocks();
  }
});

test("netBuyVolumeForSolanaToken: fetches, computes net-buy, and caps the result at leaderboardSize", async () => {
  process.env.BIRDEYE_API_KEY = "test-key";
  const page0 = [
    { owner: "Whale", volumeBuyUSD: "5000", volumeSellUSD: "100" },
    { owner: "SmallBuyer", volumeBuyUSD: "200", volumeSellUSD: "0" },
    { owner: "NetSeller", volumeBuyUSD: "50", volumeSellUSD: "900" },
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
