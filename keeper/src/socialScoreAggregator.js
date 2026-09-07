// KEEPER_SERVICE_DESIGN.md §4.5's SSO half of the shared Leaderboard & Milestone/Epoch
// Engine input: each qualifying account's summed post scores for the epoch (PRD §12.2).
// Mirrors volumeAggregator.js's shape exactly ([{wallet, score}]) so rewardAllocator.js's
// allocateProportional works unmodified for either campaign type.
"use strict";
const { MAX_COUNTED_POSTS_PER_ACCOUNT_PER_EPOCH } = require("./abis/sso");
const db = require("./db");

/// Pure function: no I/O.
/// @param posts [{wallet, score}] every already-gated qualifying post (registered account,
///   keyword match, inside the epoch window, clears the age/follower minimums -- all applied
///   in socialIndexer.js before a post ever reaches sso_posts) for one campaign's one epoch.
/// @returns [{wallet, score}], sorted descending by score. An account's score sums only its
///   best MAX_COUNTED_POSTS_PER_ACCOUNT_PER_EPOCH posts by score (PRD §12.2's spam-flooding
///   cap), not every qualifying post it made that epoch.
function computeEpochScores(posts) {
  const byWallet = new Map();
  for (const p of posts) {
    const list = byWallet.get(p.wallet) || [];
    list.push(Number(p.score));
    byWallet.set(p.wallet, list);
  }

  return Array.from(byWallet.entries())
    .map(([wallet, scores]) => {
      const best = scores.sort((a, b) => b - a).slice(0, MAX_COUNTED_POSTS_PER_ACCOUNT_PER_EPOCH);
      return { wallet, score: best.reduce((sum, s) => sum + s, 0) };
    })
    .sort((a, b) => b.score - a.score);
}

/// DB-backed wrapper: pulls every post already stored for this campaign/epoch and applies
/// the pure function above.
async function epochScoresForCampaign(campaignAddress, epochIndex) {
  const posts = await db.postsForEpoch(campaignAddress, epochIndex);
  return computeEpochScores(posts);
}

module.exports = { computeEpochScores, epochScoresForCampaign };
