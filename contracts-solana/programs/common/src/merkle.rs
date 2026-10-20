//! Merkle-claim verification shared by sho_solana and sso_solana.
//!
//! The Solana counterpart of contracts/src/libraries/ClaimVerifier.sol: same double-hashed
//! leaf (the standard mitigation against second-preimage attacks) and the same sorted-pair
//! internal-node convention as keeper/src/merkleTree.js's `hashPair`, so a Solana-aware tree
//! builder can reuse the identical algorithm shape — only the leaf encoding changes, because
//! a Pubkey is 32 bytes (no left-padding needed, unlike a 20-byte Ethereum address under
//! `abi.encode`).
//!
//! Leaf encoding: `keccak256(keccak256(account_pubkey(32 bytes) || amount_be(32 bytes)))`.
//! `amount` is widened from u64 to a 32-byte big-endian buffer (zero-padded) purely so the
//! on-the-wire shape matches Solidity's uint256 encoding; a future keeper-side Solana tree
//! builder must use this exact encoding, not keeper/src/merkleTree.js's address/uint256
//! version, to produce compatible proofs.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;

pub fn leaf(account: &Pubkey, amount: u64) -> [u8; 32] {
    let mut amount_be = [0u8; 32];
    amount_be[24..32].copy_from_slice(&amount.to_be_bytes());

    let inner = keccak::hashv(&[account.as_ref(), &amount_be]);
    keccak::hash(inner.as_ref()).to_bytes()
}

fn hash_pair(a: [u8; 32], b: [u8; 32]) -> [u8; 32] {
    if a <= b {
        keccak::hashv(&[&a, &b]).to_bytes()
    } else {
        keccak::hashv(&[&b, &a]).to_bytes()
    }
}

pub fn verify(proof: &[[u8; 32]], root: [u8; 32], account: &Pubkey, amount: u64) -> bool {
    let mut computed = leaf(account, amount);
    for sibling in proof {
        computed = hash_pair(computed, *sibling);
    }
    computed == root
}
