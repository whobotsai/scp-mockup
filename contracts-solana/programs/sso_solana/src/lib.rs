//! Strong Shill Offering (SSO), ported to Solana.
//!
//! This is the Solana/Anchor counterpart of
//! contracts/src/sso/{SSOFactory,SSOCampaign}.sol. It mirrors sho_solana's structure
//! closely (see that program's lib.rs doc comment for the general Solidity->Anchor mapping
//! rationale — EIP-1167 clone -> PDA, unbounded `claimed` mapping -> per-claim receipt PDA,
//! single branching instruction -> split `_sol`/`_spl` instructions, no on-chain `status()`)
//! and is kept as a fully separate program rather than folded into sho_solana, for the same
//! reason SSOCampaign.sol is a sibling contract rather than merged into SHOCampaign.sol: per
//! PRD §12.3, the two state machines (one-way market-cap-gated milestones vs. recurring
//! scheduled epochs) are different enough that merging them would make both harder to
//! audit. Only the genuinely shared pieces (merkle verification, the `Types` enums, the
//! fee/challenge-window/duration/leaderboard-size constants) live in the `sho_sso_common`
//! crate both programs depend on — the same role contracts/src/libraries/*.sol and
//! FactoryBase.sol play for SHOFactory/SSOFactory on the EVM side.
//!
//! SSO-specific differences from the SHO port, beyond epochs-instead-of-milestones:
//! - `keyword` has no length cap in SSOCampaign.sol; this port caps it at
//!   `MAX_KEYWORD_LEN` purely because Solana account space must be fixed up front (see
//!   constants.rs).
//! - The EVM `epochRewardBpsList` has **no upper bound at all** — this port caps epoch
//!   count at `MAX_EPOCHS` for the same account-sizing reason, and for completeness flags
//!   that the EVM contract's lack of a cap is arguably its own latent gas-griefing risk
//!   (see constants.rs::MAX_EPOCHS's doc comment) — worth raising with whoever audits the
//!   EVM contracts, not something this port can fix for them.
//!
//! SECURITY / COMPLETENESS NOTE: same as sho_solana — this has only been run through
//! `cargo check` against a native target in a sandbox with no `solana`/`anchor` CLI. Not
//! built to BPF/SBF, not tested against a local validator, not deployed anywhere.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_instruction;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

pub mod constants;
pub mod errors;
pub mod state;

use constants::*;
use errors::SsoError;
use sho_sso_common::merkle;
use state::{Campaign, ClaimReceipt, Config, Epoch, EpochLength};

// Placeholder — replace with the real deployed program's own id (`anchor keys list` after
// `anchor build` generates target/deploy/sso_solana-keypair.json locally) before deploying
// anywhere but a throwaway localnet. Deliberately different from sho_solana's placeholder.
declare_id!("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin");

#[program]
pub mod sso_solana {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, treasury: Pubkey, keeper: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.bump = ctx.bumps.config;
        config.authority = ctx.accounts.authority.key();
        config.treasury = treasury;
        config.keeper = keeper;
        config.next_id = 0;
        Ok(())
    }

    pub fn set_treasury(ctx: Context<AdminOnly>, new_treasury: Pubkey) -> Result<()> {
        ctx.accounts.config.treasury = new_treasury;
        emit!(TreasuryUpdated { treasury: new_treasury });
        Ok(())
    }

    pub fn set_keeper(ctx: Context<AdminOnly>, new_keeper: Pubkey) -> Result<()> {
        ctx.accounts.config.keeper = new_keeper;
        emit!(KeeperUpdated { keeper: new_keeper });
        Ok(())
    }

    /// Native-SOL-reward campaign creation. Mirrors SSOFactory.sol::createCampaign's
    /// `rewardToken == address(0)` branch.
    #[allow(clippy::too_many_arguments)]
    pub fn create_campaign_sol(
        ctx: Context<CreateCampaignSol>,
        id: u64,
        token: Pubkey,
        amount: u64,
        keyword: String,
        epoch_length: EpochLength,
        leaderboard_size: u16,
        duration: i64,
        epoch_reward_bps_list: Vec<u16>,
    ) -> Result<()> {
        validate_campaign_params(amount, &keyword, leaderboard_size, duration, &epoch_reward_bps_list)?;
        require_eq!(ctx.accounts.config.next_id, id, SsoError::BadCampaignId);
        require_keys_eq!(ctx.accounts.treasury.key(), ctx.accounts.config.treasury, SsoError::BadTreasuryAccount);

        let (fee, net) = split_fee(amount);

        let transfer_fee_ix =
            system_instruction::transfer(&ctx.accounts.creator.key(), &ctx.accounts.treasury.key(), fee);
        anchor_lang::solana_program::program::invoke(
            &transfer_fee_ix,
            &[ctx.accounts.creator.to_account_info(), ctx.accounts.treasury.to_account_info()],
        )?;

        let transfer_net_ix =
            system_instruction::transfer(&ctx.accounts.creator.key(), &ctx.accounts.campaign.key(), net);
        anchor_lang::solana_program::program::invoke(
            &transfer_net_ix,
            &[ctx.accounts.creator.to_account_info(), ctx.accounts.campaign.to_account_info()],
        )?;

        init_campaign(
            &mut ctx.accounts.campaign,
            ctx.bumps.campaign,
            id,
            token,
            ctx.accounts.creator.key(),
            Pubkey::default(),
            net,
            keyword,
            epoch_length,
            leaderboard_size,
            duration,
            &epoch_reward_bps_list,
        )?;

        ctx.accounts.config.next_id = id.checked_add(1).ok_or(SsoError::Overflow)?;

        emit!(CampaignCreated {
            id,
            campaign: ctx.accounts.campaign.key(),
            creator: ctx.accounts.creator.key(),
            token,
            reward_mint: Pubkey::default(),
            total_locked: net,
        });
        Ok(())
    }

    /// SPL-token-reward campaign creation. Mirrors SSOFactory.sol::createCampaign's
    /// `rewardToken != address(0)` branch.
    #[allow(clippy::too_many_arguments)]
    pub fn create_campaign_spl(
        ctx: Context<CreateCampaignSpl>,
        id: u64,
        token: Pubkey,
        amount: u64,
        keyword: String,
        epoch_length: EpochLength,
        leaderboard_size: u16,
        duration: i64,
        epoch_reward_bps_list: Vec<u16>,
    ) -> Result<()> {
        validate_campaign_params(amount, &keyword, leaderboard_size, duration, &epoch_reward_bps_list)?;
        require_eq!(ctx.accounts.config.next_id, id, SsoError::BadCampaignId);

        let (fee, net) = split_fee(amount);
        let reward_mint = ctx.accounts.reward_mint.key();

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.creator_token_account.to_account_info(),
                    to: ctx.accounts.treasury_token_account.to_account_info(),
                    authority: ctx.accounts.creator.to_account_info(),
                },
            ),
            fee,
        )?;

        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.creator_token_account.to_account_info(),
                    to: ctx.accounts.vault_token_account.to_account_info(),
                    authority: ctx.accounts.creator.to_account_info(),
                },
            ),
            net,
        )?;

        init_campaign(
            &mut ctx.accounts.campaign,
            ctx.bumps.campaign,
            id,
            token,
            ctx.accounts.creator.key(),
            reward_mint,
            net,
            keyword,
            epoch_length,
            leaderboard_size,
            duration,
            &epoch_reward_bps_list,
        )?;

        ctx.accounts.config.next_id = id.checked_add(1).ok_or(SsoError::Overflow)?;

        emit!(CampaignCreated {
            id,
            campaign: ctx.accounts.campaign.key(),
            creator: ctx.accounts.creator.key(),
            token,
            reward_mint,
            total_locked: net,
        });
        Ok(())
    }

    /// Posts (or, within the still-open challenge window, corrects) the leaderboard
    /// snapshot for an epoch. Keeper-only. Mirrors SSOCampaign.sol::postEpochRoot exactly,
    /// including the "can only be called once the epoch's scheduled window has actually
    /// closed" check and the same challenge-window reset/correction semantics as SHO's
    /// `post_milestone_root`.
    pub fn post_epoch_root(
        ctx: Context<PostEpochRoot>,
        epoch_index: u16,
        merkle_root: [u8; 32],
        snapshot_hash: [u8; 32],
    ) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;
        let idx = epoch_index as usize;
        require!(idx < campaign.epoch_count as usize, SsoError::EpochIndexOutOfRange);

        let now = Clock::get()?.unix_timestamp;
        require!(now >= campaign.epochs[idx].ends_at, SsoError::EpochNotYetEnded);

        let first_time = !campaign.epochs[idx].finalized;
        require!(
            first_time || now < campaign.epochs[idx].challenge_window_ends,
            SsoError::ChallengeWindowElapsed
        );

        campaign.epochs[idx].merkle_root = merkle_root;
        campaign.epochs[idx].snapshot_hash = snapshot_hash;
        let challenge_window_ends = now.checked_add(CHALLENGE_WINDOW_SECS).ok_or(SsoError::Overflow)?;
        campaign.epochs[idx].challenge_window_ends = challenge_window_ends;

        if first_time {
            campaign.epochs[idx].finalized = true;
            emit!(EpochFinalized { campaign: campaign.key(), epoch_index, ends_at: campaign.epochs[idx].ends_at });
            emit!(RootPosted { campaign: campaign.key(), epoch_index, merkle_root, snapshot_hash, challenge_window_ends });
        } else {
            emit!(RootCorrected { campaign: campaign.key(), epoch_index, merkle_root, snapshot_hash, challenge_window_ends });
        }
        Ok(())
    }

    /// Claims a native-SOL reward. Mirrors SSOCampaign.sol::claim's `rewardToken ==
    /// address(0)` payout branch.
    pub fn claim_sol(ctx: Context<ClaimSol>, epoch_index: u16, amount: u64, proof: Vec<[u8; 32]>) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;
        require!(campaign.is_native(), SsoError::NotNativeCampaign);

        let idx = epoch_index as usize;
        require!(idx < campaign.epoch_count as usize, SsoError::EpochIndexOutOfRange);
        let e = &campaign.epochs[idx];
        require!(e.finalized, SsoError::EpochNotFinalized);

        let now = Clock::get()?.unix_timestamp;
        require!(now >= e.challenge_window_ends, SsoError::ChallengeWindowOpen);
        require!(
            merkle::verify(&proof, e.merkle_root, &ctx.accounts.claimant.key(), amount),
            SsoError::BadProof
        );

        campaign.epochs[idx].total_claimed =
            campaign.epochs[idx].total_claimed.checked_add(amount).ok_or(SsoError::Overflow)?;
        ctx.accounts.claim_receipt.bump = ctx.bumps.claim_receipt;

        **campaign.to_account_info().try_borrow_mut_lamports()? = campaign
            .to_account_info()
            .lamports()
            .checked_sub(amount)
            .ok_or(SsoError::Overflow)?;
        **ctx.accounts.claimant.to_account_info().try_borrow_mut_lamports()? = ctx
            .accounts
            .claimant
            .to_account_info()
            .lamports()
            .checked_add(amount)
            .ok_or(SsoError::Overflow)?;

        emit!(RewardClaimed { campaign: campaign.key(), epoch_index, account: ctx.accounts.claimant.key(), amount });
        Ok(())
    }

    /// Claims an SPL-token reward. Mirrors SSOCampaign.sol::claim's `rewardToken !=
    /// address(0)` payout branch.
    pub fn claim_spl(ctx: Context<ClaimSpl>, epoch_index: u16, amount: u64, proof: Vec<[u8; 32]>) -> Result<()> {
        {
            let campaign = &ctx.accounts.campaign;
            require!(!campaign.is_native(), SsoError::NotSplCampaign);

            let idx = epoch_index as usize;
            require!(idx < campaign.epoch_count as usize, SsoError::EpochIndexOutOfRange);
            let e = &campaign.epochs[idx];
            require!(e.finalized, SsoError::EpochNotFinalized);

            let now = Clock::get()?.unix_timestamp;
            require!(now >= e.challenge_window_ends, SsoError::ChallengeWindowOpen);
            require!(
                merkle::verify(&proof, e.merkle_root, &ctx.accounts.claimant.key(), amount),
                SsoError::BadProof
            );
        }

        let idx = epoch_index as usize;
        ctx.accounts.campaign.epochs[idx].total_claimed = ctx.accounts.campaign.epochs[idx]
            .total_claimed
            .checked_add(amount)
            .ok_or(SsoError::Overflow)?;
        ctx.accounts.claim_receipt.bump = ctx.bumps.claim_receipt;

        let config_key = ctx.accounts.config.key();
        let campaign_id_bytes = ctx.accounts.campaign.id.to_le_bytes();
        let campaign_bump = ctx.accounts.campaign.bump;
        let signer_seeds: &[&[u8]] =
            &[CAMPAIGN_SEED, config_key.as_ref(), &campaign_id_bytes, &[campaign_bump]];

        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                Transfer {
                    from: ctx.accounts.vault_token_account.to_account_info(),
                    to: ctx.accounts.claimant_token_account.to_account_info(),
                    authority: ctx.accounts.campaign.to_account_info(),
                },
                &[signer_seeds],
            ),
            amount,
        )?;

        emit!(RewardClaimed {
            campaign: ctx.accounts.campaign.key(),
            epoch_index,
            account: ctx.accounts.claimant.key(),
            amount
        });
        Ok(())
    }
}

// ===================== shared validation / init helpers =====================

fn split_fee(amount: u64) -> (u64, u64) {
    let fee = amount * PROTOCOL_FEE_BPS / BPS_DENOMINATOR;
    (fee, amount - fee)
}

fn validate_campaign_params(
    amount: u64,
    keyword: &str,
    leaderboard_size: u16,
    duration: i64,
    epoch_reward_bps_list: &[u16],
) -> Result<()> {
    require!(amount > 0, SsoError::ZeroAmount);
    require!(!keyword.is_empty(), SsoError::KeywordRequired);
    require!(keyword.len() <= MAX_KEYWORD_LEN, SsoError::KeywordTooLong);
    require!(
        leaderboard_size == LEADERBOARD_SIZE_50
            || leaderboard_size == LEADERBOARD_SIZE_100
            || leaderboard_size == LEADERBOARD_SIZE_500,
        SsoError::BadLeaderboardSize
    );
    require!(
        duration == DURATION_7D || duration == DURATION_30D || duration == DURATION_90D,
        SsoError::BadDuration
    );
    require!(!epoch_reward_bps_list.is_empty(), SsoError::NoEpochs);
    require!(epoch_reward_bps_list.len() <= MAX_EPOCHS, SsoError::TooManyEpochs);

    let sum: u32 = epoch_reward_bps_list.iter().map(|&b| b as u32).sum();
    require_eq!(sum, BPS_DENOMINATOR as u32, SsoError::BpsMustSumTo10000);

    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn init_campaign(
    campaign: &mut Account<Campaign>,
    bump: u8,
    id: u64,
    token: Pubkey,
    creator: Pubkey,
    reward_mint: Pubkey,
    total_locked: u64,
    keyword: String,
    epoch_length: EpochLength,
    leaderboard_size: u16,
    duration: i64,
    epoch_reward_bps_list: &[u16],
) -> Result<()> {
    let epoch_seconds = epoch_length.seconds();
    let created_at = Clock::get()?.unix_timestamp;

    let mut epochs = Vec::with_capacity(epoch_reward_bps_list.len());
    for (i, &reward_bps) in epoch_reward_bps_list.iter().enumerate() {
        let offset = epoch_seconds.checked_mul(i as i64 + 1).ok_or(SsoError::Overflow)?;
        epochs.push(Epoch {
            epoch_index: i as u32,
            reward_bps,
            ends_at: created_at.checked_add(offset).ok_or(SsoError::Overflow)?,
            ..Epoch::EMPTY
        });
    }

    campaign.bump = bump;
    campaign.id = id;
    campaign.token = token;
    campaign.creator = creator;
    campaign.reward_mint = reward_mint;
    campaign.total_locked = total_locked;
    campaign.keyword = keyword;
    campaign.epoch_length = epoch_length;
    campaign.leaderboard_size = leaderboard_size;
    campaign.duration = duration;
    campaign.created_at = created_at;
    campaign.epoch_count = epoch_reward_bps_list.len() as u16;
    campaign.epochs = epochs;
    Ok(())
}

// ===================== accounts =====================

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(init, payer = authority, space = 8 + Config::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, Config>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub authority: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = authority @ SsoError::NotAuthority)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct CreateCampaignSol<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = creator,
        space = 8 + Campaign::INIT_SPACE,
        seeds = [CAMPAIGN_SEED, config.key().as_ref(), &id.to_le_bytes()],
        bump
    )]
    pub campaign: Account<'info, Campaign>,

    /// CHECK: validated against config.treasury in the handler; a plain lamport-receiving
    /// system account, same role as FactoryBase.sol's `treasury` address.
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct CreateCampaignSpl<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = creator,
        space = 8 + Campaign::INIT_SPACE,
        seeds = [CAMPAIGN_SEED, config.key().as_ref(), &id.to_le_bytes()],
        bump
    )]
    pub campaign: Account<'info, Campaign>,

    pub reward_mint: Account<'info, Mint>,

    #[account(mut, token::mint = reward_mint, token::authority = creator)]
    pub creator_token_account: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = creator,
        associated_token::mint = reward_mint,
        associated_token::authority = treasury_authority
    )]
    pub treasury_token_account: Account<'info, TokenAccount>,

    /// CHECK: only used to seed/validate `treasury_token_account`'s associated-token
    /// address; must equal config.treasury (checked below).
    #[account(constraint = treasury_authority.key() == config.treasury @ SsoError::BadTreasuryAccount)]
    pub treasury_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = creator,
        associated_token::mint = reward_mint,
        associated_token::authority = campaign
    )]
    pub vault_token_account: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PostEpochRoot<'info> {
    pub keeper: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, constraint = keeper.key() == config.keeper @ SsoError::NotKeeper)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [CAMPAIGN_SEED, config.key().as_ref(), &campaign.id.to_le_bytes()],
        bump = campaign.bump
    )]
    pub campaign: Account<'info, Campaign>,
}

#[derive(Accounts)]
#[instruction(epoch_index: u16)]
pub struct ClaimSol<'info> {
    #[account(mut)]
    pub claimant: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [CAMPAIGN_SEED, config.key().as_ref(), &campaign.id.to_le_bytes()],
        bump = campaign.bump
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(
        init,
        payer = claimant,
        space = 8 + ClaimReceipt::INIT_SPACE,
        seeds = [CLAIM_SEED, campaign.key().as_ref(), &epoch_index.to_le_bytes(), claimant.key().as_ref()],
        bump
    )]
    pub claim_receipt: Account<'info, ClaimReceipt>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(epoch_index: u16)]
pub struct ClaimSpl<'info> {
    #[account(mut)]
    pub claimant: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [CAMPAIGN_SEED, config.key().as_ref(), &campaign.id.to_le_bytes()],
        bump = campaign.bump
    )]
    pub campaign: Account<'info, Campaign>,

    #[account(constraint = reward_mint.key() == campaign.reward_mint @ SsoError::NotSplCampaign)]
    pub reward_mint: Account<'info, Mint>,

    #[account(mut, associated_token::mint = reward_mint, associated_token::authority = campaign)]
    pub vault_token_account: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = claimant,
        associated_token::mint = reward_mint,
        associated_token::authority = claimant
    )]
    pub claimant_token_account: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = claimant,
        space = 8 + ClaimReceipt::INIT_SPACE,
        seeds = [CLAIM_SEED, campaign.key().as_ref(), &epoch_index.to_le_bytes(), claimant.key().as_ref()],
        bump
    )]
    pub claim_receipt: Account<'info, ClaimReceipt>,

    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// ===================== events =====================

#[event]
pub struct TreasuryUpdated {
    pub treasury: Pubkey,
}

#[event]
pub struct KeeperUpdated {
    pub keeper: Pubkey,
}

#[event]
pub struct CampaignCreated {
    pub id: u64,
    pub campaign: Pubkey,
    pub creator: Pubkey,
    pub token: Pubkey,
    pub reward_mint: Pubkey,
    pub total_locked: u64,
}

#[event]
pub struct EpochFinalized {
    pub campaign: Pubkey,
    pub epoch_index: u16,
    pub ends_at: i64,
}

#[event]
pub struct RootPosted {
    pub campaign: Pubkey,
    pub epoch_index: u16,
    pub merkle_root: [u8; 32],
    pub snapshot_hash: [u8; 32],
    pub challenge_window_ends: i64,
}

#[event]
pub struct RootCorrected {
    pub campaign: Pubkey,
    pub epoch_index: u16,
    pub merkle_root: [u8; 32],
    pub snapshot_hash: [u8; 32],
    pub challenge_window_ends: i64,
}

#[event]
pub struct RewardClaimed {
    pub campaign: Pubkey,
    pub epoch_index: u16,
    pub account: Pubkey,
    pub amount: u64,
}
