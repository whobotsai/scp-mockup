use anchor_lang::prelude::*;
use anchor_lang::solana_program::keccak;

use crate::constants::MAX_X_HANDLE_LEN;

/// Protocol-wide singleton. Mirrors contracts/src/registry/Registry.sol's `Ownable` owner
/// (authority) plus its `attestor` address -- plus a `next_registration_id` counter neither
/// EVM version needed (Registry.sol has no analogous counter; this one exists purely so the
/// keeper can discover registrations the same cheap way it discovers campaigns -- see
/// `Registration` below and keeper/src/registrySolanaIndexer.js's own header).
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub bump: u8,
    pub authority: Pubkey,
    pub attestor: Pubkey,
    pub next_registration_id: u64,
}

/// Current wallet -> handle link. Mirrors Registry.sol's `mapping(address => string)
/// handleOf`, one PDA per wallet instead of a Solidity mapping slot.
///
/// DELIBERATE V1 SIMPLIFICATION: created once via Anchor's `init` constraint (see
/// `RegisterHandle` in lib.rs), which fails if the account already exists -- so a wallet can
/// link exactly one X handle, ever, and can't switch to a different one later. Registry.sol
/// supports switching (its `registerHandle` releases the caller's previous handle before
/// linking a new one); replicating that on Solana would mean conditionally closing this PDA
/// and `WalletOfHandle` below mid-instruction based on whether a previous link exists, which
/// Anchor's declarative `#[account(close = ...)]` can't express conditionally -- it would
/// need a second instruction (e.g. `update_handle`) built around manual lamport/data
/// zeroing. Deferred rather than rushed: revisit if "switch your linked handle" turns out to
/// be a real product need, same spirit as every other "simpler than EVM for v1" choice in
/// this package (see sho_solana/README.md's own list).
#[account]
#[derive(InitSpace)]
pub struct HandleLink {
    pub bump: u8,
    pub wallet: Pubkey,
    #[max_len(MAX_X_HANDLE_LEN)]
    pub x_handle: String,
    pub linked_at: i64,
}

/// Reverse index enforcing "one wallet per X handle" -- mirrors Registry.sol's
/// `mapping(bytes32 => address) walletOfHandle`, keyed the same way (a case-normalized hash
/// of the handle, via `normalized_handle_key` below) for the same reason: X handles aren't
/// case-sensitive, so two differently-cased spellings of the same handle must collide into
/// the same slot. Also created once via `init` (same v1 simplification as HandleLink) --
/// since nothing can ever release a handle once linked in v1, a handle that's been claimed
/// stays claimed by that wallet permanently.
#[account]
#[derive(InitSpace)]
pub struct WalletOfHandle {
    pub bump: u8,
    pub wallet: Pubkey,
}

/// Append-only discovery log -- Registry.sol's keeper-side counterpart
/// (keeper/src/registrationIndexer.js) watches a `HandleRegistered` event log, which Solana
/// has no cheap equivalent of scanning historically (see
/// contracts-solana/programs/sho_solana/src/lib.rs's own header on why campaigns use the
/// same pattern). One PDA per registration, id-indexed off Config.next_registration_id --
/// keeper/src/registrySolanaIndexer.js discovers new ones the identical way
/// solanaCampaignIndexer.js discovers new campaigns: derive the PDA for each id between its
/// stored cursor and Config's current counter, fetch, decode.
#[account]
#[derive(InitSpace)]
pub struct Registration {
    pub bump: u8,
    pub id: u64,
    pub wallet: Pubkey,
    #[max_len(MAX_X_HANDLE_LEN)]
    pub x_handle: String,
}

/// ASCII-lowercases `s` and hashes the result with Solana's native Keccak-256 syscall --
/// direct Solana port of Registry.sol's `_normalizedKey` (see that function's own comment on
/// why a full Unicode case-fold isn't needed: X handles are ASCII only). Kept as a free
/// function (not a method) so it's callable from an `Accounts` struct's `#[instruction(...)]`
/// seeds expression in lib.rs, the same way sho_solana/sso_solana's PDA seeds reference
/// plain values computed ahead of account validation.
pub fn normalized_handle_key(x_handle: &str) -> [u8; 32] {
    let lower: Vec<u8> = x_handle
        .bytes()
        .map(|c| if c.is_ascii_uppercase() { c + 32 } else { c })
        .collect();
    keccak::hash(&lower).to_bytes()
}
