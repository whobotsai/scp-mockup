// Raw account-data decoders for sho_solana / sso_solana -- same rationale as abis/sho.js /
// abis/sso.js (minimal, hand-picked, no dependency on the contracts-solana package's own
// build output), but there's no ABI/IDL-driven decoding on Solana the way ethers.Interface
// gives on the EVM side: these mirror contracts-solana/programs/*/src/state.rs's Borsh
// layouts byte-for-byte by hand. Every decode*() function takes the *full* account buffer
// as returned by Connection.getAccountInfo (i.e. still including Anchor's leading 8-byte
// discriminator) and skips it internally, so callers never need to know that detail.
//
// contracts-solana/ has never been built or deployed (see its own README) -- these layouts
// are derived from reading that source directly, not confirmed against a real running
// program. keeper/test/solanaAbis.test.js round-trips a hand-encoded buffer through each
// decoder as the only check available without a live deployment.
"use strict";
const { PublicKey } = require("@solana/web3.js");

// Mirrors contracts/src/libraries/Types.sol's LeaderboardWindow / EpochLength ordering,
// same as abis/sho.js::WINDOW_SECONDS and abis/sso.js::EPOCH_LENGTH_SECONDS -- both Solana
// programs use the identical ordering via sho_sso_common::types, so one shared array covers
// both (re-exported under both names below for drop-in parity with the EVM abis modules).
const WINDOW_OR_EPOCH_SECONDS = [24 * 60 * 60, 7 * 24 * 60 * 60, 30 * 24 * 60 * 60];

// Mirrors sho_sso_common::types::MilestoneTier ordering (same as abis/sho.js's own
// MILESTONE_USD_THRESHOLDS).
const MILESTONE_USD_THRESHOLDS = [100_000, 250_000, 1_000_000, 5_000_000];

const DISCRIMINATOR_LEN = 8;

/// Both sho_solana::state::Config and sso_solana::state::Config share this exact layout
/// (bump: u8, authority: Pubkey, treasury: Pubkey, keeper: Pubkey, next_id: u64) -- see
/// contracts-solana/README.md's layout table.
function decodeConfig(data) {
  let o = DISCRIMINATOR_LEN;
  const bump = data.readUInt8(o); o += 1;
  const authority = new PublicKey(data.subarray(o, o + 32)).toBase58(); o += 32;
  const treasury = new PublicKey(data.subarray(o, o + 32)).toBase58(); o += 32;
  const keeper = new PublicKey(data.subarray(o, o + 32)).toBase58(); o += 32;
  const nextId = data.readBigUInt64LE(o); o += 8;
  return { bump, authority, treasury, keeper, nextId };
}

// Mirrors sho_solana::state::Milestone (92 bytes): tier(1) + reward_bps(2) + reached(1) +
// merkle_root(32) + snapshot_hash(32) + reached_at(8) + challenge_window_ends(8) +
// total_claimed(8).
const MILESTONE_LEN = 92;
function decodeMilestone(data, o) {
  const tier = data.readUInt8(o); o += 1;
  const rewardBps = data.readUInt16LE(o); o += 2;
  const reached = data.readUInt8(o) !== 0; o += 1;
  const merkleRoot = data.subarray(o, o + 32).toString("hex"); o += 32;
  const snapshotHash = data.subarray(o, o + 32).toString("hex"); o += 32;
  const reachedAt = data.readBigInt64LE(o); o += 8;
  const challengeWindowEnds = data.readBigInt64LE(o); o += 8;
  const totalClaimed = data.readBigUInt64LE(o); o += 8;
  return { tier, rewardBps, reached, merkleRoot, snapshotHash, reachedAt, challengeWindowEnds, totalClaimed };
}

/// Mirrors sho_solana::state::Campaign. Fixed layout (no variable-length fields), unlike
/// the SSO campaign below.
function decodeShoCampaign(data) {
  let o = DISCRIMINATOR_LEN;
  const bump = data.readUInt8(o); o += 1;
  const id = data.readBigUInt64LE(o); o += 8;
  const token = new PublicKey(data.subarray(o, o + 32)).toBase58(); o += 32;
  const creator = new PublicKey(data.subarray(o, o + 32)).toBase58(); o += 32;
  const rewardMint = new PublicKey(data.subarray(o, o + 32)).toBase58(); o += 32;
  const totalLocked = data.readBigUInt64LE(o); o += 8;
  const window = data.readUInt8(o); o += 1;
  const leaderboardSize = data.readUInt16LE(o); o += 2;
  const duration = data.readBigInt64LE(o); o += 8;
  const createdAt = data.readBigInt64LE(o); o += 8;
  const milestoneCount = data.readUInt8(o); o += 1;
  const milestones = [];
  for (let i = 0; i < 4; i++) {
    milestones.push(decodeMilestone(data, o));
    o += MILESTONE_LEN;
  }
  return {
    bump, id, token, creator, rewardMint, totalLocked, window, leaderboardSize,
    duration, createdAt, milestoneCount, milestones: milestones.slice(0, milestoneCount),
  };
}

// Mirrors sso_solana::state::Epoch (95 bytes): epoch_index(4 u32) + reward_bps(2) +
// finalized(1) + merkle_root(32) + snapshot_hash(32) + ends_at(8) + challenge_window_ends(8)
// + total_claimed(8).
const EPOCH_LEN = 95;
function decodeEpoch(data, o) {
  const epochIndex = data.readUInt32LE(o); o += 4;
  const rewardBps = data.readUInt16LE(o); o += 2;
  const finalized = data.readUInt8(o) !== 0; o += 1;
  const merkleRoot = data.subarray(o, o + 32).toString("hex"); o += 32;
  const snapshotHash = data.subarray(o, o + 32).toString("hex"); o += 32;
  const endsAt = data.readBigInt64LE(o); o += 8;
  const challengeWindowEnds = data.readBigInt64LE(o); o += 8;
  const totalClaimed = data.readBigUInt64LE(o); o += 8;
  return { epochIndex, rewardBps, finalized, merkleRoot, snapshotHash, endsAt, challengeWindowEnds, totalClaimed };
}

/// Mirrors sso_solana::state::Campaign. `keyword` (Borsh String: u32 length prefix + utf8
/// bytes) and `epochs` (Borsh Vec<Epoch>: u32 length prefix + N*95 bytes) are variable-
/// length, so this has to parse sequentially rather than at fixed offsets -- unlike the SHO
/// decoder above.
function decodeSsoCampaign(data) {
  let o = DISCRIMINATOR_LEN;
  const bump = data.readUInt8(o); o += 1;
  const id = data.readBigUInt64LE(o); o += 8;
  const token = new PublicKey(data.subarray(o, o + 32)).toBase58(); o += 32;
  const creator = new PublicKey(data.subarray(o, o + 32)).toBase58(); o += 32;
  const rewardMint = new PublicKey(data.subarray(o, o + 32)).toBase58(); o += 32;
  const totalLocked = data.readBigUInt64LE(o); o += 8;
  const keywordLen = data.readUInt32LE(o); o += 4;
  const keyword = data.subarray(o, o + keywordLen).toString("utf8"); o += keywordLen;
  const epochLength = data.readUInt8(o); o += 1;
  const leaderboardSize = data.readUInt16LE(o); o += 2;
  const duration = data.readBigInt64LE(o); o += 8;
  const createdAt = data.readBigInt64LE(o); o += 8;
  const epochCount = data.readUInt16LE(o); o += 2;
  const epochsVecLen = data.readUInt32LE(o); o += 4;
  const epochs = [];
  for (let i = 0; i < epochsVecLen; i++) {
    epochs.push(decodeEpoch(data, o));
    o += EPOCH_LEN;
  }
  return {
    bump, id, token, creator, rewardMint, totalLocked, keyword, epochLength,
    leaderboardSize, duration, createdAt, epochCount, epochs,
  };
}

/// `Pubkey::default()` (32 zero bytes) is how both programs' Rust code spells "native SOL"
/// for `reward_mint` -- base58-encodes to this all-'1' string (see
/// contracts-solana/programs/*/src/state.rs::Campaign::is_native). Same sentinel-value role
/// Solidity's `address(0)` plays for `rewardToken` in keeper/src/campaignIndexer.js.
const NATIVE_SOL_SENTINEL = "11111111111111111111111111111111";

module.exports = {
  WINDOW_SECONDS: WINDOW_OR_EPOCH_SECONDS,
  EPOCH_LENGTH_SECONDS: WINDOW_OR_EPOCH_SECONDS,
  MILESTONE_USD_THRESHOLDS,
  NATIVE_SOL_SENTINEL,
  decodeConfig,
  decodeShoCampaign,
  decodeSsoCampaign,
};
