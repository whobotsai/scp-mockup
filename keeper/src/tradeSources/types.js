// The normalized shape every trade-source adapter produces, regardless of venue —
// this is what makes the Volume Aggregator (KEEPER_SERVICE_DESIGN.md §4.2) venue-agnostic.
//
// A TradeEvent is:
//   {
//     wallet: string,        // the trader's address
//     side: 'buy' | 'sell',
//     usdValue: number,      // USD-equivalent value of this trade's non-campaign-token leg
//     blockNumber: number,
//     blockTime: Date,
//     txHash: string,
//     logIndex: number,
//   }
//
// An adapter implements:
//   fetchTrades(provider, { token, fromBlock, toBlock }) -> Promise<TradeEvent[]>
"use strict";
module.exports = {};
