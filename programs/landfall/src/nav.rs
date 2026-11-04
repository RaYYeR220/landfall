//! Net asset value of the vault.
//!
//! Strategy valuation accounts are passed as the first four remaining
//! accounts, in this order:
//! `[kamino_reserve, vault_kamino_collateral, jlend_lending, vault_jlend_ftoken]`.
//! In a landing (`deposit`, `sweep_inbox`) a missing or unparseable account
//! falls back to the strategy's cached value so the landing never reverts on
//! protocol state. Everything that pays out (`redeem`) values strictly.

use anchor_lang::prelude::*;

use crate::error::LandfallError;
use crate::state::Vault;
use crate::strategies::{jlend::LendingView, kamino::ReserveView};

pub const NAV_ACCOUNTS: usize = 4;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Nav {
    pub idle: u64,
    pub kamino: u64,
    pub jlend: u64,
    /// True when every configured strategy was valued from live accounts.
    pub live: bool,
}

impl Nav {
    pub fn total(&self) -> u64 {
        self.idle.saturating_add(self.kamino).saturating_add(self.jlend)
    }
}

/// Reads an SPL token account's amount if it is the expected account.
pub fn token_amount(info: &AccountInfo, expected: &Pubkey) -> Option<u64> {
    if info.key != expected || info.owner != &anchor_spl::token::ID {
        return None;
    }
    let data = info.try_borrow_data().ok()?;
    if data.len() < 72 {
        return None;
    }
    Some(u64::from_le_bytes(data[64..72].try_into().ok()?))
}

fn kamino_live(vault: &Vault, reserve: &AccountInfo, coll: &AccountInfo) -> Option<u64> {
    if reserve.key != &vault.kamino.reserve {
        return None;
    }
    let view = ReserveView::parse(reserve)?;
    if view.collateral_mint != vault.kamino.collateral_mint || view.liquidity_mint != vault.usdc_mint {
        return None;
    }
    let amount = token_amount(coll, &vault.kamino.collateral_account)?;
    view.liquidity_for_collateral(amount)
}

fn jlend_live(vault: &Vault, lending: &AccountInfo, ftoken: &AccountInfo) -> Option<u64> {
    if lending.key != &vault.jlend.lending {
        return None;
    }
    let view = LendingView::parse(lending)?;
    if view.ftoken_mint != vault.jlend.ftoken_mint || view.mint != vault.usdc_mint {
        return None;
    }
    let shares = token_amount(ftoken, &vault.jlend.ftoken_account)?;
    view.assets_for_shares(shares)
}

/// Computes NAV. `strict` = every configured strategy must be valued live.
pub fn compute(vault: &Vault, idle: u64, remaining: &[AccountInfo], strict: bool) -> Result<Nav> {
    let get = |i: usize| remaining.get(i);
    let mut nav = Nav { idle, live: true, ..Default::default() };

    if vault.kamino.reserve != Pubkey::default() {
        match get(0).zip(get(1)).and_then(|(r, c)| kamino_live(vault, r, c)) {
            Some(v) => nav.kamino = v,
            None => {
                require!(!strict, LandfallError::StrategyValuationUnavailable);
                nav.kamino = vault.kamino.cached_value;
                nav.live = false;
            }
        }
    }
    if vault.jlend.lending != Pubkey::default() {
        match get(2).zip(get(3)).and_then(|(l, f)| jlend_live(vault, l, f)) {
            Some(v) => nav.jlend = v,
            None => {
                require!(!strict, LandfallError::StrategyValuationUnavailable);
                nav.jlend = vault.jlend.cached_value;
                nav.live = false;
            }
        }
    }
    Ok(nav)
}
