// Proportional reward allocation for a milestone snapshot (PRD section 2.3: "computes each
// eligible trader's proportional share of that tier's reward"). Pure function -- integer
// (BigInt) math throughout, since on-chain amounts are wei-precision uint256 and floating
// point would silently lose or misallocate dust.
"use strict";

/// @param leaderboard [{wallet, netBuyUsd}], already sorted/limited to the top N -- this
///   function doesn't re-rank or truncate, it only allocates.
/// @param totalReward BigInt -- the milestone's total reward pool, in the reward token's
///   smallest unit (wei for ETH/most ERC20s).
/// @returns [{account, amount: BigInt}] summing to exactly totalReward -- any rounding
///   remainder goes to the top-ranked entry, so the total distributed never exceeds the pool
///   (over-allocating would mean the last claimant's transaction reverts for insufficient
///   balance, which is worse than one wallet getting a few extra wei of dust).
function allocateProportional(leaderboard, totalReward) {
  if (leaderboard.length === 0) return [];

  // netBuyUsd is a float; scale to an integer weight for exact BigInt division. 1e6 gives
  // six decimal places of precision on the USD figure, plenty for a proportional split.
  const weights = leaderboard.map((e) => BigInt(Math.round(e.netBuyUsd * 1e6)));
  const totalWeight = weights.reduce((a, b) => a + b, 0n);
  if (totalWeight === 0n) return [];

  const allocations = leaderboard.map((e, i) => ({
    account: e.wallet,
    amount: (weights[i] * totalReward) / totalWeight,
  }));

  const distributed = allocations.reduce((sum, a) => sum + a.amount, 0n);
  const remainder = totalReward - distributed;
  if (remainder > 0n) allocations[0].amount += remainder;

  return allocations;
}

module.exports = { allocateProportional };
