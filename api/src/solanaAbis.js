// Raw account-data decoders for sho_solana / sso_solana. Deliberately duplicated from
// keeper/src/abis/solana.js rather than imported across packages -- same "each package is
// independently deployable, duplicate the small stuff" precedent abis.js's own header
// describes for the EVM ABIs. Keep in lockstep with that file (and with
// contracts-solana/programs/*/src/state.rs, which both ultimately mirror) if either changes.
//
// contracts-solana/ has never been built or deployed (see its own README) -- these layouts
// are derived from reading that source directly, not confirmed against a real running
// program.
"use strict";
const { PublicKey } = require("@solana/web3.js");

// Mirrors sho_sso_common::types' LeaderboardWindow / EpochLength ordering -- same array
// abis.js's own EPOCH_LENGTH_SECONDS already uses for the EVM side, since both chains share
// the identical enum ordering.
const WINDOW_OR_EPOCH_SECONDS = [24 * 60 * 60, 7 * 24 * 60 * 60, 30 * 24 * 60 * 60];

// Mirrors sho_sso_common::types::MilestoneTier ordering (same as abis.js's own
// MILESTONE_USD_THRESHOLDS).
const MILESTONE_USD_THRESHOLDS = [100_000, 250_000, 1_000_000, 5_000_000];

const DISCRIMINATOR_LEN = 8;

/// Both sho_solana::state::Config and sso_solana::state::Config share this exact layout.
function decodeConfig(data) {
  let o = DISCRIMINATOR_LEN;
  const bump = data.readUInt8(o); o += 1;
  const authority = new PublicKey(data.subarray(o, o + 32)).toBase58(); o += 32;
  const treasury = new PublicKey(data.subarray(o, o + 32)).toBase58(); o += 32;
  const keeper = new PublicKey(data.subarray(o, o + 32)).toBase58(); o += 32;
  const nextId = data.readBigUInt64LE(o); o += 8;
  return { bump, authority, treasury, keeper, nextId };
}

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

/// `Pubkey::default()` (32 zero bytes) is how both programs spell "native SOL" for
/// reward_mint -- base58-encodes to this all-'1' string. Same role Solidity's `address(0)`
/// plays for `rewardToken` (compared via `ethers.ZeroAddress` in shoRoutes.js/ssoRoutes.js).
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
