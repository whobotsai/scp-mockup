"use strict";
const { PublicKey, Keypair } = require("@solana/web3.js");
const { test, assertEqual, summary } = require("./helpers/harness");
const { decodeConfig, decodeShoCampaign, decodeSsoCampaign, NATIVE_SOL_SENTINEL } = require("../src/solanaAbis");

// Same hand-encoding approach as keeper/test/solanaAbis.test.js -- the only check available
// without a real deployed program to read from (see contracts-solana/README.md and
// solanaAbis.js's own header). Kept independent of that file rather than imported, same
// "each package duplicates its own small stuff" precedent this project already uses.
function u8(n) { const b = Buffer.alloc(1); b.writeUInt8(n); return b; }
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; }
function u64(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; }
function i64(n) { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; }
function pk(publicKey) { return publicKey.toBuffer(); }
function str(s) { const body = Buffer.from(s, "utf8"); return Buffer.concat([u32(body.length), body]); }
const DISC = Buffer.alloc(8, 0xab);

function encodeMilestone({ tier, rewardBps, reached, merkleRoot, snapshotHash, reachedAt, challengeWindowEnds, totalClaimed }) {
  return Buffer.concat([
    u8(tier), u16(rewardBps), u8(reached ? 1 : 0),
    Buffer.from(merkleRoot, "hex"), Buffer.from(snapshotHash, "hex"),
    i64(reachedAt), i64(challengeWindowEnds), u64(totalClaimed),
  ]);
}
function encodeEpoch({ epochIndex, rewardBps, finalized, merkleRoot, snapshotHash, endsAt, challengeWindowEnds, totalClaimed }) {
  return Buffer.concat([
    u32(epochIndex), u16(rewardBps), u8(finalized ? 1 : 0),
    Buffer.from(merkleRoot, "hex"), Buffer.from(snapshotHash, "hex"),
    i64(endsAt), i64(challengeWindowEnds), u64(totalClaimed),
  ]);
}

const authority = Keypair.generate().publicKey;
const treasury = Keypair.generate().publicKey;
const keeperKey = Keypair.generate().publicKey;
const token = Keypair.generate().publicKey;
const creator = Keypair.generate().publicKey;
const rewardMint = Keypair.generate().publicKey;
const root32 = Buffer.alloc(32, 0x11).toString("hex");
const hash32 = Buffer.alloc(32, 0x22).toString("hex");

test("decodeConfig round-trips a hand-encoded Config buffer", () => {
  const buf = Buffer.concat([DISC, u8(254), pk(authority), pk(treasury), pk(keeperKey), u64(7)]);
  const cfg = decodeConfig(buf);
  assertEqual(cfg.treasury, treasury.toBase58());
  assertEqual(cfg.nextId, 7n);
});

test("decodeShoCampaign round-trips a hand-encoded fixed-size Campaign buffer", () => {
  const m0 = { tier: 1, rewardBps: 4000, reached: true, merkleRoot: root32, snapshotHash: hash32, reachedAt: 1000, challengeWindowEnds: 1086400, totalClaimed: 123n };
  const milestonesBuf = Buffer.concat([encodeMilestone(m0), Buffer.alloc(92), Buffer.alloc(92), Buffer.alloc(92)]);
  const buf = Buffer.concat([
    DISC, u8(253), u64(42), pk(token), pk(creator), pk(rewardMint), u64(9_500_000_000n),
    u8(1), u16(100), i64(30 * 86400), i64(1_700_000_000), u8(1), milestonesBuf,
  ]);
  const c = decodeShoCampaign(buf);
  assertEqual(c.id, 42n);
  assertEqual(c.creator, creator.toBase58());
  assertEqual(c.milestones.length, 1);
  assertEqual(c.milestones[0].reached, true);
  assertEqual(c.milestones[0].totalClaimed, 123n);
});

test("decodeSsoCampaign round-trips a hand-encoded variable-length Campaign buffer", () => {
  const e0 = { epochIndex: 0, rewardBps: 10000, finalized: true, merkleRoot: root32, snapshotHash: hash32, endsAt: 86400, challengeWindowEnds: 172800, totalClaimed: 77n };
  const epochsBuf = Buffer.concat([u32(1), encodeEpoch(e0)]);
  const buf = Buffer.concat([
    DISC, u8(252), u64(5), pk(token), pk(creator), pk(rewardMint), u64(2_000_000n),
    str("$MYTOKEN"), u8(0), u16(500), i64(2 * 86400), i64(1_700_000_000), u16(1), epochsBuf,
  ]);
  const c = decodeSsoCampaign(buf);
  assertEqual(c.keyword, "$MYTOKEN");
  assertEqual(c.epochs.length, 1);
  assertEqual(c.epochs[0].finalized, true);
  assertEqual(c.epochs[0].totalClaimed, 77n);
});

test("native-SOL sentinel decodes to the expected all-'1' base58 string", () => {
  assertEqual(new PublicKey(Buffer.alloc(32)).toBase58(), NATIVE_SOL_SENTINEL);
});

summary();
