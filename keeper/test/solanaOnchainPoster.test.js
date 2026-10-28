"use strict";
const crypto = require("crypto");
const { PublicKey, Keypair } = require("@solana/web3.js");
const { test, assertEqual, summary } = require("./helpers/harness");
const { anchorDiscriminator, hexToBytes32, buildPostRootInstruction, FACTORY_CONFIG } = require("../src/solanaOnchainPoster");

test("anchorDiscriminator: first 8 bytes of sha256(\"global:<ix_name>\")", () => {
  const expected = crypto.createHash("sha256").update("global:post_milestone_root").digest().subarray(0, 8);
  assertEqual(anchorDiscriminator("post_milestone_root").toString("hex"), expected.toString("hex"));
  assertEqual(anchorDiscriminator("post_milestone_root").length, 8);
});

test("anchorDiscriminator: different instruction names produce different discriminators", () => {
  const a = anchorDiscriminator("post_milestone_root").toString("hex");
  const b = anchorDiscriminator("post_epoch_root").toString("hex");
  if (a === b) throw new Error("post_milestone_root and post_epoch_root must not share a discriminator");
});

test("hexToBytes32: strips an optional 0x prefix and returns exactly 32 bytes", () => {
  const withPrefix = "0x" + "ab".repeat(32);
  const withoutPrefix = "ab".repeat(32);
  assertEqual(hexToBytes32(withPrefix).length, 32);
  assertEqual(hexToBytes32(withPrefix).toString("hex"), hexToBytes32(withoutPrefix).toString("hex"));
});

test("hexToBytes32: throws on the wrong length rather than silently truncating/padding", () => {
  let threw = false;
  try {
    hexToBytes32("0x1234");
  } catch (e) {
    threw = true;
  }
  assertEqual(threw, true);
});

test("buildPostRootInstruction: SHO encodes a 1-byte milestone_index; SSO encodes a 2-byte epoch_index", () => {
  const programId = Keypair.generate().publicKey;
  const keeperPubkey = Keypair.generate().publicKey;
  const campaignPubkey = Keypair.generate().publicKey;
  const root = "0x" + "11".repeat(32);
  const hash = "0x" + "22".repeat(32);

  const shoIx = buildPostRootInstruction({ programId, keeperPubkey, campaignPubkey, factory: "sho", index: 2, merkleRootHex: root, snapshotHashHex: hash });
  // data = discriminator(8) + milestone_index(1) + root(32) + hash(32) = 73 bytes
  assertEqual(shoIx.data.length, 8 + 1 + 32 + 32);
  assertEqual(shoIx.data[8], 2);

  const ssoIx = buildPostRootInstruction({ programId, keeperPubkey, campaignPubkey, factory: "sso", index: 300, merkleRootHex: root, snapshotHashHex: hash });
  // data = discriminator(8) + epoch_index(2) + root(32) + hash(32) = 74 bytes
  assertEqual(ssoIx.data.length, 8 + 2 + 32 + 32);
  assertEqual(ssoIx.data.readUInt16LE(8), 300);
});

test("buildPostRootInstruction: account order is [keeper(signer), config PDA, campaign(writable)]", () => {
  const programId = Keypair.generate().publicKey;
  const keeperPubkey = Keypair.generate().publicKey;
  const campaignPubkey = Keypair.generate().publicKey;
  const root = "0x" + "11".repeat(32);
  const hash = "0x" + "22".repeat(32);

  const ix = buildPostRootInstruction({ programId, keeperPubkey, campaignPubkey, factory: "sho", index: 0, merkleRootHex: root, snapshotHashHex: hash });
  assertEqual(ix.keys.length, 3);
  assertEqual(ix.keys[0].pubkey.toBase58(), keeperPubkey.toBase58());
  assertEqual(ix.keys[0].isSigner, true);
  assertEqual(ix.keys[2].pubkey.toBase58(), campaignPubkey.toBase58());
  assertEqual(ix.keys[2].isWritable, true);
});

test("FACTORY_CONFIG.sho/sso.isAlreadyFinalized: reads the reached/finalized flag at the given index from a decoded account buffer", () => {
  // Hand-encode a minimal SHO Campaign buffer with milestone 0 reached=true, matching
  // abis/solana.js's layout -- same approach test/solanaAbis.test.js uses.
  const DISC = Buffer.alloc(8, 0xab);
  function u8(n) { const b = Buffer.alloc(1); b.writeUInt8(n); return b; }
  function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
  function u64(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; }
  function i64(n) { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; }
  function pk(publicKey) { return publicKey.toBuffer(); }
  const token = Keypair.generate().publicKey;
  const creator = Keypair.generate().publicKey;
  const rewardMint = Keypair.generate().publicKey;
  const zero32 = Buffer.alloc(32);
  function encodeMilestone(reached) {
    return Buffer.concat([u8(0), u16(1000), u8(reached ? 1 : 0), zero32, zero32, i64(0), i64(0), u64(0)]);
  }
  const buf = Buffer.concat([
    DISC, u8(253), u64(1), pk(token), pk(creator), pk(rewardMint), u64(1000),
    u8(0), u16(50), i64(0), i64(0), u8(1), // milestoneCount = 1
    encodeMilestone(true), Buffer.alloc(92), Buffer.alloc(92), Buffer.alloc(92),
  ]);
  assertEqual(FACTORY_CONFIG.sho.isAlreadyFinalized(buf, 0), true);
});

summary();
