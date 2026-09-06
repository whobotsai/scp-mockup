// Direct port of contracts/test/helpers/merkle.js's tree-building logic, per
// KEEPER_SERVICE_DESIGN.md section 4.5's own instruction: "this production build should
// literally port contracts/test/helpers/merkle.js's buildTree, not reimplement it, so the
// two are guaranteed to stay in lockstep as the contracts evolve." Matches
// contracts/src/libraries/ClaimVerifier.sol's leaf/verify exactly (double-hashed leaf,
// sorted-pair internal nodes) — that formula is already proven correct on-chain by
// contracts/test/sho.test.js and sso.test.js's passing claim tests.
"use strict";
const { ethers } = require("ethers");

function leafHash(account, amount) {
  const inner = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [account, amount]));
  return ethers.keccak256(inner);
}

function hashPair(a, b) {
  return a.toLowerCase() < b.toLowerCase() ? ethers.keccak256(ethers.concat([a, b])) : ethers.keccak256(ethers.concat([b, a]));
}

/// @param entries [{account, amount}] — amount as BigInt or a string ethers can parse as uint256.
/// @returns {root, proofFor(index)}
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

module.exports = { leafHash, buildTree };
