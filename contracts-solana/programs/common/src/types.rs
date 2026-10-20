use anchor_lang::prelude::*;

/// Mirrors contracts/src/libraries/Types.sol — one shared library used by both SHO and SSO
/// on the EVM side, so it stays one shared crate here too, even though
/// `MilestoneTier` is SHO-only and `EpochLength` is SSO-only (the Solidity file mixes all
/// four enums the same way).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum LeaderboardWindow {
    H24,
    D7,
    D30,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace)]
pub enum EpochLength {
    H24,
    D7,
    D30,
}

impl EpochLength {
    pub fn seconds(self) -> i64 {
        match self {
            EpochLength::H24 => 86_400,
            EpochLength::D7 => 7 * 86_400,
            EpochLength::D30 => 30 * 86_400,
        }
    }
}

/// Exactly these four fixed tiers, per PRD §4.1 and §5 — not free-form.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, InitSpace)]
pub enum MilestoneTier {
    M100K,
    M250K,
    M1M,
    M5M,
}

/// Not stored on-chain by either Solana program (see sho_solana's lib.rs doc comment on why
/// `status()` has no Solana equivalent) — kept here only so this file mirrors Types.sol
/// completely.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum CampaignStatus {
    Active,
    Completed,
    Expired,
}
