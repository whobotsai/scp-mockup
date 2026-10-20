use anchor_lang::prelude::*;

use crate::constants::{MAX_EPOCHS, MAX_KEYWORD_LEN};
pub use sho_sso_common::types::EpochLength;

/// Mirrors SSOCampaign.sol's `Epoch` struct.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct Epoch {
    pub epoch_index: u32,
    pub reward_bps: u16,
    /// One-way: never flips back once true.
    pub finalized: bool,
    pub merkle_root: [u8; 32],
    pub snapshot_hash: [u8; 32],
    /// Scheduled epoch window close, fixed at campaign creation.
    pub ends_at: i64,
    pub challenge_window_ends: i64,
    pub total_claimed: u64,
}

impl Epoch {
    pub const EMPTY: Epoch = Epoch {
        epoch_index: 0,
        reward_bps: 0,
        finalized: false,
        merkle_root: [0u8; 32],
        snapshot_hash: [0u8; 32],
        ends_at: 0,
        challenge_window_ends: 0,
        total_claimed: 0,
    };
}

/// Protocol-wide singleton, same role as sho_solana::state::Config but under this
/// program's own id — SHOFactory and SSOFactory are two separately-deployed Solidity
/// contracts, each with its own owner/treasury/keeper, so the Solana programs each get
/// their own Config too rather than sharing one.
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub bump: u8,
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub keeper: Pubkey,
    pub next_id: u64,
}

/// Per-campaign state. Mirrors SSOCampaign.sol.
#[account]
#[derive(InitSpace)]
pub struct Campaign {
    pub bump: u8,
    pub id: u64,
    pub token: Pubkey,
    pub creator: Pubkey,
    /// `Pubkey::default()` (all-zero) means the reward asset is native SOL — same
    /// sentinel role as sho_solana's `Campaign::reward_mint`.
    pub reward_mint: Pubkey,
    pub total_locked: u64,
    #[max_len(MAX_KEYWORD_LEN)]
    pub keyword: String,
    pub epoch_length: EpochLength,
    pub leaderboard_size: u16,
    pub duration: i64,
    pub created_at: i64,
    pub epoch_count: u16,
    #[max_len(MAX_EPOCHS)]
    pub epochs: Vec<Epoch>,
}

impl Campaign {
    pub fn is_native(&self) -> bool {
        self.reward_mint == Pubkey::default()
    }
}

/// Existence-as-claimed-flag PDA — same pattern as sho_solana::state::ClaimReceipt,
/// standing in for SSOCampaign.sol's `mapping(uint256 => mapping(address => bool)) claimed`.
#[account]
#[derive(InitSpace)]
pub struct ClaimReceipt {
    pub bump: u8,
}
