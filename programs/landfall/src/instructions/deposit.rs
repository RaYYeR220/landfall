use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::events::{Landed, LandingSource};
use crate::instructions::landing::mint_landing_shares;
use crate::nav;
use crate::state::Vault;

/// The landing instruction. Called by a wallet, or by an Intents Connect
/// intermediary as the bridge-in step with `amount = {MIN_AMOUNT_OUT}`.
///
/// It never calls into a lending protocol and never fails on protocol state:
/// a zero amount is a no-op, a paused vault still accepts the landing, and an
/// unreadable strategy account falls back to its cached value. Allocation to
/// Kamino / Jupiter Lend is a separate, retryable `allocate_*` transaction.
///
/// Remaining accounts: `[kamino_reserve, kamino_collateral, jlend_lending, jlend_ftoken]`.
#[derive(Accounts)]
pub struct Deposit<'info> {
    pub depositor: Signer<'info>,
    #[account(mut, token::mint = usdc_mint, token::authority = depositor)]
    pub depositor_usdc: Box<Account<'info, TokenAccount>>,
    /// CHECK: receives the shares; any pubkey (wallet or intermediary).
    pub owner: UncheckedAccount<'info>,
    #[account(mut, token::mint = share_mint, token::authority = owner)]
    pub owner_shares: Box<Account<'info, TokenAccount>>,
    #[account(mut, has_one = share_mint, has_one = idle, has_one = usdc_mint)]
    pub vault: Box<Account<'info, Vault>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub idle: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub share_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
}

pub fn handler<'info>(ctx: Context<'info, Deposit<'info>>, amount: u64) -> Result<()> {
    // `u64::MAX` (or anything above the balance) deposits the whole balance.
    let amount = amount.min(ctx.accounts.depositor_usdc.amount);
    if amount == 0 {
        return Ok(());
    }

    let nav_before = nav::compute(&ctx.accounts.vault, ctx.accounts.idle.amount, ctx.remaining_accounts, false)?;

    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.depositor_usdc.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.idle.to_account_info(),
                authority: ctx.accounts.depositor.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.usdc_mint.decimals,
    )?;

    let shares = mint_landing_shares(
        &ctx.accounts.vault,
        &ctx.accounts.share_mint,
        &ctx.accounts.owner_shares,
        &ctx.accounts.token_program,
        amount,
        &nav_before,
    )?;

    let vault = &mut ctx.accounts.vault;
    vault.landed_total = vault.landed_total.saturating_add(amount);
    vault.landed_count = vault.landed_count.saturating_add(1);

    emit!(Landed {
        vault: vault.key(),
        owner: ctx.accounts.owner.key(),
        depositor: ctx.accounts.depositor.key(),
        source: LandingSource::Direct,
        amount,
        shares,
        nav_before: nav_before.total(),
        nav_live: nav_before.live,
    });
    Ok(())
}
