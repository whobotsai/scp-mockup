//! Strong Hold Offering (SHO), ported to Solana.
//!
//! This is the Solana/Anchor counterpart of contracts/src/sho/{SHOFactory,SHOCampaign}.sol
//! and contracts/src/base/FactoryBase.sol. There is no EIP-1167 "clone" step on Solana —
//! each campaign is its own PDA account instead of its own deployed contract, but the state
//! shape, validation rules, and instruction semantics are kept as close to the Solidity
//! reference as the two chains' account models allow. Differences from the EVM version,
//! and why, are called out inline where they matter:
//!
//! - No on-chain `claimed` mapping (Solana account data can't hold an unbounded map) — each
//!   claim gets its own tiny `ClaimReceipt` PDA instead (see state.rs).
//! - `create_campaign` is split into `create_campaign_sol` / `create_campaign_spl` (and
//!   likewise `claim_sol` / `claim_spl`) rather than Solidity's single `rewardToken ==
//!   address(0)` branch, because Anchor account validation needs concrete account types
//!   up front, not a runtime branch inside the handler.
//! - Merkle leaf encoding differs (../common/src/merkle.rs, shared with sso_solana)
//!   because a Pubkey is 32 bytes, not a
//!   20-byte-left-padded-to-32 Ethereum address.
//! - `status()` (Active/Completed/Expired) isn't computed on-chain; it was a free `view`
//!   function on EVM, but Solana has no non-billable "read" instruction distinct from a
//!   plain account-data fetch, so clients compute it from `Campaign`'s fields directly, the
//!   same way they'd compute it from any other on-chain struct.
//!
//! SECURITY / COMPLETENESS NOTE: this program has not been built against the real Solana
//! BPF/SBF toolchain or exercised with `anchor test` + a local validator in this
//! environment (the sandbox this was written in has no `solana`/`anchor` CLI and blocks the
//! platform-tools download) — only `cargo check` against a native target. Treat it as a
//! first-pass port that still needs: a local Anchor toolchain to actually build/deploy it,
//! the TS test suite in tests/ run end-to-end, and the same security hardening pass the
//! EVM contracts still need before mainnet (see contracts/README.md's "Open items" and
//! docs/BACKEND_ROADMAP.md's Stage 3).

use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_instruction;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

pub mod constants;
pub mod errors;
pub mod state;

use constants::*;
use errors::ShoError;
use sho_sso_common::merkle;
use state::{Campaign, ClaimReceipt, Config, LeaderboardWindow, Milestone, MilestoneTier};

// Placeholder — replace with the real deployed program's own id (`anchor keys list` after
// `anchor build` generates target/deploy/sho_solana-keypair.json locally) before deploying
// anywhere but a throwaway localnet.
declare_id!("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

#[program]
pub mod sho_solana {
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

    /// Native-SOL-reward campaign creation. Mirrors SHOFactory.sol::createCampaign's
    /// `rewardToken == address(0)` branch.
    pub fn create_campaign_sol(
        ctx: Context<CreateCampaignSol>,
        id: u64,
        token: Pubkey,
        amount: u64,
        window: LeaderboardWindow,
        leaderboard_size: u16,
        duration: i64,
        tiers: Vec<MilestoneTier>,
        reward_bps_list: Vec<u16>,
    ) -> Result<()> {
        validate_campaign_params(amount, leaderboard_size, duration, &tiers, &reward_bps_list)?;
        require_eq!(ctx.accounts.config.next_id, id, ShoError::BadCampaignId);
        require_keys_eq!(ctx.accounts.treasury.key(), ctx.accounts.config.treasury, ShoError::BadTreasuryAccount);

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
            window,
            leaderboard_size,
            duration,
            &tiers,
            &reward_bps_list,
        )?;

        ctx.accounts.config.next_id = id.checked_add(1).ok_or(ShoError::Overflow)?;

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

    /// SPL-token-reward campaign creation. Mirrors SHOFactory.sol::createCampaign's
    /// `rewardToken != address(0)` branch.
    #[allow(clippy::too_many_arguments)]
    pub fn create_campaign_spl(
        ctx: Context<CreateCampaignSpl>,
        id: u64,
        token: Pubkey,
        amount: u64,
        window: LeaderboardWindow,
        leaderboard_size: u16,
        duration: i64,
        tiers: Vec<MilestoneTier>,
        reward_bps_list: Vec<u16>,
    ) -> Result<()> {
        validate_campaign_params(amount, leaderboard_size, duration, &tiers, &reward_bps_list)?;
        require_eq!(ctx.accounts.config.next_id, id, ShoError::BadCampaignId);

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
            window,
            leaderboard_size,
            duration,
            &tiers,
            &reward_bps_list,
        )?;

        ctx.accounts.config.next_id = id.checked_add(1).ok_or(ShoError::Overflow)?;

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
    /// snapshot for a milestone. Keeper-only. Mirrors SHOCampaign.sol::postMilestoneRoot
    /// exactly, including resetting the 24h challenge window on every call and reverting if
    /// a reached milestone's window has already elapsed once.
    pub fn post_milestone_root(
        ctx: Context<PostMilestoneRoot>,
        milestone_index: u8,
        merkle_root: [u8; 32],
        snapshot_hash: [u8; 32],
    ) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;
        let idx = milestone_index as usize;
        require!(idx < campaign.milestone_count as usize, ShoError::MilestoneIndexOutOfRange);

        let now = Clock::get()?.unix_timestamp;
        let first_time = !campaign.milestones[idx].reached;
        require!(
            first_time || now < campaign.milestones[idx].challenge_window_ends,
            ShoError::ChallengeWindowElapsed
        );

        campaign.milestones[idx].merkle_root = merkle_root;
        campaign.milestones[idx].snapshot_hash = snapshot_hash;
        let challenge_window_ends = now.checked_add(CHALLENGE_WINDOW_SECS).ok_or(ShoError::Overflow)?;
        campaign.milestones[idx].challenge_window_ends = challenge_window_ends;

        if first_time {
            campaign.milestones[idx].reached = true;
            campaign.milestones[idx].reached_at = now;
            emit!(MilestoneReached { campaign: campaign.key(), milestone_index, reached_at: now });
            emit!(RootPosted { campaign: campaign.key(), milestone_index, merkle_root, snapshot_hash, challenge_window_ends });
        } else {
            emit!(RootCorrected { campaign: campaign.key(), milestone_index, merkle_root, snapshot_hash, challenge_window_ends });
        }
        Ok(())
    }

    /// Claims a native-SOL reward. Mirrors SHOCampaign.sol::claim's `rewardToken ==
    /// address(0)` payout branch.
    pub fn claim_sol(ctx: Context<ClaimSol>, milestone_index: u8, amount: u64, proof: Vec<[u8; 32]>) -> Result<()> {
        let campaign = &mut ctx.accounts.campaign;
        require!(campaign.is_native(), ShoError::NotNativeCampaign);

        let idx = milestone_index as usize;
        require!(idx < campaign.milestone_count as usize, ShoError::MilestoneIndexOutOfRange);
        let m = &campaign.milestones[idx];
        require!(m.reached, ShoError::MilestoneNotReached);

        let now = Clock::get()?.unix_timestamp;
        require!(now >= m.challenge_window_ends, ShoError::ChallengeWindowOpen);
        require!(
            merkle::verify(&proof, m.merkle_root, &ctx.accounts.claimant.key(), amount),
            ShoError::BadProof
        );

        campaign.milestones[idx].total_claimed =
            campaign.milestones[idx].total_claimed.checked_add(amount).ok_or(ShoError::Overflow)?;
        ctx.accounts.claim_receipt.bump = ctx.bumps.claim_receipt;

        **campaign.to_account_info().try_borrow_mut_lamports()? = campaign
            .to_account_info()
            .lamports()
            .checked_sub(amount)
            .ok_or(ShoError::Overflow)?;
        **ctx.accounts.claimant.to_account_info().try_borrow_mut_lamports()? = ctx
            .accounts
            .claimant
            .to_account_info()
            .lamports()
            .checked_add(amount)
            .ok_or(ShoError::Overflow)?;

        emit!(RewardClaimed { campaign: campaign.key(), milestone_index, account: ctx.accounts.claimant.key(), amount });
        Ok(())
    }

    /// Claims an SPL-token reward. Mirrors SHOCampaign.sol::claim's `rewardToken !=
    /// address(0)` payout branch.
    pub fn claim_spl(ctx: Context<ClaimSpl>, milestone_index: u8, amount: u64, proof: Vec<[u8; 32]>) -> Result<()> {
        {
            let campaign = &ctx.accounts.campaign;
            require!(!campaign.is_native(), ShoError::NotSplCampaign);

            let idx = milestone_index as usize;
            require!(idx < campaign.milestone_count as usize, ShoError::MilestoneIndexOutOfRange);
            let m = &campaign.milestones[idx];
            require!(m.reached, ShoError::MilestoneNotReached);

            let now = Clock::get()?.unix_timestamp;
            require!(now >= m.challenge_window_ends, ShoError::ChallengeWindowOpen);
            require!(
                merkle::verify(&proof, m.merkle_root, &ctx.accounts.claimant.key(), amount),
                ShoError::BadProof
            );
        }

        let idx = milestone_index as usize;
        ctx.accounts.campaign.milestones[idx].total_claimed = ctx.accounts.campaign.milestones[idx]
            .total_claimed
            .checked_add(amount)
            .ok_or(ShoError::Overflow)?;
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
            milestone_index,
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
    leaderboard_size: u16,
    duration: i64,
    tiers: &[MilestoneTier],
    reward_bps_list: &[u16],
) -> Result<()> {
    require!(amount > 0, ShoError::ZeroAmount);
    require!(
        leaderboard_size == LEADERBOARD_SIZE_50
            || leaderboard_size == LEADERBOARD_SIZE_100
            || leaderboard_size == LEADERBOARD_SIZE_500,
        ShoError::BadLeaderboardSize
    );
    require!(
        duration == DURATION_7D || duration == DURATION_30D || duration == DURATION_90D,
        ShoError::BadDuration
    );
    require!(!tiers.is_empty() && tiers.len() <= MAX_MILESTONES, ShoError::BadMilestoneCount);
    require_eq!(tiers.len(), reward_bps_list.len(), ShoError::LengthMismatch);

    for i in 1..tiers.len() {
        require!(tiers[i] > tiers[i - 1], ShoError::TiersMustStrictlyIncrease);
    }

    let sum: u32 = reward_bps_list.iter().map(|&b| b as u32).sum();
    require_eq!(sum, BPS_DENOMINATOR as u32, ShoError::BpsMustSumTo10000);

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
    window: LeaderboardWindow,
    leaderboard_size: u16,
    duration: i64,
    tiers: &[MilestoneTier],
    reward_bps_list: &[u16],
) -> Result<()> {
    let mut milestones = [Milestone::EMPTY; MAX_MILESTONES];
    for (i, (&tier, &reward_bps)) in tiers.iter().zip(reward_bps_list.iter()).enumerate() {
        milestones[i] = Milestone { tier, reward_bps, ..Milestone::EMPTY };
    }

    campaign.bump = bump;
    campaign.id = id;
    campaign.token = token;
    campaign.creator = creator;
    campaign.reward_mint = reward_mint;
    campaign.total_locked = total_locked;
    campaign.window = window;
    campaign.leaderboard_size = leaderboard_size;
    campaign.duration = duration;
    campaign.created_at = Clock::get()?.unix_timestamp;
    campaign.milestone_count = tiers.len() as u8;
    campaign.milestones = milestones;
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

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = authority @ ShoError::NotAuthority)]
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
    #[account(constraint = treasury_authority.key() == config.treasury @ ShoError::BadTreasuryAccount)]
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
pub struct PostMilestoneRoot<'info> {
    pub keeper: Signer<'info>,

    #[account(seeds = [CONFIG_SEED], bump = config.bump, constraint = keeper.key() == config.keeper @ ShoError::NotKeeper)]
    pub config: Account<'info, Config>,

    #[account(
        mut,
        seeds = [CAMPAIGN_SEED, config.key().as_ref(), &campaign.id.to_le_bytes()],
        bump = campaign.bump
    )]
    pub campaign: Account<'info, Campaign>,
}

#[derive(Accounts)]
#[instruction(milestone_index: u8)]
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
        seeds = [CLAIM_SEED, campaign.key().as_ref(), &[milestone_index], claimant.key().as_ref()],
        bump
    )]
    pub claim_receipt: Account<'info, ClaimReceipt>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(milestone_index: u8)]
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

    #[account(constraint = reward_mint.key() == campaign.reward_mint @ ShoError::NotSplCampaign)]
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
        seeds = [CLAIM_SEED, campaign.key().as_ref(), &[milestone_index], claimant.key().as_ref()],
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
pub struct MilestoneReached {
    pub campaign: Pubkey,
    pub milestone_index: u8,
    pub reached_at: i64,
}

#[event]
pub struct RootPosted {
    pub campaign: Pubkey,
    pub milestone_index: u8,
    pub merkle_root: [u8; 32],
    pub snapshot_hash: [u8; 32],
    pub challenge_window_ends: i64,
}

#[event]
pub struct RootCorrected {
    pub campaign: Pubkey,
    pub milestone_index: u8,
    pub merkle_root: [u8; 32],
    pub snapshot_hash: [u8; 32],
    pub challenge_window_ends: i64,
}

#[event]
pub struct RewardClaimed {
    pub campaign: Pubkey,
    pub milestone_index: u8,
    pub account: Pubkey,
    pub amount: u64,
}
