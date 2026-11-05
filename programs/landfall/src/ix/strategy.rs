//! Allocation to / from Kamino and Jupiter Lend, and NAV cache refresh.

use pinocchio::error::ProgramError;
use pinocchio::{AccountView, ProgramResult};

use crate::constants::*;
use crate::error::{require, LandfallError, Result};
use crate::math::bps_of;
use crate::nav::{self, Nav};
use crate::state::Vault;
use crate::strategies::{jlend::JlendCpi, kamino::KaminoCpi, kamino::ReserveView, jlend::LendingView};
use crate::token;
use crate::util::*;

/// The 8 Kamino accounts, in program order:
/// `[reserve, collateral_account, lending_market, lending_market_authority, reserve_liquidity_supply, collateral_mint, instructions_sysvar, kamino_program]`
pub fn kamino_accounts<'a>(v: &Vault, k: &'a [AccountView]) -> Result<&'a [AccountView; 8]> {
    let k: &[AccountView; 8] = k.get(..8).ok_or(ProgramError::NotEnoughAccountKeys)?.try_into().map_err(|_| ProgramError::NotEnoughAccountKeys)?;
    require(
        k[0].address() == &v.kamino.reserve
            && k[1].address() == &v.kamino.collateral_account
            && k[2].address() == &v.kamino.market
            && k[5].address() == &v.kamino.collateral_mint
            && v.kamino.reserve != pinocchio::Address::default(),
        LandfallError::InvalidStrategyAccount,
    )?;
    key_is(&k[6], &INSTRUCTIONS_SYSVAR)?;
    key_is(&k[7], &KAMINO_LENDING_PROGRAM)?;
    Ok(k)
}

pub fn kamino_cpi<'a>(k: &'a [AccountView; 8], vault: &'a AccountView, idle: &'a AccountView, usdc: &'a AccountView, token_p: &'a AccountView) -> KaminoCpi<'a> {
    KaminoCpi {
        owner: vault,
        reserve: &k[0],
        lending_market: &k[2],
        lending_market_authority: &k[3],
        liquidity_mint: usdc,
        liquidity_supply: &k[4],
        collateral_mint: &k[5],
        liquidity_account: idle,
        collateral_account: &k[1],
        token_program: token_p,
        instructions_sysvar: &k[6],
    }
}

pub fn kamino_value(k: &[AccountView; 8]) -> Result<u64> {
    let view = ReserveView::parse(&k[0]).ok_or(LandfallError::InvalidStrategyAccount)?;
    let amount = read_token(&k[1]).ok_or(LandfallError::InvalidStrategyAccount)?.amount;
    view.liquidity_for_collateral(amount).ok_or(LandfallError::MathOverflow.into())
}

/// The 15 Jupiter Lend accounts, in program order:
/// `[lending, ftoken_account, ftoken_mint, lending_admin, supply_token_reserves_liquidity, lending_supply_position_on_liquidity, rate_model, liquidity_vault, claim_account, liquidity, liquidity_program, rewards_rate_model, jlend_program, ata_program, system_program]`
pub fn jlend_accounts<'a>(v: &Vault, j: &'a [AccountView]) -> Result<&'a [AccountView; 15]> {
    let j: &[AccountView; 15] = j.get(..15).ok_or(ProgramError::NotEnoughAccountKeys)?.try_into().map_err(|_| ProgramError::NotEnoughAccountKeys)?;
    require(
        j[0].address() == &v.jlend.lending
            && j[1].address() == &v.jlend.ftoken_account
            && j[2].address() == &v.jlend.ftoken_mint
            && v.jlend.lending != pinocchio::Address::default(),
        LandfallError::InvalidStrategyAccount,
    )?;
    key_is(&j[10], &JUPITER_LIQUIDITY_PROGRAM)?;
    key_is(&j[12], &JUPITER_LEND_PROGRAM)?;
    key_is(&j[13], &ATA_PROGRAM)?;
    key_is(&j[14], &SYSTEM_PROGRAM)?;
    Ok(j)
}

pub fn jlend_cpi<'a>(j: &'a [AccountView; 15], vault: &'a AccountView, idle: &'a AccountView, usdc: &'a AccountView, token_p: &'a AccountView) -> JlendCpi<'a> {
    JlendCpi {
        signer: vault,
        asset_account: idle,
        ftoken_account: &j[1],
        mint: usdc,
        lending_admin: &j[3],
        lending: &j[0],
        ftoken_mint: &j[2],
        supply_token_reserves_liquidity: &j[4],
        lending_supply_position_on_liquidity: &j[5],
        rate_model: &j[6],
        liquidity_vault: &j[7],
        claim_account: &j[8],
        liquidity: &j[9],
        liquidity_program: &j[10],
        rewards_rate_model: &j[11],
        token_program: token_p,
        associated_token_program: &j[13],
        system_program: &j[14],
    }
}

pub fn jlend_value(j: &[AccountView; 15]) -> Result<u64> {
    let view = LendingView::parse(&j[0]).ok_or(LandfallError::InvalidStrategyAccount)?;
    let shares = read_token(&j[1]).ok_or(LandfallError::InvalidStrategyAccount)?.amount;
    view.assets_for_shares(shares).ok_or(LandfallError::MathOverflow.into())
}

/// `(spare idle above the buffer, room left under the target weight and cap)`.
fn allocation_room(v: &Vault, nav: &Nav, current: u64, weight_bps: u16, cap: u64) -> (u64, u64) {
    let total = nav.total();
    let spare = nav.idle.saturating_sub(bps_of(total, v.idle_buffer_bps));
    let room = bps_of(total, weight_bps).saturating_sub(current).min(cap.saturating_sub(current));
    (spare, room)
}

fn base(vault_acc: &AccountView, usdc: &AccountView, idle: &AccountView, token_p: &AccountView) -> Result<(Vault, u64)> {
    key_is(token_p, &TOKEN_PROGRAM)?;
    let v = Vault::load(vault_acc)?;
    key_is(usdc, &v.usdc_mint)?;
    key_is(idle, &v.idle)?;
    let idle_amount = token_of(idle, &v.usdc_mint, vault_acc.address())?.amount;
    Ok((v, idle_amount))
}

/// Permissionless. Tx must be `[kamino refresh_reserve, allocate_kamino]`.
/// `[keeper, vault, usdc_mint, idle, <8 kamino>, jlend_lending, jlend_ftoken, token]` data: amount u64
pub fn allocate_kamino(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    require(accounts.len() >= 15, LandfallError::InvalidAccount)?;
    let (head, rest) = accounts.split_at_mut(4);
    let [keeper, vault_acc, usdc, idle] = head else { return Err(ProgramError::NotEnoughAccountKeys) };
    let (kam, tail) = rest.split_at(8);
    let token_p = &tail[2];
    signer(keeper)?;
    let (mut v, idle_amount) = base(vault_acc, usdc, idle, token_p)?;
    require(!v.paused, LandfallError::Paused)?;
    require(v.kamino.enabled, LandfallError::StrategyDisabled)?;
    let k = kamino_accounts(&v, kam)?;
    let navs = [k[0], k[1], tail[0], tail[1]];
    let nav = nav::compute(&v, idle_amount, &navs, true)?;
    let view = ReserveView::parse(&k[0]).ok_or(LandfallError::InvalidStrategyAccount)?;
    require(view.is_active(), LandfallError::StrategyDisabled)?;

    let amount = read_u64(data, 0)?;
    let (spare, room) = allocation_room(&v, &nav, nav.kamino, v.kamino.weight_bps, v.kamino.cap);
    require(amount > 0 && amount <= spare, LandfallError::InsufficientIdle)?;
    require(amount <= room && amount <= view.deposit_room(), LandfallError::AllocationExceedsTarget)?;

    token::with_vault_signer(&v, |s| kamino_cpi(k, vault_acc, idle, usdc, token_p).deposit(amount, s))?;
    let after = kamino_value(k)?;
    v.kamino.cached_value = after;
    v.kamino.cached_slot = slot()?;
    v.store(vault_acc)?;
    Event::new(EV_ALLOCATED).key(vault_acc.address()).u8(SOURCE_KAMINO).u64(amount).u64(after).emit();
    Ok(())
}

/// Permissionless.
/// `[keeper, vault, usdc_mint, idle, <15 jlend>, kamino_reserve, kamino_collateral, token]` data: amount u64
pub fn allocate_jlend(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    require(accounts.len() >= 22, LandfallError::InvalidAccount)?;
    let (head, rest) = accounts.split_at_mut(4);
    let [keeper, vault_acc, usdc, idle] = head else { return Err(ProgramError::NotEnoughAccountKeys) };
    let (jl, tail) = rest.split_at(15);
    let token_p = &tail[2];
    signer(keeper)?;
    let (mut v, idle_amount) = base(vault_acc, usdc, idle, token_p)?;
    require(!v.paused, LandfallError::Paused)?;
    require(v.jlend.enabled, LandfallError::StrategyDisabled)?;
    let j = jlend_accounts(&v, jl)?;
    let navs = [tail[0], tail[1], j[0], j[1]];
    let nav = nav::compute(&v, idle_amount, &navs, true)?;

    let amount = read_u64(data, 0)?;
    let (spare, room) = allocation_room(&v, &nav, nav.jlend, v.jlend.weight_bps, v.jlend.cap);
    require(amount > 0 && amount <= spare, LandfallError::InsufficientIdle)?;
    require(amount <= room, LandfallError::AllocationExceedsTarget)?;

    token::with_vault_signer(&v, |s| jlend_cpi(j, vault_acc, idle, usdc, token_p).deposit(amount, s))?;
    let after = jlend_value(j)?;
    v.jlend.cached_value = after;
    v.jlend.cached_slot = slot()?;
    v.store(vault_acc)?;
    Event::new(EV_ALLOCATED).key(vault_acc.address()).u8(SOURCE_JLEND).u64(amount).u64(after).emit();
    Ok(())
}

fn curator_base(curator: &AccountView, vault_acc: &AccountView, usdc: &AccountView, idle: &AccountView, token_p: &AccountView) -> Result<(Vault, u64)> {
    signer(curator)?;
    let (v, idle_amount) = base(vault_acc, usdc, idle, token_p)?;
    require(curator.address() == &v.curator, LandfallError::Unauthorized)?;
    Ok((v, idle_amount))
}

/// Curator rebalance. Tx must be `[refresh_reserve, deallocate_kamino]`.
/// `[curator, vault, usdc_mint, idle, <8 kamino>, token]` data: collateral u64
pub fn deallocate_kamino(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    require(accounts.len() >= 13, LandfallError::InvalidAccount)?;
    let (head, rest) = accounts.split_at_mut(4);
    let [curator, vault_acc, usdc, idle] = head else { return Err(ProgramError::NotEnoughAccountKeys) };
    let (kam, tail) = rest.split_at(8);
    let token_p = &tail[0];
    let (mut v, before) = curator_base(curator, vault_acc, usdc, idle, token_p)?;
    let k = kamino_accounts(&v, kam)?;
    let collateral = read_u64(data, 0)?;
    token::with_vault_signer(&v, |s| kamino_cpi(k, vault_acc, idle, usdc, token_p).redeem(collateral, s))?;
    let received = read_token(idle).map(|t| t.amount).unwrap_or(before).saturating_sub(before);
    v.kamino.cached_value = kamino_value(k)?;
    v.kamino.cached_slot = slot()?;
    v.store(vault_acc)?;
    Event::new(EV_DEALLOCATED).key(vault_acc.address()).u8(SOURCE_KAMINO).u64(received).emit();
    Ok(())
}

/// Curator rebalance.
/// `[curator, vault, usdc_mint, idle, <15 jlend>, token]` data: assets u64
pub fn deallocate_jlend(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    require(accounts.len() >= 20, LandfallError::InvalidAccount)?;
    let (head, rest) = accounts.split_at_mut(4);
    let [curator, vault_acc, usdc, idle] = head else { return Err(ProgramError::NotEnoughAccountKeys) };
    let (jl, tail) = rest.split_at(15);
    let token_p = &tail[0];
    let (mut v, _) = curator_base(curator, vault_acc, usdc, idle, token_p)?;
    let j = jlend_accounts(&v, jl)?;
    let assets = read_u64(data, 0)?;
    token::with_vault_signer(&v, |s| jlend_cpi(j, vault_acc, idle, usdc, token_p).withdraw(assets, s))?;
    v.jlend.cached_value = jlend_value(j)?;
    v.jlend.cached_slot = slot()?;
    v.store(vault_acc)?;
    Event::new(EV_DEALLOCATED).key(vault_acc.address()).u8(SOURCE_JLEND).u64(assets).emit();
    Ok(())
}

/// Anyone: refresh the cached strategy values (live valuations only).
/// `[vault, idle, kamino_reserve, kamino_collateral, jlend_lending, jlend_ftoken]`
pub fn sync_nav(accounts: &mut [AccountView], _data: &[u8]) -> ProgramResult {
    require(accounts.len() >= 6, LandfallError::InvalidAccount)?;
    let (head, navs) = accounts.split_at_mut(2);
    let [vault_acc, idle] = head else { return Err(ProgramError::NotEnoughAccountKeys) };
    let mut v = Vault::load(vault_acc)?;
    key_is(idle, &v.idle)?;
    let idle_amount = token_of(idle, &v.usdc_mint, vault_acc.address())?.amount;
    let nav = nav::compute(&v, idle_amount, navs, true)?;
    let now = slot()?;
    if nav.kamino_live {
        v.kamino.cached_value = nav.kamino;
        v.kamino.cached_slot = now;
    }
    if nav.jlend_live {
        v.jlend.cached_value = nav.jlend;
        v.jlend.cached_slot = now;
    }
    v.store(vault_acc)
}
