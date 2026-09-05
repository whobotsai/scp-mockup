// A tiny sorted-pair Merkle tree matching OpenZeppelin's MerkleProof.verify convention
// (each pair hashed in ascending byte order) and ClaimVerifier's double-hashed leaf
// (the standard second-preimage mitigation). Self-contained: proofs are only ever checked
// against roots this same code produced, so what matters is internal consistency with the
// on-chain verifier, not matching any particular third-party tree library's exact layout.
"use strict";
const { ethers } = require("hardhat");

function leafHash(account, amount) {
  const inner = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address", "uint256"], [account, amount])
  );
  return ethers.keccak256(inner);
}

function hashPair(a, b) {
  return a.toLowerCase() < b.toLowerCase()
    ? ethers.keccak256(ethers.concat([a, b]))
    : ethers.keccak256(ethers.concat([b, a]));
}

/// @param entries [{account, amount}]
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
