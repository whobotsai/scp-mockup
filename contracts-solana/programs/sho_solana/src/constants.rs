/// Mirrors contracts/src/sho/SHOCampaign.sol::MAX_MILESTONES — exactly the four fixed
/// tiers in PRD §4.1/§5, not free-form.
pub const MAX_MILESTONES: usize = 4;

/// Mirrors contracts/src/sho/SHOCampaign.sol::CHALLENGE_WINDOW (24 hours, PRD §5).
pub const CHALLENGE_WINDOW_SECS: i64 = 24 * 60 * 60;

/// Mirrors contracts/src/base/FactoryBase.sol::PROTOCOL_FEE_BPS / BPS_DENOMINATOR
/// (0.5% of the locked pool, taken at campaign creation — PRD §5).
pub const PROTOCOL_FEE_BPS: u64 = 50;
pub const BPS_DENOMINATOR: u64 = 10_000;

/// Allowed `duration` values, in seconds — mirrors SHOFactory.sol::createCampaign's
/// `duration == 7 days || duration == 30 days || duration == 90 days` check.
pub const DURATION_7D: i64 = 7 * 86_400;
pub const DURATION_30D: i64 = 30 * 86_400;
pub const DURATION_90D: i64 = 90 * 86_400;

/// Allowed `leaderboard_size` values — mirrors SHOFactory.sol's
/// `leaderboardSize == 50 || leaderboardSize == 100 || leaderboardSize == 500` check.
pub const LEADERBOARD_SIZE_50: u16 = 50;
pub const LEADERBOARD_SIZE_100: u16 = 100;
pub const LEADERBOARD_SIZE_500: u16 = 500;

pub const CONFIG_SEED: &[u8] = b"config";
pub const CAMPAIGN_SEED: &[u8] = b"campaign";
pub const CLAIM_SEED: &[u8] = b"claim";
