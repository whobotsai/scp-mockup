// Shared with sso_solana via the `sho_sso_common` crate: PROTOCOL_FEE_BPS,
// BPS_DENOMINATOR, CHALLENGE_WINDOW_SECS, DURATION_*, LEADERBOARD_SIZE_*,
// CONFIG_SEED, CAMPAIGN_SEED, CLAIM_SEED.
pub use sho_sso_common::constants::*;

/// SHO-specific: mirrors contracts/src/sho/SHOCampaign.sol::MAX_MILESTONES — exactly the
/// four fixed tiers in PRD §4.1/§5, not free-form. (SSO has no equivalent cap in Solidity;
/// see sso_solana/src/constants.rs::MAX_EPOCHS for why Solana needs one anyway.)
pub const MAX_MILESTONES: usize = 4;
