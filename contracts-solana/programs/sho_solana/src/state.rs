use anchor_lang::prelude::*;

use crate::constants::MAX_MILESTONES;
pub use sho_sso_common::types::{LeaderboardWindow, MilestoneTier};

/// Mirrors SHOCampaign.sol's `Milestone` struct.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, InitSpace)]
pub struct Milestone {
    pub tier: MilestoneTier,
    pub reward_bps: u16,
    /// One-way: never flips back once true (PRD §4.1).
    pub reached: bool,
    pub merkle_root: [u8; 32],
    pub snapshot_hash: [u8; 32],
    pub reached_at: i64,
    pub challenge_window_ends: i64,
    pub total_claimed: u64,
}

impl Milestone {
    pub const EMPTY: Milestone = Milestone {
        tier: MilestoneTier::M100K,
        reward_bps: 0,
        reached: false,
        merkle_root: [0u8; 32],
        snapshot_hash: [0u8; 32],
        reached_at: 0,
        challenge_window_ends: 0,
        total_claimed: 0,
    };
}

/// Protocol-wide singleton. Mirrors contracts/src/base/FactoryBase.sol's admin state
/// (treasury, keeper) plus SHOFactory.sol's `nextId` counter. One Config account serves
/// every SHO campaign on Solana, the same way one SHOFactory deployment serves every SHO
/// clone on the EVM side.
#[account]
#[derive(InitSpace)]
pub struct Config {
    pub bump: u8,
    /// Mirrors FactoryBase's `Ownable` owner.
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub keeper: Pubkey,
    /// Mirrors SHOFactory.sol's `nextId` — the id to use for the *next* campaign created.
    /// Campaign creation instructions take this as an explicit argument (rather than reading
    /// it from this account inside the handler) because an Anchor account's PDA seeds must
    /// be derivable before the handler body runs; the handler asserts the passed `id` equals
    /// this field, then increments it.
    pub next_id: u64,
}

/// Per-campaign state. Mirrors SHOCampaign.sol. One PDA per campaign, seeded off the
/// Config singleton and this campaign's id — there is no "clone" deploy step on Solana,
/// the account itself plays the role an EIP-1167 clone's storage would on EVM.
#[account]
#[derive(InitSpace)]
pub struct Campaign {
    pub bump: u8,
    pub id: u64,
    /// The campaigning token's mint — informational only, same as SHOCampaign.sol's
    /// `token`; the keeper's price/TWAP oracle tracks this off-chain.
    pub token: Pubkey,
    pub creator: Pubkey,
    /// `Pubkey::default()` (all-zero) means the reward asset is native SOL — the same
    /// sentinel role Solidity's `address(0)` plays for `rewardToken`.
    pub reward_mint: Pubkey,
    /// Net of the protocol fee (PRD §4.1) — what actually sits in the vault/account.
    pub total_locked: u64,
    pub window: LeaderboardWindow,
    pub leaderboard_size: u16,
    /// Seconds, not a slot count — mirrors SHOCampaign.sol's `duration` (a block.timestamp
    /// delta), compared against Solana's `Clock::unix_timestamp`.
    pub duration: i64,
    pub created_at: i64,
    pub milestone_count: u8,
    pub milestones: [Milestone; MAX_MILESTONES],
}

impl Campaign {
    pub fn is_native(&self) -> bool {
        self.reward_mint == Pubkey::default()
    }
}

/// Existence-as-claimed-flag PDA. Mirrors SHOCampaign.sol's
/// `mapping(uint256 => mapping(address => bool)) public claimed` — Solana account data
/// can't hold an unbounded mapping, so each (campaign, milestone, claimant) triple gets its
/// own tiny PDA instead; Anchor's `init` constraint already fails with an "account already
/// in use" style error if it exists, which is exactly the "already claimed" check.
#[account]
#[derive(InitSpace)]
pub struct ClaimReceipt {
    pub bump: u8,
}
