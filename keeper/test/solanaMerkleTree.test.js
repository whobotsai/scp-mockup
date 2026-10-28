"use strict";
const { test, assertEqual, summary } = require("./helpers/harness");
const { leafHash, buildTree, verify } = require("../src/solanaMerkleTree");

// Three real, well-known base58 pubkeys (System Program, Token Program, Associated Token
// Program) -- arbitrary for this test's purposes, just need to be valid 32-byte pubkeys so
// `new PublicKey(...)` inside leafHash doesn't throw.
const WALLET_A = "11111111111111111111111111111111";
const WALLET_B = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const WALLET_C = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

test("single-entry tree: root equals the leaf itself, empty proof verifies", () => {
  const entries = [{ account: WALLET_A, amount: 100n }];
  const { root, proofFor } = buildTree(entries);
  assertEqual(root, leafHash(WALLET_A, 100n));
  assertEqual(proofFor(0), []);
  if (!verify(proofFor(0), root, WALLET_A, 100n)) throw new Error("single-entry proof should verify");
});

test("multi-entry tree: every entry's proof verifies against the root", () => {
  const entries = [
    { account: WALLET_A, amount: 100n },
    { account: WALLET_B, amount: 200n },
    { account: WALLET_C, amount: 300n },
  ];
  const { root, proofFor } = buildTree(entries);
  for (let i = 0; i < entries.length; i++) {
    if (!verify(proofFor(i), root, entries[i].account, entries[i].amount)) {
      throw new Error(`entry ${i}'s proof failed to verify`);
    }
  }
});

test("a proof for one entry does not verify against a different entry's account/amount", () => {
  const entries = [
    { account: WALLET_A, amount: 100n },
    { account: WALLET_B, amount: 200n },
  ];
  const { root, proofFor } = buildTree(entries);
  if (verify(proofFor(0), root, WALLET_B, 200n)) {
    throw new Error("proof for entry 0 should not verify against entry 1's account/amount");
  }
});

test("leafHash: widens a u64 amount into the last 8 bytes of a 32-byte big-endian buffer (not left-aligned)", () => {
  // Cross-check against the exact byte layout contracts-solana/programs/common/src/merkle.rs
  // documents (amount_be[24..32] = amount.to_be_bytes()) by hand-building the same preimage
  // and comparing -- independent of leafHash's own implementation, so this would catch an
  // off-by-offset bug in amountToBe32 that both leafHash and a naive self-test might share.
  const { ethers } = require("ethers");
  const { PublicKey } = require("@solana/web3.js");
  const pubkeyBytes = new PublicKey(WALLET_A).toBuffer();
  const amountBe32 = Buffer.alloc(32);
  amountBe32.writeUInt32BE(0, 24); // high 4 bytes of the 8-byte amount, zero for this small value
  amountBe32.writeUInt32BE(42, 28); // low 4 bytes
  const expectedInner = ethers.keccak256(ethers.concat([pubkeyBytes, amountBe32]));
  const expected = ethers.keccak256(expectedInner);
  assertEqual(leafHash(WALLET_A, 42n), expected);
});

summary();
