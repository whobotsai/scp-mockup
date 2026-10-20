use anchor_lang::prelude::*;

#[error_code]
pub enum ShoError {
    #[msg("amount must be > 0")]
    ZeroAmount,
    #[msg("bad leaderboard size")]
    BadLeaderboardSize,
    #[msg("bad duration")]
    BadDuration,
    #[msg("bad milestone count")]
    BadMilestoneCount,
    #[msg("tiers and reward bps length mismatch")]
    LengthMismatch,
    #[msg("tiers must strictly increase")]
    TiersMustStrictlyIncrease,
    #[msg("bps must sum to 10000")]
    BpsMustSumTo10000,
    #[msg("campaign id does not match the config's next id")]
    BadCampaignId,
    #[msg("not keeper")]
    NotKeeper,
    #[msg("not authority")]
    NotAuthority,
    #[msg("challenge window elapsed")]
    ChallengeWindowElapsed,
    #[msg("milestone not reached")]
    MilestoneNotReached,
    #[msg("challenge window still open")]
    ChallengeWindowOpen,
    #[msg("bad merkle proof")]
    BadProof,
    #[msg("milestone index out of range")]
    MilestoneIndexOutOfRange,
    #[msg("this campaign's reward is native SOL, not an SPL token")]
    NotNativeCampaign,
    #[msg("this campaign's reward is an SPL token, not native SOL")]
    NotSplCampaign,
    #[msg("treasury account does not match config.treasury")]
    BadTreasuryAccount,
    #[msg("arithmetic overflow")]
    Overflow,
}
