//! Landings: `deposit` (wallets / Intents Connect intermediaries) and the
//! inbox lifecycle (`open_inbox`, permissionless `sweep_inbox`).

use pinocchio::error::ProgramError;
use pinocchio::{AccountView, ProgramResult};
use pinocchio_associated_token_account::instructions::CreateIdempotent;

use crate::constants::*;
use crate::error::{require, LandfallError, Result};
use crate::ix::admin::create_pda;
use crate::math;
use crate::nav::{self, Nav};
use crate::state::{Inbox, Vault};
use crate::token;
use crate::util::*;

/// Landing source in the `Landed` event (Anchor enum index).
const SOURCE_DIRECT: u8 = 0;
const SOURCE_INBOX: u8 = 1;

fn mint_landing_shares(v: &Vault, share_mint: &AccountView, owner_shares: &AccountView, vault_acc: &AccountView, amount: u64, nav: &Nav) -> Result<u64> {
    let supply = read_mint(share_mint)?.supply;
    let shares = math::shares_for_assets(amount, supply, nav.total()).ok_or(LandfallError::MathOverflow)?;
    token::with_vault_signer(v, |s| token::mint_to(share_mint, owner_shares, vault_acc, shares, s))?;
    Ok(shares)
}

#[allow(clippy::too_many_arguments)]
fn landed_event(v: &AccountView, owner: &AccountView, depositor: &AccountView, source: u8, amount: u64, shares: u64, nav: &Nav) {
    Event::new(EV_LANDED)
        .key(v.address())
        .key(owner.address())
        .key(depositor.address())
        .u8(source)
        .u64(amount)
        .u64(shares)
        .u64(nav.total())
        .u8(nav.live as u8)
        .emit();
}

/// The landing instruction: called by a wallet, or by an Intents Connect
/// intermediary as its bridge-in step with `amount = {MIN_AMOUNT_OUT}`.
/// It never calls into a lending protocol and never fails on protocol
/// state: 0 = no-op, paused = still lands, unreadable strategy = cached
/// value, written-off strategy = funds stay with the depositor.
///
/// `[depositor, depositor_usdc, owner, owner_shares, vault, usdc_mint, idle, share_mint, token, kamino_reserve, kamino_collateral, jlend_lending, jlend_ftoken]`
pub fn deposit(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let (fixed, navs) = accounts.split_at_mut(accounts.len().min(9));
    let [depositor, depositor_usdc, owner, owner_shares, vault_acc, usdc_mint, idle, share_mint, token_p] = fixed else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    signer(depositor)?;
    key_is(token_p, &TOKEN_PROGRAM)?;
    let mut v = Vault::load(vault_acc)?;
    key_is(usdc_mint, &v.usdc_mint)?;
    key_is(idle, &v.idle)?;
    key_is(share_mint, &v.share_mint)?;
    let src = token_of(depositor_usdc, &v.usdc_mint, depositor.address())?;
    token_of(owner_shares, &v.share_mint, owner.address())?;

    // u64::MAX (or anything above the balance) deposits the whole balance
    let amount = read_u64(data, 0)?.min(src.amount);
    if amount == 0 {
        return Ok(());
    }
    let idle_amount = token_of(idle, &v.usdc_mint, vault_acc.address())?.amount;
    let nav_before = nav::compute(&v, idle_amount, navs, false)?;
    if nav_before.written_off {
        // vault in maintenance: leave the funds with the depositor, mint nothing
        Event::new(EV_LANDING_DEFERRED).key(vault_acc.address()).key(owner.address()).u64(amount).emit();
        return Ok(());
    }

    let decimals = read_mint(usdc_mint)?.decimals;
    token::transfer(depositor_usdc, usdc_mint, idle, depositor, amount, decimals, &[])?;
    let shares = mint_landing_shares(&v, share_mint, owner_shares, vault_acc, amount, &nav_before)?;

    v.landed_total = v.landed_total.saturating_add(amount);
    v.landed_count = v.landed_count.saturating_add(1);
    v.store(vault_acc)?;
    landed_event(vault_acc, owner, depositor, SOURCE_DIRECT, amount, shares, &nav_before);
    Ok(())
}

/// Creates (idempotently) the owner's inbox and its USDC account, the
/// recipient of the owner's persistent deposit addresses.
///
/// `[payer, vault, usdc_mint, owner, inbox, inbox_usdc, token, ata, system]`
pub fn open_inbox(accounts: &mut [AccountView], _data: &[u8]) -> ProgramResult {
    let [payer, vault_acc, usdc_mint, owner, inbox_acc, inbox_usdc, token_p, ata_p, system_p, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    signer(payer)?;
    key_is(token_p, &TOKEN_PROGRAM)?;
    key_is(ata_p, &ATA_PROGRAM)?;
    key_is(system_p, &SYSTEM_PROGRAM)?;
    let v = Vault::load(vault_acc)?;
    key_is(usdc_mint, &v.usdc_mint)?;
    let (inbox_key, bump) = find(&[INBOX_SEED, vault_acc.address().as_ref(), owner.address().as_ref()], &ID);
    key_is(inbox_acc, &inbox_key)?;

    if !inbox_acc.owned_by(&ID) {
        let b = [bump];
        let seeds = [
            pinocchio::cpi::Seed::from(INBOX_SEED),
            pinocchio::cpi::Seed::from(vault_acc.address().as_ref()),
            pinocchio::cpi::Seed::from(owner.address().as_ref()),
            pinocchio::cpi::Seed::from(&b),
        ];
        create_pda(payer, inbox_acc, Inbox::LEN, &ID, &[pinocchio::cpi::Signer::from(&seeds)])?;
        let inbox = Inbox { vault: *vault_acc.address(), owner: *owner.address(), swept_total: 0, sweep_count: 0, created_slot: slot()?, bump };
        inbox.store(inbox_acc)?;
        Event::new(EV_INBOX_OPENED).key(vault_acc.address()).key(owner.address()).key(&inbox_key).emit();
    }
    CreateIdempotent { funding_account: payer, account: inbox_usdc, wallet: inbox_acc, mint: usdc_mint, system_program: system_p, token_program: token_p }.invoke()
}

/// Permissionless: moves what a persistent deposit address delivered to the
/// owner's inbox into the vault and mints the owner's shares. The keeper gets
/// `min(sweep_fee, 1%)` for the transaction it pays for.
///
/// `[keeper, keeper_usdc, vault, usdc_mint, inbox, inbox_usdc, owner, owner_shares, idle, share_mint, token, ata, system, <4 nav>]`
pub fn sweep_inbox(accounts: &mut [AccountView], _data: &[u8]) -> ProgramResult {
    let (fixed, navs) = accounts.split_at_mut(accounts.len().min(13));
    let [keeper, keeper_usdc, vault_acc, usdc_mint, inbox_acc, inbox_usdc, owner, owner_shares, idle, share_mint, token_p, ata_p, system_p] = fixed else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    signer(keeper)?;
    key_is(token_p, &TOKEN_PROGRAM)?;
    key_is(ata_p, &ATA_PROGRAM)?;
    key_is(system_p, &SYSTEM_PROGRAM)?;
    let mut v = Vault::load(vault_acc)?;
    key_is(usdc_mint, &v.usdc_mint)?;
    key_is(idle, &v.idle)?;
    key_is(share_mint, &v.share_mint)?;
    let mut inbox = Inbox::load(inbox_acc)?;
    require(&inbox.vault == vault_acc.address() && &inbox.owner == owner.address(), LandfallError::InvalidAccount)?;
    require(inbox_acc.address() == &derive(&[INBOX_SEED, inbox.vault.as_ref(), inbox.owner.as_ref()], inbox.bump), LandfallError::InvalidAccount)?;
    let balance = token_of(inbox_usdc, &v.usdc_mint, inbox_acc.address())?.amount;
    require(balance > 0 && balance >= v.min_sweep, LandfallError::BelowMinSweep)?;
    token_of_mint(keeper_usdc, &v.usdc_mint)?;

    let idle_amount = token_of(idle, &v.usdc_mint, vault_acc.address())?.amount;
    let nav_before = nav::compute(&v, idle_amount, navs, false)?;
    // vault in maintenance: the deposit waits in the owner's inbox
    require(!nav_before.written_off, LandfallError::VaultInMaintenance)?;

    // the owner's share account (keeper pays its rent if missing)
    CreateIdempotent { funding_account: keeper, account: owner_shares, wallet: owner, mint: share_mint, system_program: system_p, token_program: token_p }.invoke()?;

    let fee = v.sweep_fee.min(balance / 100);
    let net = balance - fee;
    let decimals = read_mint(usdc_mint)?.decimals;
    token::with_inbox_signer(&inbox, |s| -> ProgramResult {
        token::transfer(inbox_usdc, usdc_mint, keeper_usdc, inbox_acc, fee, decimals, s)?;
        token::transfer(inbox_usdc, usdc_mint, idle, inbox_acc, net, decimals, s)
    })?;
    let shares = mint_landing_shares(&v, share_mint, owner_shares, vault_acc, net, &nav_before)?;

    inbox.swept_total = inbox.swept_total.saturating_add(net);
    inbox.sweep_count = inbox.sweep_count.saturating_add(1);
    inbox.store(inbox_acc)?;
    v.landed_total = v.landed_total.saturating_add(net);
    v.landed_count = v.landed_count.saturating_add(1);
    v.store(vault_acc)?;
    landed_event(vault_acc, owner, inbox_acc, SOURCE_INBOX, net, shares, &nav_before);
    Ok(())
}
