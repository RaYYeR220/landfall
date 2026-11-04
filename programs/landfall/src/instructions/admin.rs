use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::error::LandfallError;
use crate::state::Vault;
use crate::strategies::{jlend::LendingView, kamino::ReserveView};

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    pub admin: Signer<'info>,
    #[account(mut, has_one = admin @ LandfallError::Unauthorized)]
    pub vault: Box<Account<'info, Vault>>,
}

#[derive(Accounts)]
pub struct CuratorOnly<'info> {
    pub curator: Signer<'info>,
    #[account(mut, has_one = curator @ LandfallError::Unauthorized)]
    pub vault: Box<Account<'info, Vault>>,
}

pub fn set_curator(ctx: Context<AdminOnly>, curator: Pubkey) -> Result<()> {
    ctx.accounts.vault.curator = curator;
    Ok(())
}

/// Admin: switch a strategy on or off without touching its accounts. A
/// disabled strategy takes no new allocations, and if its accounts stop
/// parsing it is valued at zero for redemptions (idle stays withdrawable).
pub fn set_strategy_enabled(ctx: Context<AdminOnly>, strategy: u8, enabled: bool) -> Result<()> {
    let v = &mut ctx.accounts.vault;
    match strategy {
        SOURCE_KAMINO => v.kamino.enabled = enabled,
        SOURCE_JLEND => v.jlend.enabled = enabled,
        _ => return err!(LandfallError::InvalidSource),
    }
    Ok(())
}

pub fn set_params(ctx: Context<CuratorOnly>, idle_buffer_bps: u16, sweep_fee: u64, min_sweep: u64) -> Result<()> {
    require!(idle_buffer_bps as u128 <= BPS, LandfallError::InvalidParams);
    let v = &mut ctx.accounts.vault;
    v.idle_buffer_bps = idle_buffer_bps;
    v.sweep_fee = sweep_fee;
    v.min_sweep = min_sweep;
    Ok(())
}

pub fn set_paused(ctx: Context<CuratorOnly>, paused: bool) -> Result<()> {
    ctx.accounts.vault.paused = paused;
    Ok(())
}

pub fn set_weights(ctx: Context<CuratorOnly>, kamino_bps: u16, jlend_bps: u16, kamino_cap: u64, jlend_cap: u64) -> Result<()> {
    require!(kamino_bps as u128 + jlend_bps as u128 <= BPS, LandfallError::InvalidParams);
    let v = &mut ctx.accounts.vault;
    v.kamino.weight_bps = kamino_bps;
    v.kamino.cap = kamino_cap;
    v.jlend.weight_bps = jlend_bps;
    v.jlend.cap = jlend_cap;
    Ok(())
}

#[derive(Accounts)]
pub struct ConfigureKamino<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, has_one = admin @ LandfallError::Unauthorized, has_one = usdc_mint)]
    pub vault: Box<Account<'info, Vault>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    /// CHECK: parsed and validated as a Kamino reserve.
    pub reserve: UncheckedAccount<'info>,
    pub collateral_mint: Box<Account<'info, Mint>>,
    #[account(
        init_if_needed,
        payer = admin,
        associated_token::mint = collateral_mint,
        associated_token::authority = vault,
    )]
    pub collateral_account: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn configure_kamino(ctx: Context<ConfigureKamino>, enabled: bool) -> Result<()> {
    let view = ReserveView::parse(&ctx.accounts.reserve.to_account_info()).ok_or(LandfallError::InvalidStrategyAccount)?;
    require_keys_eq!(view.liquidity_mint, ctx.accounts.usdc_mint.key(), LandfallError::InvalidStrategyAccount);
    require_keys_eq!(view.collateral_mint, ctx.accounts.collateral_mint.key(), LandfallError::InvalidStrategyAccount);
    let k = &mut ctx.accounts.vault.kamino;
    k.enabled = enabled;
    k.reserve = ctx.accounts.reserve.key();
    k.market = view.lending_market;
    k.collateral_mint = view.collateral_mint;
    k.collateral_account = ctx.accounts.collateral_account.key();
    Ok(())
}

#[derive(Accounts)]
pub struct ConfigureJlend<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, has_one = admin @ LandfallError::Unauthorized, has_one = usdc_mint)]
    pub vault: Box<Account<'info, Vault>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    /// CHECK: parsed and validated as a Jupiter Lend `Lending` account.
    pub lending: UncheckedAccount<'info>,
    pub ftoken_mint: Box<Account<'info, Mint>>,
    #[account(
        init_if_needed,
        payer = admin,
        associated_token::mint = ftoken_mint,
        associated_token::authority = vault,
    )]
    pub ftoken_account: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn configure_jlend(ctx: Context<ConfigureJlend>, enabled: bool) -> Result<()> {
    let view = LendingView::parse(&ctx.accounts.lending.to_account_info()).ok_or(LandfallError::InvalidStrategyAccount)?;
    require_keys_eq!(view.mint, ctx.accounts.usdc_mint.key(), LandfallError::InvalidStrategyAccount);
    require_keys_eq!(view.ftoken_mint, ctx.accounts.ftoken_mint.key(), LandfallError::InvalidStrategyAccount);
    let j = &mut ctx.accounts.vault.jlend;
    j.enabled = enabled;
    j.lending = ctx.accounts.lending.key();
    j.ftoken_mint = view.ftoken_mint;
    j.ftoken_account = ctx.accounts.ftoken_account.key();
    Ok(())
}
