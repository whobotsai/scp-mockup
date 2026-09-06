// Price/TWAP Oracle (KEEPER_SERVICE_DESIGN.md section 4.3). Computes a genuine time-weighted
// average price from sho_price_samples -- not a naive arithmetic mean -- then circulating
// mcap = twapPrice * live total supply (PRD section 5: "no netting-out of locked/vesting
// supply").
//
// PRD section 2.3: a milestone is confirmed crossed only once mcap has been *sustained* over
// threshold for the full 30-minute TWAP window, specifically to stop a single flash pump from
// falsely triggering it. A real time-weighted average bakes that requirement in directly: one
// spiky sample barely moves a 30-minute time-weighted average, whereas it would move a naive
// mean a lot if the sample series is short.
"use strict";

const WINDOW_MS = 30 * 60 * 1000;
// Below this much actual sample history, there's no real 30-minute window to average over --
// return "insufficient data" rather than a misleadingly early number computed from too short
// a span. This means a freshly-registered pool needs the keeper actually running for a real
// 30 minutes before its first valid TWAP -- the same "real time has to actually pass"
// constraint the 24h challenge window already requires elsewhere in this project.
const MIN_SPAN_MS = WINDOW_MS;

/// @param samples [{price_usd, sampled_at}], any order, all for one token/venue.
/// @returns the time-weighted average price over the trailing 30-minute window ending at
/// `asOf`, or null if there isn't yet enough sample history to cover that window.
function timeWeightedAveragePrice(samples, asOf = new Date()) {
  const windowStart = new Date(asOf.getTime() - WINDOW_MS);
  const inWindow = samples
    .map((s) => ({ price: Number(s.price_usd), at: new Date(s.sampled_at) }))
    .filter((s) => s.at <= asOf)
    .sort((a, b) => a.at - b.at);

  if (inWindow.length === 0) return null;
  const spanMs = asOf.getTime() - inWindow[0].at.getTime();
  if (spanMs < MIN_SPAN_MS) return null;

  // Weight each sample's price by how long it held (until the next sample, or until `asOf`
  // for the last one), clipped to windowStart so a sample from before the window only
  // contributes its in-window portion.
  let weightedSum = 0;
  let totalWeight = 0;
  for (let i = 0; i < inWindow.length; i++) {
    const start = Math.max(inWindow[i].at.getTime(), windowStart.getTime());
    const end = i + 1 < inWindow.length ? inWindow[i + 1].at.getTime() : asOf.getTime();
    const weight = Math.max(0, end - start);
    weightedSum += inWindow[i].price * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) return null;
  return weightedSum / totalWeight;
}

module.exports = { timeWeightedAveragePrice, WINDOW_MS, MIN_SPAN_MS };
