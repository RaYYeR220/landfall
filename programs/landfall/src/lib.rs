//! Landfall: deposit addresses that execute on Solana.
//!
//! Funds sent from any chain (through Aurora Intents persistent deposit
//! addresses or an Intents Connect bridge-in) land as shares of one curated
//! USDC vault that supplies Kamino and Jupiter Lend.

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod math;
pub mod nav;
pub mod state;
pub mod strategies;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("12pHvK6FYFHP748kom4F3AbKcymKGVN2r9n1GtX3zdyZ");

#[program]
pub mod landfall {
    use super::*;

    pub fn init_vault(ctx: Context<InitVault>, params: InitVaultParams) -> Result<()> {
        instructions::init_vault::handler(ctx, params)
    }

    pub fn set_curator(ctx: Context<AdminOnly>, curator: Pubkey) -> Result<()> {
        instructions::admin::set_curator(ctx, curator)
    }

    pub fn set_strategy_enabled(ctx: Context<AdminOnly>, strategy: u8, enabled: bool) -> Result<()> {
        instructions::admin::set_strategy_enabled(ctx, strategy, enabled)
    }

    pub fn set_params(ctx: Context<CuratorOnly>, idle_buffer_bps: u16, sweep_fee: u64, min_sweep: u64) -> Result<()> {
        instructions::admin::set_params(ctx, idle_buffer_bps, sweep_fee, min_sweep)
    }

    pub fn set_paused(ctx: Context<CuratorOnly>, paused: bool) -> Result<()> {
        instructions::admin::set_paused(ctx, paused)
    }

    pub fn set_weights(ctx: Context<CuratorOnly>, kamino_bps: u16, jlend_bps: u16, kamino_cap: u64, jlend_cap: u64) -> Result<()> {
        instructions::admin::set_weights(ctx, kamino_bps, jlend_bps, kamino_cap, jlend_cap)
    }

    pub fn configure_kamino(ctx: Context<ConfigureKamino>, enabled: bool) -> Result<()> {
        instructions::admin::configure_kamino(ctx, enabled)
    }

    pub fn configure_jlend(ctx: Context<ConfigureJlend>, enabled: bool) -> Result<()> {
        instructions::admin::configure_jlend(ctx, enabled)
    }

    pub fn open_inbox(ctx: Context<OpenInbox>) -> Result<()> {
        instructions::open_inbox::handler(ctx)
    }

    pub fn deposit<'info>(ctx: Context<'info, Deposit<'info>>, amount: u64) -> Result<()> {
        instructions::deposit::handler(ctx, amount)
    }

    pub fn sweep_inbox<'info>(ctx: Context<'info, SweepInbox<'info>>) -> Result<()> {
        instructions::sweep_inbox::handler(ctx)
    }

    pub fn allocate_kamino(ctx: Context<AllocateKamino>, amount: u64) -> Result<()> {
        instructions::allocate::allocate_kamino(ctx, amount)
    }

    pub fn allocate_jlend(ctx: Context<AllocateJlend>, amount: u64) -> Result<()> {
        instructions::allocate::allocate_jlend(ctx, amount)
    }

    pub fn deallocate_kamino(ctx: Context<DeallocateKamino>, collateral: u64) -> Result<()> {
        instructions::allocate::deallocate_kamino(ctx, collateral)
    }

    pub fn deallocate_jlend(ctx: Context<DeallocateJlend>, assets: u64) -> Result<()> {
        instructions::allocate::deallocate_jlend(ctx, assets)
    }

    pub fn sync_nav(ctx: Context<SyncNav>) -> Result<()> {
        instructions::sync_nav::handler(ctx)
    }

    pub fn redeem(ctx: Context<Redeem>, shares: u64, min_out: u64) -> Result<()> {
        instructions::redeem::redeem(ctx, shares, min_out)
    }

    pub fn redeem_via_kamino(ctx: Context<RedeemViaKamino>, shares: u64, min_out: u64) -> Result<()> {
        instructions::redeem::redeem_via_kamino(ctx, shares, min_out)
    }

    pub fn redeem_via_jlend(ctx: Context<RedeemViaJlend>, shares: u64, min_out: u64) -> Result<()> {
        instructions::redeem::redeem_via_jlend(ctx, shares, min_out)
    }
}
