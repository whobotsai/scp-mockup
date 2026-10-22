// Solana counterpart of priceSampler.js/twapOracle.js's price-sourcing half -- but instead of
// reading a pool's on-chain reserves directly (the EVM path, since a Uniswap V2/V4 pair IS a
// known, fixed contract this codebase understands), this calls DexScreener's public API,
// which auto-discovers whatever Solana DEX/launchpad (Raydium, pump.fun, ...) a mint actually
// trades on. This was a deliberate choice (see docs/MAINNET_CHECKLIST.md Phase 2): Solana has
// no single dominant AMM the way the EVM side settled on Uniswap, and parsing every possible
// venue's swap instructions ourselves just to get a price is more work than the simpler win
// of letting an aggregator that already does that do it.
//
// twapOracle.js's own time-weighted-average computation is untouched and fully reused here --
// it already operates on {price_usd, sampled_at} rows regardless of what chain/venue
// produced them. This module only adds a different *source* of samples.
//
// No API key, no network allowlisting needed (DexScreener's public API is free, unauthenticated,
// rate-limited) -- but this sandbox's own egress policy blocks api.dexscreener.com, so this has
// never actually been called successfully; only unit-tested against a mocked fetch (see
// test/solanaPriceSampler.test.js). Verify the real response shape against a live call before
// trusting this against mainnet funds -- DexScreener's schema has changed before and isn't
// contractually stable the way an on-chain account layout is.
"use strict";
const db = require("./db");

const DEXSCREENER_TOKENS_URL = "https://api.dexscreener.com/latest/dex/tokens";

async function fetchDexScreenerPairs(mint) {
  const res = await fetch(`${DEXSCREENER_TOKENS_URL}/${mint}`);
  if (!res.ok) throw new Error(`DexScreener responded ${res.status} for ${mint}`);
  const body = await res.json();
  return body.pairs || [];
}

/// Picks the Solana pair with the most USD liquidity -- the most liquid pool's quoted price
/// is the hardest to move with a small trade, so it's the least gameable single source among
/// whatever pairs DexScreener happens to have indexed for this mint. Pure function, no I/O,
/// so it's directly unit-testable against fixture data shaped like DexScreener's real response.
function pickBestPair(pairs) {
  if (!pairs || pairs.length === 0) return null;
  const solanaPairs = pairs.filter((p) => p.chainId === "solana");
  if (solanaPairs.length === 0) return null;
  return solanaPairs.reduce((best, p) => {
    const liq = Number((p.liquidity && p.liquidity.usd) || 0);
    const bestLiq = best ? Number((best.liquidity && best.liquidity.usd) || 0) : -1;
    return liq > bestLiq ? p : best;
  }, null);
}

/// Samples one price point for `token` (a Solana mint, base58) and, the first time a pair is
/// found for it, auto-registers it into `token_pools` -- unlike the EVM path
/// (scripts/register-token-pool.js, a manual one-off a human has to run), DexScreener's own
/// lookup already tells us which pool/venue a token trades on, so there's no reason to make a
/// human repeat that discovery for Solana. Logs and returns (doesn't throw) for every
/// "nothing to do yet" case -- no pair found, a non-numeric price -- matching this codebase's
/// existing posture (e.g. samplePrice/pollTradesForCampaign) of treating an unindexed/too-new
/// token as expected, not an error.
async function sampleSolanaPrice(token) {
  let pairs;
  try {
    pairs = await fetchDexScreenerPairs(token);
  } catch (e) {
    console.error(`[solanaPriceSampler] DexScreener fetch failed for ${token}:`, e.message);
    return;
  }

  const best = pickBestPair(pairs);
  if (!best) {
    console.log(`[solanaPriceSampler] no Solana DEX pair found yet for ${token} -- nothing to sample.`);
    return;
  }

  const priceUsd = Number(best.priceUsd);
  if (!Number.isFinite(priceUsd) || priceUsd <= 0) {
    console.error(`[solanaPriceSampler] DexScreener returned a non-numeric/zero priceUsd for ${token}: ${JSON.stringify(best.priceUsd)}`);
    return;
  }

  await db.upsertTokenPool(token, { venue: best.dexId, pairAddress: best.pairAddress });
  await db.insertPriceSample(token, `dexscreener:${best.dexId}`, priceUsd, new Date());
  console.log(`[solanaPriceSampler] ${token}: $${priceUsd} (${best.dexId}, pair ${best.pairAddress})`);
}

module.exports = { fetchDexScreenerPairs, pickBestPair, sampleSolanaPrice, DEXSCREENER_TOKENS_URL };
