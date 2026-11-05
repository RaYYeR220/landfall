//! Net asset value of the vault.
//!
//! Configured strategies must be passed at their configured addresses, so a
//! caller cannot pick a price source. If such an account exists but no longer
//! parses (protocol upgrade, closed account):
//! - while the strategy is enabled, a landing values it at its cached (last
//!   live) value and anything that pays out fails;
//! - once the admin disables it (`written_off`), payouts value it at zero and
//!   landings pause without reverting, so no shares are ever minted at a
//!   price that payouts would not honour.
//!
//! Known limit: exchange rates are read as last stored by each protocol;
//! interest accrued since the protocol's last update is only counted after a
//! refresh (allocate / redeem-via paths refresh in the same transaction).

use pinocchio::{AccountView, Address};

use crate::error::{require, LandfallError, Result};
use crate::state::Vault;
use crate::strategies::{jlend::LendingView, kamino::ReserveView};
use crate::util::read_token;

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Nav {
    pub idle: u64,
    pub kamino: u64,
    pub jlend: u64,
    pub live: bool,
    pub kamino_live: bool,
    pub jlend_live: bool,
    pub written_off: bool,
}

impl Nav {
    pub fn total(&self) -> u64 {
        self.idle.saturating_add(self.kamino).saturating_add(self.jlend)
    }
}

fn amount_if(acc: &AccountView, expected: &Address) -> Option<u64> {
    if acc.address() != expected {
        return None;
    }
    read_token(acc).map(|t| t.amount)
}

fn kamino_live(v: &Vault, reserve: &AccountView, coll: &AccountView) -> Option<u64> {
    let view = ReserveView::parse(reserve)?;
    if view.collateral_mint != v.kamino.collateral_mint || view.liquidity_mint != v.usdc_mint {
        return None;
    }
    view.liquidity_for_collateral(amount_if(coll, &v.kamino.collateral_account)?)
}

fn jlend_live(v: &Vault, lending: &AccountView, ftoken: &AccountView) -> Option<u64> {
    let view = LendingView::parse(lending)?;
    if view.ftoken_mint != v.jlend.ftoken_mint || view.mint != v.usdc_mint {
        return None;
    }
    view.assets_for_shares(amount_if(ftoken, &v.jlend.ftoken_account)?)
}

/// `nav_accounts` = `[kamino_reserve, kamino_collateral, jlend_lending, jlend_ftoken]`.
pub fn compute(v: &Vault, idle: u64, nav_accounts: &[AccountView], strict: bool) -> Result<Nav> {
    let mut nav = Nav { idle, live: true, ..Default::default() };
    let at = |i: usize, expected: &Address| -> Result<&AccountView> {
        let a = nav_accounts.get(i).ok_or(LandfallError::InvalidStrategyAccount)?;
        require(a.address() == expected, LandfallError::InvalidStrategyAccount)?;
        Ok(a)
    };

    if v.kamino.reserve != Address::default() {
        let (r, c) = (at(0, &v.kamino.reserve)?, at(1, &v.kamino.collateral_account)?);
        match kamino_live(v, r, c) {
            Some(x) => {
                nav.kamino = x;
                nav.kamino_live = true;
            }
            None if !v.kamino.enabled => {
                nav.kamino = 0;
                nav.live = false;
                nav.written_off = true;
            }
            None => {
                require(!strict, LandfallError::StrategyValuationUnavailable)?;
                nav.kamino = v.kamino.cached_value;
                nav.live = false;
            }
        }
    }
    if v.jlend.lending != Address::default() {
        let (l, f) = (at(2, &v.jlend.lending)?, at(3, &v.jlend.ftoken_account)?);
        match jlend_live(v, l, f) {
            Some(x) => {
                nav.jlend = x;
                nav.jlend_live = true;
            }
            None if !v.jlend.enabled => {
                nav.jlend = 0;
                nav.live = false;
                nav.written_off = true;
            }
            None => {
                require(!strict, LandfallError::StrategyValuationUnavailable)?;
                nav.jlend = v.jlend.cached_value;
                nav.live = false;
            }
        }
    }
    Ok(nav)
}
