"use strict";
const { PublicKey, Keypair } = require("@solana/web3.js");
const { test, assertEqual, summary } = require("./helpers/harness");
const { decodeConfig, decodeShoCampaign, decodeSsoCampaign, decodeMint, NATIVE_SOL_SENTINEL } = require("../src/abis/solana");

// Hand-encodes a buffer matching contracts-solana/programs/*/src/state.rs's Borsh layout,
// byte for byte, independently of src/abis/solana.js's own decoders -- this is the only
// check available without a real deployed program to read from (see that package's README
// and abis/solana.js's own header). If these offsets ever drift from the Rust source, this
// test only catches it if someone remembers to update both by hand; it does not read the
// Rust source itself.
function u8(n) { const b = Buffer.alloc(1); b.writeUInt8(n); return b; }
function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; }
function u64(n) { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; }
function i64(n) { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; }
function pk(publicKey) { return publicKey.toBuffer(); }
function str(s) { const body = Buffer.from(s, "utf8"); return Buffer.concat([u32(body.length), body]); }
const DISC = Buffer.alloc(8, 0xab); // discriminator value is irrelevant to the decoders -- any 8 bytes.

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
  assertEqual(cfg.bump, 254);
  assertEqual(cfg.authority, authority.toBase58());
  assertEqual(cfg.treasury, treasury.toBase58());
  assertEqual(cfg.keeper, keeperKey.toBase58());
  assertEqual(cfg.nextId, 7n);
});

test("decodeShoCampaign round-trips a hand-encoded fixed-size Campaign buffer", () => {
  const m0 = { tier: 1, rewardBps: 4000, reached: true, merkleRoot: root32, snapshotHash: hash32, reachedAt: 1000, challengeWindowEnds: 1086400, totalClaimed: 123n };
  const m1 = { tier: 3, rewardBps: 6000, reached: false, merkleRoot: Buffer.alloc(32).toString("hex"), snapshotHash: Buffer.alloc(32).toString("hex"), reachedAt: 0, challengeWindowEnds: 0, totalClaimed: 0n };
  const milestonesBuf = Buffer.concat([
    encodeMilestone(m0), encodeMilestone(m1),
    Buffer.alloc(92), Buffer.alloc(92), // unused slots 2 and 3, all-zero like Milestone::EMPTY
  ]);
  const buf = Buffer.concat([
    DISC, u8(253), u64(42), pk(token), pk(creator), pk(rewardMint), u64(9_500_000_000n),
    u8(1) /* window = D7 */, u16(100), i64(30 * 86400), i64(1_700_000_000), u8(2) /* milestoneCount */,
    milestonesBuf,
  ]);
  const c = decodeShoCampaign(buf);
  assertEqual(c.bump, 253);
  assertEqual(c.id, 42n);
  assertEqual(c.token, token.toBase58());
  assertEqual(c.creator, creator.toBase58());
  assertEqual(c.rewardMint, rewardMint.toBase58());
  assertEqual(c.totalLocked, 9_500_000_000n);
  assertEqual(c.window, 1);
  assertEqual(c.leaderboardSize, 100);
  assertEqual(c.duration, BigInt(30 * 86400));
  assertEqual(c.createdAt, 1_700_000_000n);
  assertEqual(c.milestoneCount, 2);
  assertEqual(c.milestones.length, 2);
  assertEqual(c.milestones[0].tier, 1);
  assertEqual(c.milestones[0].rewardBps, 4000);
  assertEqual(c.milestones[0].reached, true);
  assertEqual(c.milestones[0].merkleRoot, root32);
  assertEqual(c.milestones[0].totalClaimed, 123n);
  assertEqual(c.milestones[1].reached, false);
});

test("decodeSsoCampaign round-trips a hand-encoded variable-length Campaign buffer", () => {
  const e0 = { epochIndex: 0, rewardBps: 5000, finalized: true, merkleRoot: root32, snapshotHash: hash32, endsAt: 86400, challengeWindowEnds: 172800, totalClaimed: 77n };
  const e1 = { epochIndex: 1, rewardBps: 5000, finalized: false, merkleRoot: Buffer.alloc(32).toString("hex"), snapshotHash: Buffer.alloc(32).toString("hex"), endsAt: 172800, challengeWindowEnds: 0, totalClaimed: 0n };
  const epochsBuf = Buffer.concat([u32(2), encodeEpoch(e0), encodeEpoch(e1)]);
  const buf = Buffer.concat([
    DISC, u8(252), u64(5), pk(token), pk(creator), pk(rewardMint), u64(2_000_000n),
    str("$MYTOKEN"),
    u8(0) /* epochLength = H24 */, u16(500), i64(2 * 86400), i64(1_700_000_000), u16(2) /* epochCount */,
    epochsBuf,
  ]);
  const c = decodeSsoCampaign(buf);
  assertEqual(c.bump, 252);
  assertEqual(c.id, 5n);
  assertEqual(c.keyword, "$MYTOKEN");
  assertEqual(c.epochLength, 0);
  assertEqual(c.leaderboardSize, 500);
  assertEqual(c.duration, BigInt(2 * 86400));
  assertEqual(c.epochCount, 2);
  assertEqual(c.epochs.length, 2);
  assertEqual(c.epochs[0].finalized, true);
  assertEqual(c.epochs[0].totalClaimed, 77n);
  assertEqual(c.epochs[1].epochIndex, 1);
  assertEqual(c.epochs[1].finalized, false);
});

test("native-SOL sentinel decodes to the expected all-'1' base58 string", () => {
  assertEqual(new PublicKey(Buffer.alloc(32)).toBase58(), NATIVE_SOL_SENTINEL);
});

test("decodeMint round-trips a hand-encoded SPL Mint buffer (supply at offset 36, decimals at 44)", () => {
  const mintAuthorityOption = Buffer.concat([u32(1), pk(authority)]); // COption::Some(authority)
  const buf = Buffer.concat([
    mintAuthorityOption, u64(1_000_000_000_000n), u8(6) /* decimals */,
    u8(1) /* is_initialized */, u32(0), Buffer.alloc(32) /* freeze_authority: COption::None */,
  ]);
  const m = decodeMint(buf);
  assertEqual(m.supply, 1_000_000_000_000n);
  assertEqual(m.decimals, 6);
});

summary();
