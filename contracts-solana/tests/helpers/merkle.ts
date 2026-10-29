// TypeScript port of ../../../keeper/src/solanaMerkleTree.js, for this test suite's own use
// -- same "each package/surface duplicates its own small stuff" convention this whole
// project already follows (see solanaAbis.js's header for the precedent). Mirrors
// contracts-solana/programs/common/src/merkle.rs byte-for-byte: leaf =
// keccak256(keccak256(account_pubkey(32 bytes) || amount_be(32 bytes))).
//
// Uses ethers.keccak256 as a raw Keccak-256 primitive (not for any EVM-specific encoding) --
// the same reuse keeper/src/solanaMerkleTree.js and public/index.html's Solana helpers
// already make, since Solana's own `keccak` syscall
// (anchor_lang::solana_program::keccak, what the on-chain program actually calls) implements
// the identical algorithm, not NIST SHA3-256.
import { PublicKey } from "@solana/web3.js";
import { ethers } from "ethers";

export type Entry = { account: PublicKey; amount: bigint };

function amountToBe32(amount: bigint): Buffer {
  const buf = Buffer.alloc(32);
  const amountBuf = Buffer.alloc(8);
  amountBuf.writeBigUInt64BE(amount);
  amountBuf.copy(buf, 24);
  return buf;
}

export function leafHash(account: PublicKey, amount: bigint): Buffer {
  const pre = Buffer.concat([account.toBuffer(), amountToBe32(amount)]);
  const innerHex = ethers.keccak256(pre); // 0x-prefixed hex string; keccak256 accepts it directly as input below
  return Buffer.from(ethers.getBytes(ethers.keccak256(innerHex)));
}

function hashPair(a: Buffer, b: Buffer): Buffer {
  const ordered = Buffer.compare(a, b) <= 0 ? Buffer.concat([a, b]) : Buffer.concat([b, a]);
  return Buffer.from(ethers.getBytes(ethers.keccak256(ordered)));
}

export function buildTree(entries: Entry[]) {
  let layer = entries.map((e) => leafHash(e.account, e.amount));
  const layers: Buffer[][] = [layer];
  while (layer.length > 1) {
    const next: Buffer[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      next.push(i + 1 < layer.length ? hashPair(layer[i], layer[i + 1]) : layer[i]);
    }
    layer = next;
    layers.push(layer);
  }

  function proofFor(index: number): Buffer[] {
    const proof: Buffer[] = [];
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

// Direct port of registry_solana/src/state.rs::normalized_handle_key -- note this is a
// *single* keccak256, unlike leafHash's double hash above, and lowercases ASCII A-Z only
// (not a full Unicode case-fold -- matches is_ascii_uppercase() on the Rust side exactly,
// since X handles are ASCII-only).
export function normalizedHandleKey(xHandle: string): Buffer {
  const lower = xHandle.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
  return Buffer.from(ethers.getBytes(ethers.keccak256(Buffer.from(lower, "utf8"))));
}
