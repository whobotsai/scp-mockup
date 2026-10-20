// Shared with sho_solana via the `sho_sso_common` crate: PROTOCOL_FEE_BPS,
// BPS_DENOMINATOR, CHALLENGE_WINDOW_SECS, DURATION_*, LEADERBOARD_SIZE_*,
// CONFIG_SEED, CAMPAIGN_SEED, CLAIM_SEED.
pub use sho_sso_common::constants::*;

/// SSO-specific, and with no Solidity equivalent: contracts/src/sso/SSOCampaign.sol's
/// `initialize()` only checks `epochRewardBpsList.length > 0` — there is no upper bound at
/// all on the EVM side. That's arguably a latent gas-griefing risk there too (an
/// attacker-sized `epochRewardBpsList` would make `initialize()`'s `.push()` loop
/// arbitrarily expensive), but it isn't this port's place to silently change EVM behavior;
/// flag it back to the EVM contract's own audit instead.
///
/// On Solana, an account's size must be fixed at creation time, so *some* cap is mandatory.
/// 90 covers the worst realistic case: a 90-day campaign (the longest allowed `duration`)
/// with `EpochLength::H24` (the shortest epoch) is 90 daily epochs — and `duration` isn't
/// actually validated against epoch count by either contract, so this is a generous
/// ceiling, not a tight derivation.
pub const MAX_EPOCHS: usize = 90;

/// SSO-specific, and with no Solidity equivalent either (`string keyword` has no length
/// check in SSOCampaign.sol). Capped here only because a Solana account needs a fixed max
/// size up front; 64 bytes comfortably covers any real X hashtag/cashtag.
pub const MAX_KEYWORD_LEN: usize = 64;
