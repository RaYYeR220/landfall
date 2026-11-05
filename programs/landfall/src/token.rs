//! Thin wrappers over SPL Token CPIs and the vault / inbox signer seeds.

use pinocchio::cpi::{Seed, Signer};
use pinocchio::{AccountView, ProgramResult};
use pinocchio_token::instructions::{Burn, MintTo, TransferChecked};

use crate::constants::{INBOX_SEED, VAULT_SEED};
use crate::state::{Inbox, Vault};

pub fn transfer(from: &AccountView, mint: &AccountView, to: &AccountView, authority: &AccountView, amount: u64, decimals: u8, signers: &[Signer]) -> ProgramResult {
    if amount == 0 {
        return Ok(());
    }
    TransferChecked::new(from, mint, to, authority, amount, decimals).invoke_signed(signers)
}

pub fn mint_to(mint: &AccountView, to: &AccountView, authority: &AccountView, amount: u64, signers: &[Signer]) -> ProgramResult {
    if amount == 0 {
        return Ok(());
    }
    MintTo::new(mint, to, authority, amount).invoke_signed(signers)
}

pub fn burn(account: &AccountView, mint: &AccountView, authority: &AccountView, amount: u64) -> ProgramResult {
    Burn::new(account, mint, authority, amount).invoke()
}

/// Calls `f` with the vault PDA signer.
pub fn with_vault_signer<R>(v: &Vault, f: impl FnOnce(&[Signer]) -> R) -> R {
    let bump = [v.bump];
    let seeds = [Seed::from(VAULT_SEED), Seed::from(v.usdc_mint.as_ref()), Seed::from(&bump)];
    let signers = [Signer::from(&seeds)];
    f(&signers)
}

/// Calls `f` with the inbox PDA signer.
pub fn with_inbox_signer<R>(i: &Inbox, f: impl FnOnce(&[Signer]) -> R) -> R {
    let bump = [i.bump];
    let seeds = [Seed::from(INBOX_SEED), Seed::from(i.vault.as_ref()), Seed::from(i.owner.as_ref()), Seed::from(&bump)];
    let signers = [Signer::from(&seeds)];
    f(&signers)
}
