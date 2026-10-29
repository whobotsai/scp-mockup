// Direct port of keeper/src/solanaTraderIndexer.js -- same "each package independently
// deployable, duplicate the small stuff" convention solanaAbis.js's own header describes.
// Computes a Solana SHO campaign's net-buy-volume leaderboard via Birdeye's Token - Top
// Traders API (GET /defi/v2/tokens/top_traders) rather than a local trades table -- see that
// module's own header for the full rationale (replaces an earlier Helius-based plan; Birdeye
// does both wallet discovery and buy/sell aggregation in one call).
//
// Needed here, not just in the keeper, because this API's own leaderboard-serving routes
// (shoRoutes.js's GET /sho/campaigns/:address and .../leaderboard) previously fell through to
// db.shoLeaderboard, which queries sho_trades -- a table nothing ever writes Solana rows into,
// so a Solana campaign's leaderboard silently rendered empty even after the keeper itself
// started computing one internally for milestone-crossing decisions.
//
// Caveat shared with every other Birdeye/DexScreener module in this project: this sandbox's
// egress policy blocks public-api.birdeye.so, so this has never been called against the real
// API -- only unit-tested against a mocked fetch (see test/solanaTraderIndexer.test.js).
"use strict";

const BIRDEYE_TOP_TRADERS_URL = "https://public-api.birdeye.so/defi/v2/tokens/top_traders";

const PAGE_SIZE = 10;
const MAX_OFFSET_PLUS_LIMIT = 10000;

const TIME_FRAME_BY_WINDOW_SECONDS = {
  [24 * 60 * 60]: "24h",
  [7 * 24 * 60 * 60]: "7d",
  [30 * 24 * 60 * 60]: "30d",
};

function timeFrameForWindowSeconds(windowSeconds) {
  const timeFrame = TIME_FRAME_BY_WINDOW_SECONDS[windowSeconds];
  if (!timeFrame) {
    throw new Error(`timeFrameForWindowSeconds: unsupported windowSeconds ${windowSeconds} (expected 86400, 604800, or 2592000)`);
  }
  return timeFrame;
}

async function fetchTopTradersPage(mint, { timeFrame, offset }) {
  const apiKey = process.env.BIRDEYE_API_KEY;
  if (!apiKey) throw new Error("BIRDEYE_API_KEY not set");

  const url = `${BIRDEYE_TOP_TRADERS_URL}?address=${encodeURIComponent(mint)}&time_frame=${timeFrame}&sort_type=desc&sort_by=volume_usd&offset=${offset}&limit=${PAGE_SIZE}`;
  const res = await fetch(url, { headers: { "X-API-KEY": apiKey, "x-chain": "solana" } });
  if (!res.ok) throw new Error(`Birdeye top_traders responded ${res.status} for ${mint}`);

  const body = await res.json();
  if (!body.success) throw new Error(`Birdeye top_traders returned success=false for ${mint}`);
  return body.data.items || [];
}

async function fetchTopTraders(mint, timeFrame, maxCount) {
  const traders = [];
  let offset = 0;
  while (traders.length < maxCount && offset < MAX_OFFSET_PLUS_LIMIT) {
    let page;
    try {
      page = await fetchTopTradersPage(mint, { timeFrame, offset });
    } catch (e) {
      console.error(`[solanaTraderIndexer] Birdeye top_traders page fetch failed for ${mint} at offset ${offset}:`, e.message);
      break;
    }
    if (page.length === 0) break;
    traders.push(...page);
    offset += PAGE_SIZE;
  }
  return traders;
}

function computeNetBuyVolumeFromTraders(traders) {
  return traders
    .map((t) => ({ wallet: t.owner, score: Number(t.volumeBuyUSD) - Number(t.volumeSellUSD) }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score);
}

async function netBuyVolumeForSolanaToken(mint, windowSeconds, leaderboardSize) {
  const timeFrame = timeFrameForWindowSeconds(windowSeconds);
  const traders = await fetchTopTraders(mint, timeFrame, leaderboardSize);
  return computeNetBuyVolumeFromTraders(traders).slice(0, leaderboardSize);
}

module.exports = {
  BIRDEYE_TOP_TRADERS_URL,
  PAGE_SIZE,
  timeFrameForWindowSeconds,
  fetchTopTraders,
  computeNetBuyVolumeFromTraders,
  netBuyVolumeForSolanaToken,
};
