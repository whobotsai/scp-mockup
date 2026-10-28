// Solana counterpart of merkleTree.js. Same double-hashed leaf / sorted-pair internal-node
// convention, but the leaf encoding differs: a Solana Pubkey is already 32 bytes (no
// ABI-encode left-padding the way a 20-byte Ethereum address gets under
// `abi.encode(address,uint256)`), so this can't reuse merkleTree.js's leafHash as-is. Mirrors
// contracts-solana/programs/common/src/merkle.rs byte-for-byte: leaf =
// keccak256(keccak256(account_pubkey(32 bytes) || amount_be(32 bytes))), where amount is an
// on-chain u64 widened to a 32-byte big-endian buffer (zero-padded in the top 24 bytes) purely
// so the wire shape matches Solidity's uint256 encoding.
//
// Uses ethers.keccak256 as a raw Keccak-256 primitive (not for any EVM-specific encoding) --
// Solana's own `anchor_lang::solana_program::keccak` syscall implements the identical
// Keccak-256 algorithm Ethereum uses (not NIST SHA3-256, which pads differently), so this is
// the correct hash either way and avoids adding a new dependency only for this one primitive.
//
// contracts-solana/ has never been built or deployed (see its own README), so this has never
// been cross-checked against a live program's actual verify() call -- only self-consistency
// tested (a built proof verifies against its own root) in test/solanaMerkleTree.test.js, the
// same assurance level merkleTree.test.js already gives for the EVM version.
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

// Mirrors merkle.rs's `if a <= b { hash(a,b) } else { hash(b,a) }` exactly (not merkleTree.js's
// strict `<`) -- the two are equivalent in practice (concat(a,b) and concat(b,a) are identical
// bytes when a==b), but matching the source exactly removes any doubt.
function hashPair(a, b) {
  return a.toLowerCase() <= b.toLowerCase() ? ethers.keccak256(ethers.concat([a, b])) : ethers.keccak256(ethers.concat([b, a]));
}

/// @param entries [{account: base58 string, amount}] — amount as BigInt or a string ethers can
///   parse as uint64.
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

/// Mirrors merkle.rs's verify() -- used by tests to check a built proof actually validates, and
/// available to anything else (e.g. a future claim-proof API endpoint) that needs to check a
/// proof without rebuilding the whole tree.
function verify(proof, root, account, amount) {
  let computed = leafHash(account, amount);
  for (const sibling of proof) computed = hashPair(computed, sibling);
  return computed.toLowerCase() === root.toLowerCase();
}

module.exports = { leafHash, hashPair, buildTree, verify };
