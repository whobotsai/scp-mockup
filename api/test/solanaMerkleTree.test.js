"use strict";
const { ethers } = require("ethers");
const { test, assertEqual, summary } = require("./helpers/harness");
const { leafHash, hashPair, buildTree } = require("../src/solanaMerkleTree");

// Same tests as keeper/test/solanaMerkleTree.test.js -- this is a direct port of that module
// (see this file's own header), so it needs the same independent proof-of-correctness.
function verifyProof(proof, root, leaf) {
  let computed = leaf;
  for (const p of proof) computed = hashPair(computed, p);
  return computed === root;
}

const WALLET_A = "11111111111111111111111111111111";
const WALLET_B = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const WALLET_C = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

test("single-entry tree: root equals the leaf itself, empty proof verifies", () => {
  const entries = [{ account: WALLET_A, amount: 100n }];
  const { root, proofFor } = buildTree(entries);
  assertEqual(root, leafHash(WALLET_A, 100n));
  const proof = proofFor(0);
  assertEqual(proof, []);
  if (!verifyProof(proof, root, leafHash(WALLET_A, 100n))) throw new Error("single-entry proof should verify");
});

test("multi-entry tree: every entry's proof verifies against the root", () => {
  const entries = [
    { account: WALLET_A, amount: 100n },
    { account: WALLET_B, amount: 200n },
    { account: WALLET_C, amount: 300n },
  ];
  const { root, proofFor } = buildTree(entries);
  for (let i = 0; i < entries.length; i++) {
    const leaf = leafHash(entries[i].account, entries[i].amount);
    if (!verifyProof(proofFor(i), root, leaf)) throw new Error(`entry ${i}'s proof failed to verify`);
  }
});

test("a proof for one entry does not verify against a different entry's leaf", () => {
  const entries = [
    { account: WALLET_A, amount: 100n },
    { account: WALLET_B, amount: 200n },
  ];
  const { root, proofFor } = buildTree(entries);
  const wrongLeaf = leafHash(WALLET_B, 200n);
  if (verifyProof(proofFor(0), root, wrongLeaf)) {
    throw new Error("proof for entry 0 should not verify against entry 1's leaf");
  }
});

test("leafHash matches keeper/src/solanaMerkleTree.js's own cross-check value", () => {
  const { PublicKey } = require("@solana/web3.js");
  const pubkeyBytes = new PublicKey(WALLET_A).toBuffer();
  const amountBe32 = Buffer.alloc(32);
  amountBe32.writeUInt32BE(42, 28);
  const expectedInner = ethers.keccak256(ethers.concat([pubkeyBytes, amountBe32]));
  const expected = ethers.keccak256(expectedInner);
  assertEqual(leafHash(WALLET_A, 42n), expected);
});

summary();
