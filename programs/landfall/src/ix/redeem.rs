//! Redemptions: burn shares, pay USDC to any USDC account, pulling an idle
//! shortfall from at most one strategy.

use pinocchio::error::ProgramError;
use pinocchio::{AccountView, ProgramResult};

use crate::constants::*;
use crate::error::{require, LandfallError, Result};
use crate::ix::strategy::{jlend_accounts, jlend_cpi, jlend_value, kamino_accounts, kamino_cpi, kamino_value};
use crate::math;
use crate::nav;
use crate::state::Vault;
use crate::strategies::kamino::ReserveView;
use crate::token;
use crate::util::*;

const BASE: usize = 12;

struct Quote {
    v: Vault,
    assets: u64,
    shares: u64,
}

/// Base accounts:
/// `[owner, owner_shares, destination, vault, usdc_mint, idle, share_mint, kamino_reserve, kamino_collateral, jlend_lending, jlend_ftoken, token]`
/// Values the shares strictly, checks slippage and burns them.
fn quote_and_burn(b: &mut [AccountView], data: &[u8]) -> Result<Quote> {
    let [owner, owner_shares, destination, vault_acc, usdc, idle, share_mint, kr, kc, jl, jf, token_p] = b else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    signer(owner)?;
    key_is(token_p, &TOKEN_PROGRAM)?;
    let v = Vault::load(vault_acc)?;
    key_is(usdc, &v.usdc_mint)?;
    key_is(idle, &v.idle)?;
    key_is(share_mint, &v.share_mint)?;
    token_of(owner_shares, &v.share_mint, owner.address())?;
    token_of_mint(destination, &v.usdc_mint)?;
    let shares = read_u64(data, 0)?;
    let min_out = read_u64(data, 8)?;
    require(shares > 0, LandfallError::InvalidParams)?;

    let idle_amount = token_of(idle, &v.usdc_mint, vault_acc.address())?.amount;
    let navs = [*kr, *kc, *jl, *jf];
    let nav = nav::compute(&v, idle_amount, &navs, true)?;
    let supply = read_mint(share_mint)?.supply;
    let assets = math::assets_for_shares(shares, supply, nav.total()).ok_or(LandfallError::MathOverflow)?;
    require(assets >= min_out && assets > 0, LandfallError::SlippageExceeded)?;
    token::burn(owner_shares, share_mint, owner, shares)?;
    Ok(Quote { v, assets, shares })
}

fn pay(b: &mut [AccountView], mut q: Quote, source: u8) -> ProgramResult {
    let owner = b[0];
    let destination = b[2];
    let mut vault_acc = b[3];
    let usdc = b[4];
    let idle = b[5];
    let idle_amount = read_token(&idle).ok_or(LandfallError::InvalidAccount)?.amount;
    require(idle_amount >= q.assets, LandfallError::InsufficientLiquidity)?;
    let decimals = read_mint(&usdc)?.decimals;
    token::with_vault_signer(&q.v, |s| token::transfer(&idle, &usdc, &destination, &vault_acc, q.assets, decimals, s))?;
    q.v.redeemed_total = q.v.redeemed_total.saturating_add(q.assets);
    q.v.store(&mut vault_acc)?;
    Event::new(EV_REDEEMED)
        .key(vault_acc.address())
        .key(owner.address())
        .key(destination.address())
        .u64(q.shares)
        .u64(q.assets)
        .u8(source)
        .emit();
    Ok(())
}

/// Burn shares and pay from idle only.
pub fn redeem(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    require(accounts.len() >= BASE, LandfallError::InvalidAccount)?;
    let q = quote_and_burn(&mut accounts[..BASE], data)?;
    pay(&mut accounts[..BASE], q, SOURCE_IDLE)
}

/// Pull any idle shortfall from Kamino. Tx must be `[refresh_reserve, redeem_via_kamino]`.
/// `[<12 base>, <8 kamino>]`
pub fn redeem_via_kamino(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    require(accounts.len() >= BASE + 8, LandfallError::InvalidAccount)?;
    let mut q = quote_and_burn(&mut accounts[..BASE], data)?;
    let (b, rest) = accounts.split_at_mut(BASE);
    let k = kamino_accounts(&q.v, rest)?;
    let (vault_acc, usdc, idle, token_p) = (&b[3], &b[4], &b[5], &b[11]);
    let idle_amount = read_token(idle).ok_or(LandfallError::InvalidAccount)?.amount;
    if q.assets > idle_amount {
        let shortfall = q.assets - idle_amount;
        let view = ReserveView::parse(&k[0]).ok_or(LandfallError::InvalidStrategyAccount)?;
        let held = read_token(&k[1]).ok_or(LandfallError::InvalidStrategyAccount)?.amount;
        let need = view.collateral_for_liquidity_ceil(shortfall).ok_or(LandfallError::MathOverflow)?.saturating_add(1).min(held);
        token::with_vault_signer(&q.v, |s| kamino_cpi(k, vault_acc, idle, usdc, token_p).redeem(need, s))?;
        q.v.kamino.cached_value = kamino_value(k)?;
        q.v.kamino.cached_slot = slot()?;
    }
    pay(b, q, SOURCE_KAMINO)
}

/// Pull any idle shortfall from Jupiter Lend.
/// `[<12 base>, <15 jlend>]`
pub fn redeem_via_jlend(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    require(accounts.len() >= BASE + 15, LandfallError::InvalidAccount)?;
    let mut q = quote_and_burn(&mut accounts[..BASE], data)?;
    let (b, rest) = accounts.split_at_mut(BASE);
    let j = jlend_accounts(&q.v, rest)?;
    let (vault_acc, usdc, idle, token_p) = (&b[3], &b[4], &b[5], &b[11]);
    let idle_amount = read_token(idle).ok_or(LandfallError::InvalidAccount)?.amount;
    if q.assets > idle_amount {
        let shortfall = q.assets - idle_amount;
        token::with_vault_signer(&q.v, |s| jlend_cpi(j, vault_acc, idle, usdc, token_p).withdraw(shortfall, s))?;
        q.v.jlend.cached_value = jlend_value(j)?;
        q.v.jlend.cached_slot = slot()?;
    }
    pay(b, q, SOURCE_JLEND)
}
