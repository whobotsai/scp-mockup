//! Wallet <-> X-handle Registry, ported to Solana.
//!
//! Solana/Anchor counterpart of contracts/src/registry/Registry.sol: links an X account to
//! a wallet once, reusable across every SSO campaign (PRD §12.3-12.4), independent of
//! SHO/SSO's own programs the same way Registry.sol is independent of FactoryBase.sol on EVM
//! (no shared `sho_sso_common` dependency here -- this program doesn't need campaign/
//! milestone/epoch types at all).
//!
//! Biggest design difference from the EVM version: Registry.sol verifies an off-chain ECDSA
//! attestation (`ECDSA.recover` against a signature the Registration Service produces) inside
//! the instruction itself. Solana's native signature scheme is Ed25519, not secp256k1/ECDSA,
//! and verifying an *arbitrary* detached signature on-chain (not the transaction's own)
//! requires the Ed25519 native program + instruction-sysvar introspection -- real, but fiddly,
//! low-level byte-offset parsing that's easy to get subtly wrong in a way `cargo check` can't
//! catch and this sandbox has no way to test against a live validator (see the SECURITY NOTE
//! below). Instead, this program requires the attestor to co-sign the same transaction as a
//! second `Signer` account (see `RegisterHandle`): the Solana runtime itself verifies that
//! signature natively before the instruction ever runs, which is simpler, equally secure (the
//! attestor's private key -- held only by the Registration Service -- still gates every
//! registration), and avoids hand-rolling Ed25519-sysvar parsing entirely. In practice this
//! means the Registration Service partially signs the registration transaction (as attestor)
//! and hands it to the connecting wallet to add its own signature and submit, a standard
//! Solana "multi-signer transaction" pattern.
//!
//! DELIBERATE V1 SIMPLIFICATION: a wallet can link an X handle exactly once; there is no
//! `register_handle` equivalent of Registry.sol's "switch to a different handle" path (which
//! releases the wallet's previous handle first). See `HandleLink`'s own doc comment in
//! state.rs for why, and when to revisit it.
//!
//! SECURITY / COMPLETENESS NOTE: same standing caveat as sho_solana/sso_solana -- this
//! program has not been built against the real Solana BPF/SBF toolchain or exercised with
//! `anchor test` + a local validator (no `solana`/`anchor` CLI in this sandbox) -- only
//! `cargo check` against a native target.

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod state;

use constants::*;
use errors::RegistryError;
use state::*;

declare_id!("E6pYGM6cDh1WqLjkDRMfvwMMGBD6CWQSfA3msuNYMy3Y");

#[program]
pub mod registry_solana {
    use super::*;

    pub fn initialize_config(ctx: Context<InitializeConfig>, attestor: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        config.bump = ctx.bumps.config;
        config.authority = ctx.accounts.authority.key();
        config.attestor = attestor;
        config.next_registration_id = 0;
        emit!(AttestorUpdated { attestor });
        Ok(())
    }

    pub fn set_attestor(ctx: Context<AdminOnly>, new_attestor: Pubkey) -> Result<()> {
        ctx.accounts.config.attestor = new_attestor;
        emit!(AttestorUpdated { attestor: new_attestor });
        Ok(())
    }

    /// Links `x_handle` to `wallet`. Requires both `wallet` and `attestor` to sign the same
    /// transaction (see this module's own header for why, instead of an on-chain Ed25519
    /// signature check) -- `attestor` must match `config.attestor`, checked below.
    pub fn register_handle(ctx: Context<RegisterHandle>, x_handle: String) -> Result<()> {
        require!(x_handle.len() <= MAX_X_HANDLE_LEN, RegistryError::HandleTooLong);
        require!(
            ctx.accounts.attestor.key() == ctx.accounts.config.attestor,
            RegistryError::NotAttestor
        );

        let wallet = ctx.accounts.wallet.key();
        let now = Clock::get()?.unix_timestamp;

        let handle_link = &mut ctx.accounts.handle_link;
        handle_link.bump = ctx.bumps.handle_link;
        handle_link.wallet = wallet;
        handle_link.x_handle = x_handle.clone();
        handle_link.linked_at = now;

        let wallet_of_handle = &mut ctx.accounts.wallet_of_handle;
        wallet_of_handle.bump = ctx.bumps.wallet_of_handle;
        wallet_of_handle.wallet = wallet;

        let id = ctx.accounts.config.next_registration_id;
        ctx.accounts.config.next_registration_id =
            id.checked_add(1).ok_or(RegistryError::Overflow)?;

        let registration = &mut ctx.accounts.registration;
        registration.bump = ctx.bumps.registration;
        registration.id = id;
        registration.wallet = wallet;
        registration.x_handle = x_handle.clone();

        emit!(HandleRegistered { wallet, x_handle });
        Ok(())
    }
}

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

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = authority @ RegistryError::NotAuthority)]
    pub config: Account<'info, Config>,
}

#[derive(Accounts)]
#[instruction(x_handle: String)]
pub struct RegisterHandle<'info> {
    #[account(mut)]
    pub wallet: Signer<'info>,

    /// Must match `config.attestor`, checked in the handler (not a `constraint` here, since
    /// seeds/space for `wallet_of_handle` below are computed from `x_handle` before the
    /// handler body runs regardless of whether this check would already reject -- the
    /// handler's own `require!` is what actually enforces it).
    pub attestor: Signer<'info>,

    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(
        init,
        payer = wallet,
        space = 8 + HandleLink::INIT_SPACE,
        seeds = [HANDLE_SEED, wallet.key().as_ref()],
        bump
    )]
    pub handle_link: Account<'info, HandleLink>,

    #[account(
        init,
        payer = wallet,
        space = 8 + WalletOfHandle::INIT_SPACE,
        seeds = [WALLET_OF_HANDLE_SEED, &normalized_handle_key(&x_handle)],
        bump
    )]
    pub wallet_of_handle: Account<'info, WalletOfHandle>,

    #[account(
        init,
        payer = wallet,
        space = 8 + Registration::INIT_SPACE,
        seeds = [REGISTRATION_SEED, config.key().as_ref(), &config.next_registration_id.to_le_bytes()],
        bump
    )]
    pub registration: Account<'info, Registration>,

    pub system_program: Program<'info, System>,
}

#[event]
pub struct AttestorUpdated {
    pub attestor: Pubkey,
}

#[event]
pub struct HandleRegistered {
    pub wallet: Pubkey,
    pub x_handle: String,
}
