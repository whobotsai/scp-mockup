"use strict";
const { Keypair } = require("@solana/web3.js");
const { test, assertEqual, summary } = require("./helpers/harness");
const { decodeConfig, decodeRegistration } = require("../src/abis/registry");

// Same hand-encoding approach as test/solanaAbis.test.js -- the only check available without
// a real deployed program to read from (contracts-solana/programs/registry_solana has never
// been built or deployed, see its own README).
function u8(n) { const b = Buffer.alloc(1); b.writeUInt8(n); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; }
function u64(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; }
function pk(publicKey) { return publicKey.toBuffer(); }
function str(s) { const body = Buffer.from(s, "utf8"); return Buffer.concat([u32(body.length), body]); }
const DISC = Buffer.alloc(8, 0xab);

const authority = Keypair.generate().publicKey;
const attestor = Keypair.generate().publicKey;
const wallet = Keypair.generate().publicKey;

test("decodeConfig round-trips a hand-encoded registry_solana Config buffer", () => {
  const buf = Buffer.concat([DISC, u8(255), pk(authority), pk(attestor), u64(3)]);
  const cfg = decodeConfig(buf);
  assertEqual(cfg.bump, 255);
  assertEqual(cfg.authority, authority.toBase58());
  assertEqual(cfg.attestor, attestor.toBase58());
  assertEqual(cfg.nextRegistrationId, 3n);
});

test("decodeRegistration round-trips a hand-encoded Registration buffer (variable-length x_handle)", () => {
  const buf = Buffer.concat([DISC, u8(254), u64(7), pk(wallet), str("diamondhand_fam")]);
  const r = decodeRegistration(buf);
  assertEqual(r.bump, 254);
  assertEqual(r.id, 7n);
  assertEqual(r.wallet, wallet.toBase58());
  assertEqual(r.xHandle, "diamondhand_fam");
});

summary();
