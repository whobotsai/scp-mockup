"use strict";
const { ethers } = require("ethers");
const { test, assertEqual, summary } = require("./helpers/harness");
const { leafHash, buildTree } = require("../src/merkleTree");

// Mirrors OpenZeppelin's MerkleProof.verify exactly (sorted-pair hashing) -- the same
// algorithm contracts/src/libraries/ClaimVerifier.sol relies on. Used here to independently
// check buildTree's own proofs verify, offline, without needing a live contract.
function verifyProof(proof, root, leaf) {
  let computed = leaf;
  for (const p of proof) {
    computed =
      computed.toLowerCase() < p.toLowerCase()
        ? ethers.keccak256(ethers.concat([computed, p]))
        : ethers.keccak256(ethers.concat([p, computed]));
  }
  return computed === root;
}

test("single-entry tree: root equals the leaf itself, empty proof verifies", () => {
  const entries = [{ account: "0x1111111111111111111111111111111111111111", amount: 100n }];
  const { root, proofFor } = buildTree(entries);
  assertEqual(root, leafHash(entries[0].account, entries[0].amount));
  const proof = proofFor(0);
  assertEqual(proof, []);
  if (!verifyProof(proof, root, leafHash(entries[0].account, entries[0].amount))) {
    throw new Error("single-entry proof should verify");
  }
});

test("multi-entry tree: every entry's proof verifies against the root", () => {
  const entries = [
    { account: "0x1111111111111111111111111111111111111111", amount: 100n },
    { account: "0x2222222222222222222222222222222222222222", amount: 200n },
    { account: "0x3333333333333333333333333333333333333333", amount: 300n },
  ];
  const { root, proofFor } = buildTree(entries);
  for (let i = 0; i < entries.length; i++) {
    const leaf = leafHash(entries[i].account, entries[i].amount);
    const proof = proofFor(i);
    if (!verifyProof(proof, root, leaf)) throw new Error(`entry ${i}'s proof failed to verify`);
  }
});

test("a proof for one entry does not verify against a different entry's leaf", () => {
  const entries = [
    { account: "0x1111111111111111111111111111111111111111", amount: 100n },
    { account: "0x2222222222222222222222222222222222222222", amount: 200n },
  ];
  const { root, proofFor } = buildTree(entries);
  const wrongLeaf = leafHash(entries[1].account, entries[1].amount);
  if (verifyProof(proofFor(0), root, wrongLeaf)) {
    throw new Error("proof for entry 0 should not verify against entry 1's leaf");
  }
});

summary();
