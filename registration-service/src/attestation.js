// Signs the attestation contracts/src/registry/Registry.sol's registerHandle() verifies
// on-chain: an ECDSA signature from the attestor over keccak256(abi.encodePacked(wallet,
// xHandle)), Ethereum-signed-message-prefixed (PRD §12.3-12.4, the "oauthProof" parameter in
// practice). This module owns exactly that one piece of math -- getting it subtly wrong here
// would mean every attestation this service issues fails Registry's on-chain check silently
// until someone actually tries to submit one.
"use strict";
const { ethers } = require("ethers");

/// Matches Registry.sol exactly:
///   keccak256(abi.encodePacked(msg.sender, xHandle)).toEthSignedMessageHash()
/// abi.encodePacked(address, string) -> ethers.solidityPacked(["address","string"], [...]).
/// ethers' Wallet.signMessage on a 32-byte BytesLike applies the same
/// "\x19Ethereum Signed Message:\n32" prefix as MessageHashUtils.toEthSignedMessageHash,
/// so this needs no separate prefixing step -- just sign the raw digest bytes.
async function signAttestation(attestorWallet, wallet, xHandle) {
  if (!ethers.isAddress(wallet)) throw new Error(`not a valid address: ${wallet}`);
  const digest = ethers.keccak256(ethers.solidityPacked(["address", "string"], [wallet, xHandle]));
  return attestorWallet.signMessage(ethers.getBytes(digest));
}

/// Offline check mirroring what Registry.registerHandle does on-chain (ECDSA.recover against
/// the same digest) -- lets this be verified without a live chain, and lets the service
/// self-check a signature it just produced before handing it back to a user.
function recoverAttestor(wallet, xHandle, signature) {
  const digest = ethers.keccak256(ethers.solidityPacked(["address", "string"], [wallet, xHandle]));
  return ethers.verifyMessage(ethers.getBytes(digest), signature);
}

module.exports = { signAttestation, recoverAttestor };
