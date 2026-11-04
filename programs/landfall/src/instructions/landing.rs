//! Shared landing core: value the vault, then mint shares for an amount that
//! has just arrived in (or is about to arrive in) `idle`.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};

use crate::constants::VAULT_SEED;
use crate::error::LandfallError;
use crate::math;
use crate::nav::Nav;
use crate::state::Vault;

pub fn vault_signer_seeds<'a>(usdc_mint: &'a Pubkey, bump: &'a [u8; 1]) -> [&'a [u8]; 3] {
    [VAULT_SEED, usdc_mint.as_ref(), bump]
}

/// Mints shares for `amount` at `nav` (valued before the amount arrived).
pub fn mint_landing_shares<'info>(
    vault: &Account<'info, Vault>,
    share_mint: &Account<'info, Mint>,
    owner_shares: &Account<'info, TokenAccount>,
    token_program: &Program<'info, Token>,
    amount: u64,
    nav: &Nav,
) -> Result<u64> {
    let shares = math::shares_for_assets(amount, share_mint.supply, nav.total()).ok_or(LandfallError::MathOverflow)?;
    if shares == 0 {
        return Ok(0);
    }
    let bump = [vault.bump];
    let seeds = vault_signer_seeds(&vault.usdc_mint, &bump);
    token::mint_to(
        CpiContext::new_with_signer(
            token_program.key(),
            MintTo {
                mint: share_mint.to_account_info(),
                to: owner_shares.to_account_info(),
                authority: vault.to_account_info(),
            },
            &[&seeds],
        ),
        shares,
    )?;
    Ok(shares)
}
