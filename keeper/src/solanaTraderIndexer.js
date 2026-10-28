// Solana counterpart of tradeIndexer.js + volumeAggregator.js's combined job (per-wallet
// net-buy volume for the SHO leaderboard), but built entirely on Birdeye's Token - Top
// Traders API (https://public-api.birdeye.so/defi/v2/tokens/top_traders) rather than our own
// raw-transaction indexing. This replaces an earlier plan to use Helius's "Enhanced
// Transactions" API: that API only answers "what did wallet X do," not "which wallets traded
// token Y" -- it would have needed its own wallet-discovery step on top (e.g. scanning the
// pool's own swap signatures), putting us back in the business of parsing raw Solana
// instructions. Birdeye's top_traders endpoint already does both discovery and buy/sell
// aggregation in one call, per the official API reference (confirmed directly from Birdeye's
// docs, not guessed): response items carry `owner`, `volumeBuyUSD`, `volumeSellUSD` (among
// other fields), so net-buy USD = volumeBuyUSD - volumeSellUSD needs no further computation.
//
// Caveat shared with solanaPriceSampler.js: this sandbox's egress policy blocks
// public-api.birdeye.so, so this has never been called against the real API -- only
// unit-tested against a mocked fetch (see test/solanaTraderIndexer.test.js). The response
// field names above come from Birdeye's official reference page; verify a live response
// shape before trusting this against mainnet funds, the same standing caveat every
// external-API module in this session carries.
"use strict";

const BIRDEYE_TOP_TRADERS_URL = "https://public-api.birdeye.so/defi/v2/tokens/top_traders";

// Birdeye's own documented constraints (not a choice we made): `limit` must be 1-10, and
// `offset + limit <= 10000`. So fetching more than 10 traders means paginating multiple
// requests -- up to 50 requests for SHO's largest leaderboardSize option (500).
const PAGE_SIZE = 10;
const MAX_OFFSET_PLUS_LIMIT = 10000;

// Mirrors abis/solana.js::WINDOW_SECONDS's LeaderboardWindow ordering (H24/D7/D30), mapped to
// Birdeye's `time_frame` enum values for the same windows.
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

/// Paginates through Birdeye's top_traders, sorted by gross USD volume (sort_by=volume_usd) --
/// not net-buy, since Birdeye has no "net buy" sort option. This is a deliberate approximation:
/// a wallet with large net buying also tends to have large gross volume, so ranking by gross
/// volume first and computing net-buy after is a reasonable proxy, but it can in principle miss
/// a net-heavy buyer whose gross volume happens to rank just outside the fetched page window.
/// Stops early (and returns whatever was fetched so far, not an error) on a failed page or an
/// empty page, matching this codebase's "partial/missing data isn't an error" posture elsewhere
/// (priceSampler.js, solanaPriceSampler.js).
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

/// Pure function, independently unit-testable: given a page of Birdeye trader items, computes
/// each wallet's net-buy USD (volumeBuyUSD - volumeSellUSD) and returns the same
/// [{wallet, score}] shape volumeAggregator.js::computeNetBuyVolume produces for EVM, so
/// anything downstream (rewardAllocator.js) can treat both chains identically. Net-negative
/// wallets are omitted, not floored to zero, matching computeNetBuyVolume's own rule.
function computeNetBuyVolumeFromTraders(traders) {
  return traders
    .map((t) => ({ wallet: t.owner, score: Number(t.volumeBuyUSD) - Number(t.volumeSellUSD) }))
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score);
}

/// DB-free, chain-specific equivalent of volumeAggregator.js::netBuyVolumeForCampaign: no
/// local trades table is needed for Solana at all, since Birdeye already aggregates buy/sell
/// volume server-side -- this function's only job is pagination + the net-buy transform above.
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
