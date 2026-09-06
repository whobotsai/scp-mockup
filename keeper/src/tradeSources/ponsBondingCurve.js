// Trade source adapter for a token's pre-graduation venue: its Pons.family bonding curve
// (PRD.md §2.2, §3.2). NOT IMPLEMENTED.
//
// This is a real, blocking gap, not an oversight: Pons.family's bonding-curve contract's
// actual ABI/event signatures aren't available to this codebase (no verified interface docs
// or a reference deployment to read from) — inventing one and shipping it as if it were real
// would silently corrupt every net-buy-volume figure computed from it, which is exactly the
// kind of thing that turns into an unfair or wrong payout (PRD §2.2's whole point). That's
// worse than an honest gap.
//
// To unblock this: Pons.family's bonding-curve contract's ABI (or verified source) and a
// reference deployment address (mainnet or testnet) to confirm event decoding against.
// Once that's available, this file should mirror uniswapV4.js's shape exactly:
// `fetchTrades(provider, { fromBlock, toBlock, ...venueSpecificConfig })` returning the same
// normalized TradeEvent[] (see ./types.js) so index.js doesn't need to change.
"use strict";

async function fetchTrades() {
  throw new Error(
    "ponsBondingCurve adapter is not implemented — Pons.family's bonding-curve contract ABI " +
      "is not yet available to this codebase. See the comment at the top of this file."
  );
}

module.exports = { fetchTrades };
