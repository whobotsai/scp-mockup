// Direct port of keeper/src/solanaMerkleTree.js, same "port, don't reimplement" rule
// shared.js's own header already states for the EVM tree -- a claim proof must match the
// exact tree the keeper built and posted on-chain, so this can't drift from the keeper's copy.
// Mirrors contracts-solana/programs/common/src/merkle.rs's leaf encoding (pubkey(32 bytes) +
// amount_be(32 bytes)), not merkleTree.js/shared.js's ABI-encoded-address version -- see that
// Rust module's own header for why the two chains need different leaf encodings.
"use strict";
const { PublicKey } = require("@solana/web3.js");
const { ethers } = require("ethers");

function amountToBe32(amount) {
  const buf = Buffer.alloc(32);
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64BE(BigInt(amount));
  amountBuf.copy(buf, 24);
  return buf;
}

function leafHash(accountBase58, amount) {
  const pubkeyBytes = new PublicKey(accountBase58).toBuffer();
  const amountBytes = amountToBe32(amount);
  const inner = ethers.keccak256(ethers.concat([pubkeyBytes, amountBytes]));
  return ethers.keccak256(inner);
}

function hashPair(a, b) {
  return a.toLowerCase() <= b.toLowerCase() ? ethers.keccak256(ethers.concat([a, b])) : ethers.keccak256(ethers.concat([b, a]));
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

module.exports = { leafHash, hashPair, buildTree };
