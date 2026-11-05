//! Landfall: deposit addresses that execute on Solana.
//!
//! Funds sent from any chain (Aurora Intents persistent deposit addresses or
//! an Intents Connect bridge-in) land as shares of one curated USDC vault that
//! supplies Kamino and Jupiter Lend.
//!
//! Written with Pinocchio. The wire format (instruction discriminators,
//! argument encoding, account order, account layouts and events) is
//! Anchor-compatible, so standard Anchor-style clients can talk to it.

#![cfg_attr(not(test), no_std)]

pub mod constants;
pub mod error;
pub mod ix;
pub mod math;
pub mod nav;
pub mod state;
pub mod strategies;
pub mod token;
pub mod util;

pub use constants::*;

use pinocchio::{AccountView, Address, ProgramResult};

use crate::error::LandfallError;

#[cfg(not(feature = "no-entrypoint"))]
mod entry {
    pinocchio::program_entrypoint!(crate::process_instruction);
    pinocchio::default_allocator!();
    pinocchio::nostd_panic_handler!();
}

#[inline(never)]
pub fn process_instruction(program_id: &Address, accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    if program_id != &ID {
        return Err(pinocchio::error::ProgramError::IncorrectProgramId);
    }
    let (disc, args) = data.split_at_checked(8).ok_or(LandfallError::InvalidInstruction)?;
    let disc: [u8; 8] = disc.try_into().map_err(|_| LandfallError::InvalidInstruction)?;
    match disc {
        IX_DEPOSIT => ix::landing::deposit(accounts, args),
        IX_SWEEP_INBOX => ix::landing::sweep_inbox(accounts, args),
        IX_OPEN_INBOX => ix::landing::open_inbox(accounts, args),
        IX_ALLOCATE_KAMINO => ix::strategy::allocate_kamino(accounts, args),
        IX_ALLOCATE_JLEND => ix::strategy::allocate_jlend(accounts, args),
        IX_SYNC_NAV => ix::strategy::sync_nav(accounts, args),
        IX_REDEEM => ix::redeem::redeem(accounts, args),
        IX_REDEEM_VIA_KAMINO => ix::redeem::redeem_via_kamino(accounts, args),
        IX_REDEEM_VIA_JLEND => ix::redeem::redeem_via_jlend(accounts, args),
        IX_DEALLOCATE_KAMINO => ix::strategy::deallocate_kamino(accounts, args),
        IX_DEALLOCATE_JLEND => ix::strategy::deallocate_jlend(accounts, args),
        IX_INIT_VAULT => ix::admin::init_vault(accounts, args),
        IX_SET_CURATOR => ix::admin::set_curator(accounts, args),
        IX_SET_STRATEGY_ENABLED => ix::admin::set_strategy_enabled(accounts, args),
        IX_SET_PARAMS => ix::admin::set_params(accounts, args),
        IX_SET_PAUSED => ix::admin::set_paused(accounts, args),
        IX_SET_WEIGHTS => ix::admin::set_weights(accounts, args),
        IX_CONFIGURE_KAMINO => ix::admin::configure_kamino(accounts, args),
        IX_CONFIGURE_JLEND => ix::admin::configure_jlend(accounts, args),
        _ => Err(LandfallError::InvalidInstruction.into()),
    }
}
