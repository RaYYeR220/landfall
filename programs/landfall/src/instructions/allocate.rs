use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::error::LandfallError;
use crate::events::{Allocated, Deallocated};
use crate::instructions::landing::vault_signer_seeds;
use crate::math::bps_of;
use crate::nav::{self, Nav};
use crate::state::Vault;
use crate::strategies::jlend::{JlendAccounts, LendingView};
use crate::strategies::kamino::{KaminoAccounts, ReserveView};

/// Kamino reserve accounts used by allocate / deallocate / redeem_via_kamino.
/// Addresses are checked against the vault with [`KaminoCpi::check`].
#[derive(Accounts)]
pub struct KaminoCpi<'info> {
    /// CHECK: must be the configured reserve; parsed.
    #[account(mut)]
    pub reserve: UncheckedAccount<'info>,
    #[account(mut)]
    pub collateral_account: Box<Account<'info, TokenAccount>>,
    /// CHECK: must be the configured lending market.
    pub lending_market: UncheckedAccount<'info>,
    /// CHECK: validated by the Kamino program (PDA of the market).
    pub lending_market_authority: UncheckedAccount<'info>,
    /// CHECK: validated by the Kamino program against the reserve.
    #[account(mut)]
    pub reserve_liquidity_supply: UncheckedAccount<'info>,
    /// CHECK: must be the configured collateral mint.
    #[account(mut)]
    pub collateral_mint: UncheckedAccount<'info>,
    /// CHECK: instructions sysvar (Kamino checks for a preceding refresh_reserve).
    #[account(address = INSTRUCTIONS_SYSVAR)]
    pub instructions_sysvar: UncheckedAccount<'info>,
    /// CHECK: Kamino lending program.
    #[account(address = KAMINO_LENDING_PROGRAM)]
    pub kamino_program: UncheckedAccount<'info>,
}

/// Jupiter Lend Earn accounts used by allocate / deallocate / redeem_via_jlend.
/// Addresses are checked against the vault with [`JlendCpi::check`].
#[derive(Accounts)]
pub struct JlendCpi<'info> {
    /// CHECK: must be the configured lending account; parsed.
    #[account(mut)]
    pub lending: UncheckedAccount<'info>,
    #[account(mut)]
    pub ftoken_account: Box<Account<'info, TokenAccount>>,
    /// CHECK: must be the configured fToken mint.
    #[account(mut)]
    pub ftoken_mint: UncheckedAccount<'info>,
    /// CHECK: validated by Jupiter Lend.
    pub lending_admin: UncheckedAccount<'info>,
    /// CHECK: validated by Jupiter Lend.
    #[account(mut)]
    pub supply_token_reserves_liquidity: UncheckedAccount<'info>,
    /// CHECK: validated by Jupiter Lend.
    #[account(mut)]
    pub lending_supply_position_on_liquidity: UncheckedAccount<'info>,
    /// CHECK: validated by Jupiter Lend.
    pub rate_model: UncheckedAccount<'info>,
    /// CHECK: validated by Jupiter Lend (liquidity vault).
    #[account(mut)]
    pub liquidity_vault: UncheckedAccount<'info>,
    /// CHECK: validated by Jupiter Lend (withdraw claim account).
    #[account(mut)]
    pub claim_account: UncheckedAccount<'info>,
    /// CHECK: validated by Jupiter Lend.
    #[account(mut)]
    pub liquidity: UncheckedAccount<'info>,
    /// CHECK: Jupiter Lend liquidity program, validated by the lending program.
    pub liquidity_program: UncheckedAccount<'info>,
    /// CHECK: validated by Jupiter Lend.
    pub rewards_rate_model: UncheckedAccount<'info>,
    /// CHECK: Jupiter Lend lending program.
    #[account(address = JUPITER_LEND_PROGRAM)]
    pub jlend_program: UncheckedAccount<'info>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl<'info> KaminoCpi<'info> {
    pub fn check(&self, vault: &Vault) -> Result<()> {
        let k = &vault.kamino;
        require!(
            self.reserve.key() == k.reserve
                && self.collateral_account.key() == k.collateral_account
                && self.lending_market.key() == k.market
                && self.collateral_mint.key() == k.collateral_mint
                && k.reserve != Pubkey::default(),
            LandfallError::InvalidStrategyAccount
        );
        Ok(())
    }

    pub fn accounts<'a>(
        &'a self,
        vault: &'a AccountInfo<'info>,
        idle: &'a AccountInfo<'info>,
        usdc_mint: &'a AccountInfo<'info>,
        token_program: &'a AccountInfo<'info>,
    ) -> KaminoAccounts<'a, 'info> {
        KaminoAccounts {
            owner: vault,
            reserve: self.reserve.as_ref(),
            lending_market: self.lending_market.as_ref(),
            lending_market_authority: self.lending_market_authority.as_ref(),
            liquidity_mint: usdc_mint,
            liquidity_supply: self.reserve_liquidity_supply.as_ref(),
            collateral_mint: self.collateral_mint.as_ref(),
            liquidity_account: idle,
            collateral_account: self.collateral_account.as_ref().as_ref(),
            token_program,
            instructions_sysvar: self.instructions_sysvar.as_ref(),
        }
    }

    pub fn value(&self) -> Result<u64> {
        let view = ReserveView::parse(&self.reserve.to_account_info()).ok_or(LandfallError::InvalidStrategyAccount)?;
        let coll = self.collateral_account.to_account_info();
        let amount = nav::token_amount(&coll, coll.key).ok_or(LandfallError::InvalidStrategyAccount)?;
        view.liquidity_for_collateral(amount).ok_or(error!(LandfallError::MathOverflow))
    }
}

impl<'info> JlendCpi<'info> {
    pub fn check(&self, vault: &Vault) -> Result<()> {
        let j = &vault.jlend;
        require!(
            self.lending.key() == j.lending
                && self.ftoken_account.key() == j.ftoken_account
                && self.ftoken_mint.key() == j.ftoken_mint
                && j.lending != Pubkey::default(),
            LandfallError::InvalidStrategyAccount
        );
        Ok(())
    }

    pub fn accounts<'a>(
        &'a self,
        vault: &'a AccountInfo<'info>,
        idle: &'a AccountInfo<'info>,
        usdc_mint: &'a AccountInfo<'info>,
        token_program: &'a AccountInfo<'info>,
    ) -> JlendAccounts<'a, 'info> {
        JlendAccounts {
            signer: vault,
            asset_account: idle,
            ftoken_account: self.ftoken_account.as_ref().as_ref(),
            mint: usdc_mint,
            lending_admin: self.lending_admin.as_ref(),
            lending: self.lending.as_ref(),
            ftoken_mint: self.ftoken_mint.as_ref(),
            supply_token_reserves_liquidity: self.supply_token_reserves_liquidity.as_ref(),
            lending_supply_position_on_liquidity: self.lending_supply_position_on_liquidity.as_ref(),
            rate_model: self.rate_model.as_ref(),
            liquidity_vault: self.liquidity_vault.as_ref(),
            claim_account: self.claim_account.as_ref(),
            liquidity: self.liquidity.as_ref(),
            liquidity_program: self.liquidity_program.as_ref(),
            rewards_rate_model: self.rewards_rate_model.as_ref(),
            token_program,
            associated_token_program: self.associated_token_program.as_ref(),
            system_program: self.system_program.as_ref(),
        }
    }

    pub fn value(&self) -> Result<u64> {
        let view = LendingView::parse(&self.lending.to_account_info()).ok_or(LandfallError::InvalidStrategyAccount)?;
        let ft = self.ftoken_account.to_account_info();
        let shares = nav::token_amount(&ft, ft.key).ok_or(LandfallError::InvalidStrategyAccount)?;
        view.assets_for_shares(shares).ok_or(error!(LandfallError::MathOverflow))
    }
}

/// `(spare idle above the buffer, room left under the target weight and cap)`.
pub fn allocation_room(vault: &Vault, nav: &Nav, current: u64, weight_bps: u16, cap: u64) -> (u64, u64) {
    let total = nav.total();
    let spare_idle = nav.idle.saturating_sub(bps_of(total, vault.idle_buffer_bps));
    let target_room = bps_of(total, weight_bps).saturating_sub(current).min(cap.saturating_sub(current));
    (spare_idle, target_room)
}

#[derive(Accounts)]
pub struct AllocateKamino<'info> {
    pub keeper: Signer<'info>,
    #[account(mut, has_one = usdc_mint, has_one = idle)]
    pub vault: Box<Account<'info, Vault>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub idle: Box<Account<'info, TokenAccount>>,
    pub kamino: KaminoCpi<'info>,
    /// CHECK: valuation only (Jupiter Lend lending account, or any account if unconfigured).
    pub jlend_lending: UncheckedAccount<'info>,
    /// CHECK: valuation only.
    pub jlend_ftoken: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

/// Permissionless. Tx must be `[kamino refresh_reserve, allocate_kamino]`.
pub fn allocate_kamino(ctx: Context<AllocateKamino>, amount: u64) -> Result<()> {
    let a = &ctx.accounts;
    require!(!a.vault.paused, LandfallError::Paused);
    require!(a.vault.kamino.enabled, LandfallError::StrategyDisabled);
    a.kamino.check(&a.vault)?;

    let navs = [
        a.kamino.reserve.to_account_info(),
        a.kamino.collateral_account.to_account_info(),
        a.jlend_lending.to_account_info(),
        a.jlend_ftoken.to_account_info(),
    ];
    let nav = nav::compute(&a.vault, a.idle.amount, &navs, true)?;
    let view = ReserveView::parse(&a.kamino.reserve.to_account_info()).ok_or(LandfallError::InvalidStrategyAccount)?;
    require!(view.is_active(), LandfallError::StrategyDisabled);

    let (spare_idle, target_room) = allocation_room(&a.vault, &nav, nav.kamino, a.vault.kamino.weight_bps, a.vault.kamino.cap);
    require!(amount > 0 && amount <= spare_idle, LandfallError::InsufficientIdle);
    require!(amount <= target_room && amount <= view.deposit_room(), LandfallError::AllocationExceedsTarget);

    let bump = [a.vault.bump];
    let seeds = vault_signer_seeds(&a.vault.usdc_mint, &bump);
    let (v, i, m, t) = (a.vault.to_account_info(), a.idle.to_account_info(), a.usdc_mint.to_account_info(), a.token_program.to_account_info());
    a.kamino.accounts(&v, &i, &m, &t).deposit(amount, &[&seeds])?;

    let value_after = ctx.accounts.kamino.value()?;
    let vault = &mut ctx.accounts.vault;
    vault.kamino.cached_value = value_after;
    vault.kamino.cached_slot = Clock::get()?.slot;
    emit!(Allocated { vault: vault.key(), strategy: SOURCE_KAMINO, amount, strategy_value_after: value_after });
    Ok(())
}

#[derive(Accounts)]
pub struct AllocateJlend<'info> {
    pub keeper: Signer<'info>,
    #[account(mut, has_one = usdc_mint, has_one = idle)]
    pub vault: Box<Account<'info, Vault>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub idle: Box<Account<'info, TokenAccount>>,
    pub jlend: JlendCpi<'info>,
    /// CHECK: valuation only (Kamino reserve, or any account if unconfigured).
    pub kamino_reserve: UncheckedAccount<'info>,
    /// CHECK: valuation only.
    pub kamino_collateral: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

/// Permissionless.
pub fn allocate_jlend(ctx: Context<AllocateJlend>, amount: u64) -> Result<()> {
    let a = &ctx.accounts;
    require!(!a.vault.paused, LandfallError::Paused);
    require!(a.vault.jlend.enabled, LandfallError::StrategyDisabled);
    a.jlend.check(&a.vault)?;

    let navs = [
        a.kamino_reserve.to_account_info(),
        a.kamino_collateral.to_account_info(),
        a.jlend.lending.to_account_info(),
        a.jlend.ftoken_account.to_account_info(),
    ];
    let nav = nav::compute(&a.vault, a.idle.amount, &navs, true)?;
    let (spare_idle, target_room) = allocation_room(&a.vault, &nav, nav.jlend, a.vault.jlend.weight_bps, a.vault.jlend.cap);
    require!(amount > 0 && amount <= spare_idle, LandfallError::InsufficientIdle);
    require!(amount <= target_room, LandfallError::AllocationExceedsTarget);

    let bump = [a.vault.bump];
    let seeds = vault_signer_seeds(&a.vault.usdc_mint, &bump);
    let (v, i, m, t) = (a.vault.to_account_info(), a.idle.to_account_info(), a.usdc_mint.to_account_info(), a.token_program.to_account_info());
    a.jlend.accounts(&v, &i, &m, &t).deposit(amount, &[&seeds])?;

    let value_after = ctx.accounts.jlend.value()?;
    let vault = &mut ctx.accounts.vault;
    vault.jlend.cached_value = value_after;
    vault.jlend.cached_slot = Clock::get()?.slot;
    emit!(Allocated { vault: vault.key(), strategy: SOURCE_JLEND, amount, strategy_value_after: value_after });
    Ok(())
}

#[derive(Accounts)]
pub struct DeallocateKamino<'info> {
    pub curator: Signer<'info>,
    #[account(mut, has_one = curator @ LandfallError::Unauthorized, has_one = usdc_mint, has_one = idle)]
    pub vault: Box<Account<'info, Vault>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub idle: Box<Account<'info, TokenAccount>>,
    pub kamino: KaminoCpi<'info>,
    pub token_program: Program<'info, Token>,
}

/// Curator rebalance: burn `collateral` cTokens back into idle. Tx must be `[refresh_reserve, deallocate_kamino]`.
pub fn deallocate_kamino(ctx: Context<DeallocateKamino>, collateral: u64) -> Result<()> {
    let a = &ctx.accounts;
    a.kamino.check(&a.vault)?;
    let before = a.idle.amount;
    let bump = [a.vault.bump];
    let seeds = vault_signer_seeds(&a.vault.usdc_mint, &bump);
    let (v, i, m, t) = (a.vault.to_account_info(), a.idle.to_account_info(), a.usdc_mint.to_account_info(), a.token_program.to_account_info());
    a.kamino.accounts(&v, &i, &m, &t).redeem(collateral, &[&seeds])?;

    ctx.accounts.idle.reload()?;
    let received = ctx.accounts.idle.amount.saturating_sub(before);
    let value_after = ctx.accounts.kamino.value()?;
    let vault = &mut ctx.accounts.vault;
    vault.kamino.cached_value = value_after;
    vault.kamino.cached_slot = Clock::get()?.slot;
    emit!(Deallocated { vault: vault.key(), strategy: SOURCE_KAMINO, amount: received });
    Ok(())
}

#[derive(Accounts)]
pub struct DeallocateJlend<'info> {
    pub curator: Signer<'info>,
    #[account(mut, has_one = curator @ LandfallError::Unauthorized, has_one = usdc_mint, has_one = idle)]
    pub vault: Box<Account<'info, Vault>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub idle: Box<Account<'info, TokenAccount>>,
    pub jlend: JlendCpi<'info>,
    pub token_program: Program<'info, Token>,
}

/// Curator rebalance: withdraw `assets` USDC from Jupiter Lend into idle.
pub fn deallocate_jlend(ctx: Context<DeallocateJlend>, assets: u64) -> Result<()> {
    let a = &ctx.accounts;
    a.jlend.check(&a.vault)?;
    let bump = [a.vault.bump];
    let seeds = vault_signer_seeds(&a.vault.usdc_mint, &bump);
    let (v, i, m, t) = (a.vault.to_account_info(), a.idle.to_account_info(), a.usdc_mint.to_account_info(), a.token_program.to_account_info());
    a.jlend.accounts(&v, &i, &m, &t).withdraw(assets, &[&seeds])?;

    let value_after = ctx.accounts.jlend.value()?;
    let vault = &mut ctx.accounts.vault;
    vault.jlend.cached_value = value_after;
    vault.jlend.cached_slot = Clock::get()?.slot;
    emit!(Deallocated { vault: vault.key(), strategy: SOURCE_JLEND, amount: assets });
    Ok(())
}
