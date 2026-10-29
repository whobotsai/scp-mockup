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

// ===================== SPL mint / Metaplex metadata (for display only) =====================
// Neither sho_solana nor sso_solana read any of this on-chain -- it's purely so this API can
// show a real name/symbol/decimals instead of the always-null placeholders a first pass
// shipped with. SPL Token's Mint layout (decimals at a fixed byte offset) and the Metaplex
// Token Metadata PDA/account layout are both stable, widely-used standards independent of
// this project's own programs -- not something contracts-solana/ defines or could change.

const TOKEN_METADATA_PROGRAM_ID = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

/// SPL Token's Mint account layout: mint_authority COption<Pubkey> (4-byte tag + 32-byte
/// value = 36) + supply u64 (8) + decimals u8 at a fixed offset of 44 -- no discriminator
/// prefix (unlike Anchor accounts), since the legacy SPL Token program predates Anchor.
function decodeMintDecimals(data) {
  return data.readUInt8(44);
}

/// Same Mint layout as decodeMintDecimals, also reading supply (u64 LE at offset 36) --
/// needed for mcap (price * circulating supply), which decodeMintDecimals alone can't give.
/// Direct port of keeper/src/abis/solana.js::decodeMint.
function decodeMint(data) {
  const supply = data.readBigUInt64LE(36);
  const decimals = data.readUInt8(44);
  return { supply, decimals };
}

function metadataPda(mint) {
  const programId = new PublicKey(TOKEN_METADATA_PROGRAM_ID);
  const [addr] = PublicKey.findProgramAddressSync(
    [Buffer.from("metadata"), programId.toBuffer(), mint.toBuffer()],
    programId
  );
  return addr;
}

/// Metaplex's Metadata account: key(1) + update_authority(32) + mint(32), then `data`'s
/// name/symbol/uri as Borsh strings (u32 length prefix + utf8 bytes) -- name/symbol are
/// historically padded with trailing null bytes to a fixed max length (32/10), trimmed off
/// here. Only decodes the two fields this API actually displays.
function decodeTokenMetadataNameSymbol(data) {
  let o = 1 + 32 + 32;
  const nameLen = data.readUInt32LE(o); o += 4;
  const name = data.subarray(o, o + nameLen).toString("utf8").replace(/\0/g, "").trim();
  o += nameLen;
  const symbolLen = data.readUInt32LE(o); o += 4;
  const symbol = data.subarray(o, o + symbolLen).toString("utf8").replace(/\0/g, "").trim();
  return { name: name || null, symbol: symbol || null };
}

/// Best-effort: a mint with no Metaplex metadata account (or one this fails to decode) just
/// comes back with name/symbol null, same "honest gap, not invented" posture as the rest of
/// this API -- never throws for that reason, only for a genuinely unreachable connection.
async function fetchSplTokenInfo(connection, mint) {
  const mintInfo = await connection.getAccountInfo(mint);
  const decimals = mintInfo ? decodeMintDecimals(mintInfo.data) : null;

  let name = null;
  let symbol = null;
  try {
    const metaInfo = await connection.getAccountInfo(metadataPda(mint));
    if (metaInfo) ({ name, symbol } = decodeTokenMetadataNameSymbol(metaInfo.data));
  } catch (e) {
    // Malformed/unexpected metadata layout -- leave name/symbol null rather than fail the
    // whole campaign summary over a cosmetic field.
  }
  return { decimals, name, symbol };
}

module.exports = {
  WINDOW_SECONDS: WINDOW_OR_EPOCH_SECONDS,
  EPOCH_LENGTH_SECONDS: WINDOW_OR_EPOCH_SECONDS,
  MILESTONE_USD_THRESHOLDS,
  NATIVE_SOL_SENTINEL,
  decodeConfig,
  decodeShoCampaign,
  decodeSsoCampaign,
  decodeMintDecimals,
  decodeMint,
  decodeTokenMetadataNameSymbol,
  metadataPda,
  fetchSplTokenInfo,
};
