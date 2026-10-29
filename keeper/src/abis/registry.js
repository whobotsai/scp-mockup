// Raw account-data decoders for registry_solana. Same hand-written-Borsh-mirror approach as
// abis/solana.js (no ABI/IDL-driven decoding on Solana), derived directly from
// contracts-solana/programs/registry_solana/src/state.rs, not confirmed against a real
// running program (that package has never been built or deployed -- see its own README).
"use strict";
const { PublicKey } = require("@solana/web3.js");

const DISCRIMINATOR_LEN = 8;

/// Mirrors registry_solana::state::Config: bump(1) + authority(32) + attestor(32) +
/// next_registration_id(8 LE). Not the same layout as sho_solana/sso_solana's Config
/// (abis/solana.js) -- registry_solana is a fully standalone program with its own Config
/// shape (treasury/keeper there, attestor/next_registration_id here).
function decodeConfig(data) {
  let o = DISCRIMINATOR_LEN;
  const bump = data.readUInt8(o); o += 1;
  const authority = new PublicKey(data.subarray(o, o + 32)).toBase58(); o += 32;
  const attestor = new PublicKey(data.subarray(o, o + 32)).toBase58(); o += 32;
  const nextRegistrationId = data.readBigUInt64LE(o); o += 8;
  return { bump, authority, attestor, nextRegistrationId };
}

/// Mirrors registry_solana::state::Registration: bump(1) + id(8) + wallet(32) + x_handle
/// (Borsh String: u32 length prefix + utf8 bytes). Variable-length, like sso_solana's
/// `keyword` field (abis/solana.js::decodeSsoCampaign) -- parsed sequentially, not at a
/// fixed offset.
function decodeRegistration(data) {
  let o = DISCRIMINATOR_LEN;
  const bump = data.readUInt8(o); o += 1;
  const id = data.readBigUInt64LE(o); o += 8;
  const wallet = new PublicKey(data.subarray(o, o + 32)).toBase58(); o += 32;
  const xHandleLen = data.readUInt32LE(o); o += 4;
  const xHandle = data.subarray(o, o + xHandleLen).toString("utf8"); o += xHandleLen;
  return { bump, id, wallet, xHandle };
}

module.exports = { decodeConfig, decodeRegistration };
