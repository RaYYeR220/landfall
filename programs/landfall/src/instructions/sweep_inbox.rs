use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, Token, TokenAccount, TransferChecked};

use crate::constants::INBOX_SEED;
use crate::error::LandfallError;
use crate::events::{Landed, LandingSource};
use crate::instructions::landing::mint_landing_shares;
use crate::nav;
use crate::state::{Inbox, Vault};

/// Permissionless: moves everything a persistent deposit address delivered to
/// the owner's inbox into the vault and mints the owner's shares. The keeper
/// gets `min(sweep_fee, 1%)` of the sweep for the transaction it pays for.
///
/// Remaining accounts: `[kamino_reserve, kamino_collateral, jlend_lending, jlend_ftoken]`.
#[derive(Accounts)]
pub struct SweepInbox<'info> {
    #[account(mut)]
    pub keeper: Signer<'info>,
    #[account(mut, token::mint = usdc_mint)]
    pub keeper_usdc: Box<Account<'info, TokenAccount>>,
    #[account(mut, has_one = share_mint, has_one = idle, has_one = usdc_mint)]
    pub vault: Box<Account<'info, Vault>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(
        mut,
        seeds = [INBOX_SEED, vault.key().as_ref(), inbox.owner.as_ref()],
        bump = inbox.bump,
        has_one = vault,
        has_one = owner,
    )]
    pub inbox: Box<Account<'info, Inbox>>,
    #[account(mut, associated_token::mint = usdc_mint, associated_token::authority = inbox)]
    pub inbox_usdc: Box<Account<'info, TokenAccount>>,
    /// CHECK: checked against `inbox.owner`.
    pub owner: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = keeper,
        associated_token::mint = share_mint,
        associated_token::authority = owner,
    )]
    pub owner_shares: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub idle: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub share_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler<'info>(ctx: Context<'info, SweepInbox<'info>>) -> Result<()> {
    let balance = ctx.accounts.inbox_usdc.amount;
    require!(balance > 0 && balance >= ctx.accounts.vault.min_sweep, LandfallError::BelowMinSweep);

    let fee = ctx.accounts.vault.sweep_fee.min(balance / 100);
    let net = balance - fee;
    let nav_before = nav::compute(&ctx.accounts.vault, ctx.accounts.idle.amount, ctx.remaining_accounts, false)?;

    let vault_key = ctx.accounts.vault.key();
    let owner_key = ctx.accounts.owner.key();
    let bump = [ctx.accounts.inbox.bump];
    let seeds: &[&[u8]] = &[INBOX_SEED, vault_key.as_ref(), owner_key.as_ref(), &bump];
    let decimals = ctx.accounts.usdc_mint.decimals;

    let pay = |to: AccountInfo<'info>, amount: u64| -> Result<()> {
        if amount == 0 {
            return Ok(());
        }
        token::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.key(),
                TransferChecked {
                    from: ctx.accounts.inbox_usdc.to_account_info(),
                    mint: ctx.accounts.usdc_mint.to_account_info(),
                    to,
                    authority: ctx.accounts.inbox.to_account_info(),
                },
                &[seeds],
            ),
            amount,
            decimals,
        )
    };
    pay(ctx.accounts.keeper_usdc.to_account_info(), fee)?;
    pay(ctx.accounts.idle.to_account_info(), net)?;

    let shares = mint_landing_shares(
        &ctx.accounts.vault,
        &ctx.accounts.share_mint,
        &ctx.accounts.owner_shares,
        &ctx.accounts.token_program,
        net,
        &nav_before,
    )?;

    let inbox = &mut ctx.accounts.inbox;
    inbox.swept_total = inbox.swept_total.saturating_add(net);
    inbox.sweep_count = inbox.sweep_count.saturating_add(1);
    let vault = &mut ctx.accounts.vault;
    vault.landed_total = vault.landed_total.saturating_add(net);
    vault.landed_count = vault.landed_count.saturating_add(1);

    emit!(Landed {
        vault: vault_key,
        owner: owner_key,
        depositor: inbox.key(),
        source: LandingSource::Inbox,
        amount: net,
        shares,
        nav_before: nav_before.total(),
        nav_live: nav_before.live,
    });
    Ok(())
}
