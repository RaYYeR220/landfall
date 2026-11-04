use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum LandingSource {
    /// A wallet or an Intents Connect intermediary called `deposit`.
    Direct,
    /// A persistent deposit address paid the owner's inbox; swept by a keeper.
    Inbox,
}

#[event]
pub struct Landed {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub depositor: Pubkey,
    pub source: LandingSource,
    pub amount: u64,
    pub shares: u64,
    pub nav_before: u64,
    pub nav_live: bool,
}

/// A landing was left with the depositor because the vault is in maintenance.
#[event]
pub struct LandingDeferred {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub amount: u64,
}

#[event]
pub struct Allocated {
    pub vault: Pubkey,
    pub strategy: u8,
    pub amount: u64,
    pub strategy_value_after: u64,
}

#[event]
pub struct Deallocated {
    pub vault: Pubkey,
    pub strategy: u8,
    pub amount: u64,
}

#[event]
pub struct Redeemed {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub destination: Pubkey,
    pub shares: u64,
    pub amount: u64,
    pub source: u8,
}

#[event]
pub struct InboxOpened {
    pub vault: Pubkey,
    pub owner: Pubkey,
    pub inbox: Pubkey,
}
