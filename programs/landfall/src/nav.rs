//! Net asset value of the vault.
//!
//! Strategy valuation accounts are passed as the first four remaining
//! accounts, in this order:
//! `[kamino_reserve, vault_kamino_collateral, jlend_lending, vault_jlend_ftoken]`.
//! Configured strategies must be passed at their configured addresses (the
//! caller cannot pick a price source). In a landing (`deposit`, `sweep_inbox`)
//! an account that exists at the right address but no longer parses falls back
//! to the strategy's cached value, so a landing never reverts on protocol
//! state. Everything that pays out (`redeem`) values strictly.
//!
//! Known limit: protocol exchange rates are read as last stored by the
//! protocol. Interest accrued since the protocol's last update is not counted
//! until someone refreshes it (every allocate / redeem-via path refreshes in the
//! same transaction); the resulting mispricing is bounded by APY × staleness.

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
    pub kamino_live: bool,
    pub jlend_live: bool,
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

/// The caller must pass exactly the configured accounts; a wrong or missing
/// key is rejected, so nobody can choose between a live and a cached price.
fn require_keys(info: Option<&AccountInfo>, expected: &Pubkey) -> Result<()> {
    require!(info.map(|i| i.key == expected).unwrap_or(false), LandfallError::InvalidStrategyAccount);
    Ok(())
}

fn kamino_live(vault: &Vault, reserve: &AccountInfo, coll: &AccountInfo) -> Option<u64> {
    let view = ReserveView::parse(reserve)?;
    if view.collateral_mint != vault.kamino.collateral_mint || view.liquidity_mint != vault.usdc_mint {
        return None;
    }
    let amount = token_amount(coll, &vault.kamino.collateral_account)?;
    view.liquidity_for_collateral(amount)
}

fn jlend_live(vault: &Vault, lending: &AccountInfo, ftoken: &AccountInfo) -> Option<u64> {
    let view = LendingView::parse(lending)?;
    if view.ftoken_mint != vault.jlend.ftoken_mint || view.mint != vault.usdc_mint {
        return None;
    }
    let shares = token_amount(ftoken, &vault.jlend.ftoken_account)?;
    view.assets_for_shares(shares)
}

/// Computes NAV. Configured strategies must be passed at their configured
/// addresses. If such an account cannot be parsed (protocol upgrade, closed
/// account) a landing (`strict = false`) uses the cached value; anything that
/// pays out (`strict = true`) fails. Once the admin disables such a strategy
/// it is valued at zero for landings and payouts alike (no price gap between
/// entering and leaving), so idle USDC stays redeemable.
pub fn compute(vault: &Vault, idle: u64, remaining: &[AccountInfo], strict: bool) -> Result<Nav> {
    let get = |i: usize| remaining.get(i);
    let mut nav = Nav { idle, live: true, ..Default::default() };

    if vault.kamino.reserve != Pubkey::default() {
        require_keys(get(0), &vault.kamino.reserve)?;
        require_keys(get(1), &vault.kamino.collateral_account)?;
        match kamino_live(vault, get(0).unwrap(), get(1).unwrap()) {
            Some(v) => {
                nav.kamino = v;
                nav.kamino_live = true;
            }
            None if !vault.kamino.enabled => {
                // written off by the admin: in and out are priced on what is verifiable
                nav.kamino = 0;
                nav.live = false;
            }
            None => {
                require!(!strict, LandfallError::StrategyValuationUnavailable);
                nav.kamino = vault.kamino.cached_value;
                nav.live = false;
            }
        }
    }
    if vault.jlend.lending != Pubkey::default() {
        require_keys(get(2), &vault.jlend.lending)?;
        require_keys(get(3), &vault.jlend.ftoken_account)?;
        match jlend_live(vault, get(2).unwrap(), get(3).unwrap()) {
            Some(v) => {
                nav.jlend = v;
                nav.jlend_live = true;
            }
            None if !vault.jlend.enabled => {
                // written off by the admin: in and out are priced on what is verifiable
                nav.jlend = 0;
                nav.live = false;
            }
            None => {
                require!(!strict, LandfallError::StrategyValuationUnavailable);
                nav.jlend = vault.jlend.cached_value;
                nav.live = false;
            }
        }
    }
    Ok(nav)
}
