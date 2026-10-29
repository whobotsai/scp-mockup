// Solana counterpart of attestation.js. registry_solana's register_handle instruction (see
// contracts-solana/programs/registry_solana/src/lib.rs) doesn't verify a detached attestation
// signature on-chain the way Registry.sol's registerHandle does -- Solana has no cheap native
// secp256k1/ECDSA recovery, and hand-rolling Ed25519-sysvar-instruction-introspection parsing
// carries real risk of a subtle bug cargo check can't catch (see that program's own header
// for the full reasoning). Instead it requires the attestor to co-sign the same transaction
// as a second Signer.
//
// So this module's job is narrower than attestation.js's: it doesn't sign a fixed digest over
// (wallet, xHandle) the way EVM's signAttestation does -- it signs whatever exact transaction
// message bytes the frontend hands it (the frontend is the one that knows how to build the
// register_handle instruction; see public/index.html's Solana helpers), using Ed25519 (the
// attestor's Solana keypair, a *different* key from ATTESTOR_PRIVATE_KEY -- that's an EVM
// secp256k1 key, meaningless on Solana; a Solana attestor needs its own Ed25519 keypair, see
// .env.example's SOLANA_ATTESTOR_PRIVATE_KEY).
"use strict";
const nacl = require("tweetnacl");
const { Keypair } = require("@solana/web3.js");
const bs58 = require("bs58");

function loadSolanaAttestorKeypair(secretBase58) {
  return Keypair.fromSecretKey(bs58.decode(secretBase58));
}

/// Signs arbitrary message bytes (a serialized Solana transaction's signable message, in
/// practice) with the attestor's Ed25519 keypair. Returns the raw 64-byte signature,
/// base58-encoded -- the shape `Transaction.addSignature(pubkey, Buffer)` on the frontend
/// expects after base58-decoding it back.
function signSolanaMessage(attestorKeypair, messageBytes) {
  const signature = nacl.sign.detached(messageBytes, attestorKeypair.secretKey);
  return bs58.encode(signature);
}

/// Offline check mirroring what a client-side nacl.sign.detached.verify call would do --
/// lets this be self-checked without a live chain, same role recoverAttestor plays for the
/// EVM version.
function verifySolanaSignature(attestorPublicKey, messageBytes, signatureBase58) {
  return nacl.sign.detached.verify(messageBytes, bs58.decode(signatureBase58), attestorPublicKey.toBytes());
}

module.exports = { loadSolanaAttestorKeypair, signSolanaMessage, verifySolanaSignature };
