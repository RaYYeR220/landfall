use anchor_lang::prelude::*;

/// Kamino lending reserve the vault supplies USDC to.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, Debug, PartialEq)]
pub struct KaminoStrategy {
    pub enabled: bool,
    pub reserve: Pubkey,
    pub market: Pubkey,
    pub collateral_mint: Pubkey,
    /// Vault-owned token account holding the reserve's collateral (cUSDC).
    pub collateral_account: Pubkey,
    pub weight_bps: u16,
    /// Max USDC value the curator allows in this strategy.
    pub cap: u64,
    /// USDC value at the last `sync_nav` / allocation. Used only when live
    /// valuation is unavailable during a landing.
    pub cached_value: u64,
    pub cached_slot: u64,
}

/// Jupiter Lend Earn market (fToken) the vault supplies USDC to.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, InitSpace, Debug, PartialEq)]
pub struct JlendStrategy {
    pub enabled: bool,
    pub lending: Pubkey,
    pub ftoken_mint: Pubkey,
    /// Vault-owned token account holding fTokens.
    pub ftoken_account: Pubkey,
    pub weight_bps: u16,
    pub cap: u64,
    pub cached_value: u64,
    pub cached_slot: u64,
}

#[account]
#[derive(InitSpace, Debug)]
pub struct Vault {
    pub admin: Pubkey,
    pub curator: Pubkey,
    pub usdc_mint: Pubkey,
    pub share_mint: Pubkey,
    /// Vault-owned USDC account (ATA of the vault PDA).
    pub idle: Pubkey,
    pub kamino: KaminoStrategy,
    pub jlend: JlendStrategy,
    /// Share of NAV kept liquid in `idle` (never allocated).
    pub idle_buffer_bps: u16,
    /// Max keeper fee per sweep, USDC base units (capped at 1% of the sweep).
    pub sweep_fee: u64,
    /// Minimum inbox balance a sweep moves.
    pub min_sweep: u64,
    /// Blocks allocations only. Landings and redemptions always work.
    pub paused: bool,
    pub landed_total: u64,
    pub landed_count: u64,
    pub redeemed_total: u64,
    pub bump: u8,
    pub share_mint_bump: u8,
}

/// Per-owner landing account. Its USDC token account is the recipient of the
/// owner's persistent deposit addresses on every chain.
#[account]
#[derive(InitSpace, Debug)]
pub struct Inbox {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub swept_total: u64,
    pub sweep_count: u64,
    pub created_slot: u64,
    pub bump: u8,
}
