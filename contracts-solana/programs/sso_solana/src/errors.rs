use anchor_lang::prelude::*;

#[error_code]
pub enum SsoError {
    #[msg("amount must be > 0")]
    ZeroAmount,
    #[msg("no epochs")]
    NoEpochs,
    #[msg("too many epochs for one campaign")]
    TooManyEpochs,
    #[msg("keyword required")]
    KeywordRequired,
    #[msg("keyword too long")]
    KeywordTooLong,
    #[msg("bad leaderboard size")]
    BadLeaderboardSize,
    #[msg("bad duration")]
    BadDuration,
    #[msg("bps must sum to 10000")]
    BpsMustSumTo10000,
    #[msg("campaign id does not match the config's next id")]
    BadCampaignId,
    #[msg("not keeper")]
    NotKeeper,
    #[msg("not authority")]
    NotAuthority,
    #[msg("epoch not yet ended")]
    EpochNotYetEnded,
    #[msg("challenge window elapsed")]
    ChallengeWindowElapsed,
    #[msg("epoch not finalized")]
    EpochNotFinalized,
    #[msg("challenge window still open")]
    ChallengeWindowOpen,
    #[msg("bad merkle proof")]
    BadProof,
    #[msg("epoch index out of range")]
    EpochIndexOutOfRange,
    #[msg("this campaign's reward is native SOL, not an SPL token")]
    NotNativeCampaign,
    #[msg("this campaign's reward is an SPL token, not native SOL")]
    NotSplCampaign,
    #[msg("treasury account does not match config.treasury")]
    BadTreasuryAccount,
    #[msg("arithmetic overflow")]
    Overflow,
}
