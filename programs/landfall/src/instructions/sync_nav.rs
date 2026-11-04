use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

use crate::nav;
use crate::state::Vault;

/// Anyone: refresh the cached strategy values used as the landing fallback.
#[derive(Accounts)]
pub struct SyncNav<'info> {
    #[account(mut, has_one = idle)]
    pub vault: Box<Account<'info, Vault>>,
    pub idle: Box<Account<'info, TokenAccount>>,
    /// CHECK: valuation only.
    pub kamino_reserve: UncheckedAccount<'info>,
    /// CHECK: valuation only.
    pub kamino_collateral: UncheckedAccount<'info>,
    /// CHECK: valuation only.
    pub jlend_lending: UncheckedAccount<'info>,
    /// CHECK: valuation only.
    pub jlend_ftoken: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<SyncNav>) -> Result<()> {
    let a = &ctx.accounts;
    let navs = [
        a.kamino_reserve.to_account_info(),
        a.kamino_collateral.to_account_info(),
        a.jlend_lending.to_account_info(),
        a.jlend_ftoken.to_account_info(),
    ];
    let nav = nav::compute(&a.vault, a.idle.amount, &navs, true)?;
    let slot = Clock::get()?.slot;
    let vault = &mut ctx.accounts.vault;
    vault.kamino.cached_value = nav.kamino;
    vault.kamino.cached_slot = slot;
    vault.jlend.cached_value = nav.jlend;
    vault.jlend.cached_slot = slot;
    Ok(())
}
