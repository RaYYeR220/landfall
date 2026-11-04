use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, TransferChecked};

use crate::constants::*;
use crate::error::LandfallError;
use crate::events::Redeemed;
use crate::instructions::allocate::*;
use crate::instructions::landing::vault_signer_seeds;
use crate::math;
use crate::nav::{self, Nav};
use crate::state::Vault;
use crate::strategies::kamino::ReserveView;

#[derive(Accounts)]
pub struct RedeemBase<'info> {
    pub owner: Signer<'info>,
    #[account(mut, token::mint = share_mint, token::authority = owner)]
    pub owner_shares: Box<Account<'info, TokenAccount>>,
    /// Any USDC account: the owner's own, or a bridge deposit account (out-operation).
    #[account(mut, token::mint = usdc_mint)]
    pub destination: Box<Account<'info, TokenAccount>>,
    #[account(mut, has_one = share_mint, has_one = idle, has_one = usdc_mint)]
    pub vault: Box<Account<'info, Vault>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(mut)]
    pub idle: Box<Account<'info, TokenAccount>>,
    #[account(mut)]
    pub share_mint: Box<Account<'info, Mint>>,
    /// CHECK: valuation (strict).
    pub kamino_reserve: UncheckedAccount<'info>,
    /// CHECK: valuation (strict).
    pub kamino_collateral: UncheckedAccount<'info>,
    /// CHECK: valuation (strict).
    pub jlend_lending: UncheckedAccount<'info>,
    /// CHECK: valuation (strict).
    pub jlend_ftoken: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

impl<'info> RedeemBase<'info> {
    fn nav(&self) -> Result<Nav> {
        let navs = [
            self.kamino_reserve.to_account_info(),
            self.kamino_collateral.to_account_info(),
            self.jlend_lending.to_account_info(),
            self.jlend_ftoken.to_account_info(),
        ];
        nav::compute(&self.vault, self.idle.amount, &navs, true)
    }

    /// Values the shares, checks slippage and burns them. Returns the USDC owed.
    fn quote_and_burn(&self, shares: u64, min_out: u64) -> Result<u64> {
        require!(shares > 0, LandfallError::InvalidParams);
        let nav = self.nav()?;
        let assets = math::assets_for_shares(shares, self.share_mint.supply, nav.total()).ok_or(LandfallError::MathOverflow)?;
        require!(assets >= min_out && assets > 0, LandfallError::SlippageExceeded);
        token::burn(
            CpiContext::new(
                self.token_program.key(),
                Burn {
                    mint: self.share_mint.to_account_info(),
                    from: self.owner_shares.to_account_info(),
                    authority: self.owner.to_account_info(),
                },
            ),
            shares,
        )?;
        Ok(assets)
    }

    fn pay(&mut self, assets: u64, shares: u64, source: u8) -> Result<()> {
        self.idle.reload()?;
        require!(self.idle.amount >= assets, LandfallError::InsufficientLiquidity);
        let bump = [self.vault.bump];
        let seeds = vault_signer_seeds(&self.vault.usdc_mint, &bump);
        token::transfer_checked(
            CpiContext::new_with_signer(
                self.token_program.key(),
                TransferChecked {
                    from: self.idle.to_account_info(),
                    mint: self.usdc_mint.to_account_info(),
                    to: self.destination.to_account_info(),
                    authority: self.vault.to_account_info(),
                },
                &[&seeds],
            ),
            assets,
            self.usdc_mint.decimals,
        )?;
        self.vault.redeemed_total = self.vault.redeemed_total.saturating_add(assets);
        emit!(Redeemed {
            vault: self.vault.key(),
            owner: self.owner.key(),
            destination: self.destination.key(),
            shares,
            amount: assets,
            source,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Redeem<'info> {
    pub base: RedeemBase<'info>,
}

/// Burn shares and pay from idle only.
pub fn redeem(ctx: Context<Redeem>, shares: u64, min_out: u64) -> Result<()> {
    let assets = ctx.accounts.base.quote_and_burn(shares, min_out)?;
    ctx.accounts.base.pay(assets, shares, SOURCE_IDLE)
}

#[derive(Accounts)]
pub struct RedeemViaKamino<'info> {
    pub base: RedeemBase<'info>,
    pub kamino: KaminoCpi<'info>,
}

/// Burn shares; pull any idle shortfall from Kamino. Tx must be `[refresh_reserve, redeem_via_kamino]`.
pub fn redeem_via_kamino(ctx: Context<RedeemViaKamino>, shares: u64, min_out: u64) -> Result<()> {
    ctx.accounts.kamino.check(&ctx.accounts.base.vault)?;
    let assets = ctx.accounts.base.quote_and_burn(shares, min_out)?;
    let idle = ctx.accounts.base.idle.amount;
    if assets > idle {
        let shortfall = assets - idle;
        let k = &ctx.accounts.kamino;
        let view = ReserveView::parse(&k.reserve.to_account_info()).ok_or(LandfallError::InvalidStrategyAccount)?;
        let need = view
            .collateral_for_liquidity_ceil(shortfall)
            .ok_or(LandfallError::MathOverflow)?
            .saturating_add(1)
            .min(k.collateral_account.amount);
        let vault = &ctx.accounts.base.vault;
        let bump = [vault.bump];
        let seeds = vault_signer_seeds(&vault.usdc_mint, &bump);
        let vault_info = vault.to_account_info();
        let idle_info = ctx.accounts.base.idle.to_account_info();
        let mint_info = ctx.accounts.base.usdc_mint.to_account_info();
        let tp = ctx.accounts.base.token_program.to_account_info();
        k.accounts(&vault_info, &idle_info, &mint_info, &tp).redeem(need, &[&seeds])?;
        let value_after = ctx.accounts.kamino.value()?;
        let v = &mut ctx.accounts.base.vault;
        v.kamino.cached_value = value_after;
        v.kamino.cached_slot = Clock::get()?.slot;
    }
    ctx.accounts.base.pay(assets, shares, SOURCE_KAMINO)
}

#[derive(Accounts)]
pub struct RedeemViaJlend<'info> {
    pub base: RedeemBase<'info>,
    pub jlend: JlendCpi<'info>,
}

/// Burn shares; pull any idle shortfall from Jupiter Lend.
pub fn redeem_via_jlend(ctx: Context<RedeemViaJlend>, shares: u64, min_out: u64) -> Result<()> {
    ctx.accounts.jlend.check(&ctx.accounts.base.vault)?;
    let assets = ctx.accounts.base.quote_and_burn(shares, min_out)?;
    let idle = ctx.accounts.base.idle.amount;
    if assets > idle {
        let shortfall = assets - idle;
        let vault = &ctx.accounts.base.vault;
        let bump = [vault.bump];
        let seeds = vault_signer_seeds(&vault.usdc_mint, &bump);
        let vault_info = vault.to_account_info();
        let idle_info = ctx.accounts.base.idle.to_account_info();
        let mint_info = ctx.accounts.base.usdc_mint.to_account_info();
        let tp = ctx.accounts.base.token_program.to_account_info();
        ctx.accounts.jlend.accounts(&vault_info, &idle_info, &mint_info, &tp).withdraw(shortfall, &[&seeds])?;
        let value_after = ctx.accounts.jlend.value()?;
        let v = &mut ctx.accounts.base.vault;
        v.jlend.cached_value = value_after;
        v.jlend.cached_slot = Clock::get()?.slot;
    }
    ctx.accounts.base.pay(assets, shares, SOURCE_JLEND)
}
