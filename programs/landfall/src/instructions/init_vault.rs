use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, TransferChecked};

use crate::constants::*;
use crate::error::LandfallError;
use crate::math;
use crate::state::Vault;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitVaultParams {
    pub curator: Pubkey,
    pub idle_buffer_bps: u16,
    pub sweep_fee: u64,
    pub min_sweep: u64,
    /// USDC moved from the admin into the vault as permanently locked dead shares.
    pub seed_amount: u64,
}

#[derive(Accounts)]
pub struct InitVault<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(
        init,
        payer = admin,
        space = 8 + Vault::INIT_SPACE,
        seeds = [VAULT_SEED, usdc_mint.key().as_ref()],
        bump
    )]
    pub vault: Box<Account<'info, Vault>>,
    #[account(
        init,
        payer = admin,
        seeds = [SHARES_SEED, vault.key().as_ref()],
        bump,
        mint::decimals = SHARE_DECIMALS,
        mint::authority = vault,
    )]
    pub share_mint: Box<Account<'info, Mint>>,
    #[account(
        init,
        payer = admin,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault,
    )]
    pub idle: Box<Account<'info, TokenAccount>>,
    /// Holds the seed shares forever: no instruction lets the vault redeem its own shares.
    #[account(
        init,
        payer = admin,
        associated_token::mint = share_mint,
        associated_token::authority = vault,
    )]
    pub dead_shares: Box<Account<'info, TokenAccount>>,
    #[account(mut, token::mint = usdc_mint, token::authority = admin)]
    pub admin_usdc: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitVault>, params: InitVaultParams) -> Result<()> {
    require!(params.idle_buffer_bps as u128 <= BPS, LandfallError::InvalidParams);
    require!(params.seed_amount > 0, LandfallError::InvalidParams);

    let vault = &mut ctx.accounts.vault;
    vault.admin = ctx.accounts.admin.key();
    vault.curator = params.curator;
    vault.usdc_mint = ctx.accounts.usdc_mint.key();
    vault.share_mint = ctx.accounts.share_mint.key();
    vault.idle = ctx.accounts.idle.key();
    vault.idle_buffer_bps = params.idle_buffer_bps;
    vault.sweep_fee = params.sweep_fee;
    vault.min_sweep = params.min_sweep;
    vault.paused = false;
    vault.bump = ctx.bumps.vault;
    vault.share_mint_bump = ctx.bumps.share_mint;

    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.admin_usdc.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.idle.to_account_info(),
                authority: ctx.accounts.admin.to_account_info(),
            },
        ),
        params.seed_amount,
        ctx.accounts.usdc_mint.decimals,
    )?;

    let shares = math::shares_for_assets(params.seed_amount, 0, 0).ok_or(LandfallError::MathOverflow)?;
    let usdc_key = ctx.accounts.usdc_mint.key();
    let seeds: &[&[u8]] = &[VAULT_SEED, usdc_key.as_ref(), &[ctx.bumps.vault]];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.share_mint.to_account_info(),
                to: ctx.accounts.dead_shares.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            &[seeds],
        ),
        shares,
    )?;
    Ok(())
}
