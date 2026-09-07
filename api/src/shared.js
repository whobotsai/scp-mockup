// Pure logic ported directly from keeper/src/merkleTree.js and twapOracle.js -- unlike
// db.js's SQL-based leaderboard queries (deliberately approximate, display-only), a claim
// proof must match the exact tree the keeper built and posted on-chain, or claim() reverts
// with "bad proof." This is why it's a direct port, not a reimplementation, mirroring
// keeper/src/merkleTree.js's own header: "port, don't reimplement, so the two stay in
// lockstep as the contracts evolve." The TWAP function is duplicated too, purely so a
// campaign's displayed mcap matches what the keeper actually used to decide a crossing,
// rather than an approximate average that could confuse a user ("why does the site say $95K
// when the milestone already fired at $100K").
"use strict";
const { ethers } = require("ethers");

function leafHash(account, amount) {
  const inner = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [account, amount]));
  return ethers.keccak256(inner);
}

function hashPair(a, b) {
  return a.toLowerCase() < b.toLowerCase() ? ethers.keccak256(ethers.concat([a, b])) : ethers.keccak256(ethers.concat([b, a]));
}

function buildTree(entries) {
  let layer = entries.map((e) => leafHash(e.account, e.amount));
  const layers = [layer];
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      next.push(i + 1 < layer.length ? hashPair(layer[i], layer[i + 1]) : layer[i]);
    }
    layer = next;
    layers.push(layer);
  }

  function proofFor(index) {
    const proof = [];
    let idx = index;
    for (let level = 0; level < layers.length - 1; level++) {
      const l = layers[level];
      const pairIndex = idx % 2 === 0 ? idx + 1 : idx - 1;
      if (pairIndex < l.length) proof.push(l[pairIndex]);
      idx = Math.floor(idx / 2);
    }
    return proof;
  }

  return { root: layers[layers.length - 1][0], proofFor };
}

const TWAP_WINDOW_MS = 30 * 60 * 1000;
const TWAP_MIN_SPAN_MS = TWAP_WINDOW_MS;

function timeWeightedAveragePrice(samples, asOf = new Date()) {
  const windowStart = new Date(asOf.getTime() - TWAP_WINDOW_MS);
  const inWindow = samples
    .map((s) => ({ price: Number(s.price_usd), at: new Date(s.sampled_at) }))
    .filter((s) => s.at <= asOf)
    .sort((a, b) => a.at - b.at);
  if (inWindow.length === 0) return null;
  const spanMs = asOf.getTime() - inWindow[0].at.getTime();
  if (spanMs < TWAP_MIN_SPAN_MS) return null;

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

/// Whole days remaining before a campaign's own on-chain duration elapses -- never negative
/// (an expired campaign shows 0, not a negative count). createdAt is a JS Date (as returned
/// by node-postgres for a timestamptz column); durationSeconds is whatever the contract
/// itself stored (a string or number, both handled).
function daysLeft(createdAt, durationSeconds) {
  const endsAtMs = new Date(createdAt).getTime() + Number(durationSeconds) * 1000;
  const remainingSeconds = (endsAtMs - Date.now()) / 1000;
  return Math.max(0, Math.ceil(remainingSeconds / 86400));
}

module.exports = { leafHash, buildTree, timeWeightedAveragePrice, TWAP_WINDOW_MS, daysLeft };
