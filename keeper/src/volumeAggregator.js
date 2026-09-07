// KEEPER_SERVICE_DESIGN.md §4.2. Computes each wallet's net-buy volume (PRD §2.2: total
// USD-equivalent bought minus sold) over a campaign's trailing window. Wallets with a
// net-negative result are excluded entirely, not floored to zero — this is a ranking
// eligibility rule (PRD §2.2), so the function simply omits them rather than emitting an
// entry the caller has to filter again.
"use strict";
const db = require("./db");

/// Pure function: no I/O, so it's exhaustively unit-testable without a database.
/// @param trades [{wallet, side, usd_value}] — every trade in the campaign's current window.
/// @returns [{wallet, score}], sorted descending by score (net-buy USD here), net-negative
///   wallets omitted. `score` is the generic field name rewardAllocator.js's
///   allocateProportional expects — KEEPER_SERVICE_DESIGN.md §4.5 calls this leaderboard
///   shape shared between SHO and SSO ("allocate ... proportionally to their score"), so
///   socialScoreAggregator.js's SSO equivalent produces the exact same shape.
function computeNetBuyVolume(trades) {
  const byWallet = new Map();
  for (const t of trades) {
    const signed = t.side === "buy" ? Number(t.usd_value) : -Number(t.usd_value);
    byWallet.set(t.wallet, (byWallet.get(t.wallet) || 0) + signed);
  }

  return Array.from(byWallet.entries())
    .filter(([, score]) => score > 0)
    .map(([wallet, score]) => ({ wallet, score }))
    .sort((a, b) => b.score - a.score);
}

/// DB-backed wrapper: pulls the campaign's trailing-window trades and applies the pure
/// function above. `windowSeconds` comes from the campaign's own stored config.
async function netBuyVolumeForCampaign(campaignAddress, windowSeconds, asOf = new Date()) {
  const since = new Date(asOf.getTime() - windowSeconds * 1000);
  const trades = await db.tradesForWallet(campaignAddress, since);
  return computeNetBuyVolume(trades);
}

module.exports = { computeNetBuyVolume, netBuyVolumeForCampaign };
