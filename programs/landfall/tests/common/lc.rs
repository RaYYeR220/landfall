#![allow(dead_code)]
//! Landfall client for the tests: Anchor-style instruction / account
//! builders for the program's wire format. `client_vectors.rs` checks every
//! builder against the frozen interface in `packages/sdk/test/vectors.json`
//! (shared with the TypeScript SDK).

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::AccountMeta;
use anchor_lang::{Discriminator, InstructionData, ToAccountMetas};

pub fn id() -> Pubkey {
    pubkey!("12pHvK6FYFHP748kom4F3AbKcymKGVN2r9n1GtX3zdyZ")
}
pub use landfall::{INBOX_SEED, SHARES_SEED, VAULT_SEED};
pub const INSTRUCTIONS_SYSVAR: Pubkey = pubkey!("Sysvar1nstructions1111111111111111111111111");
pub const BPF_UPGRADEABLE_LOADER: Pubkey = pubkey!("BPFLoaderUpgradeab1e11111111111111111111111");

pub fn pk(a: &solana_address::Address) -> Pubkey {
    Pubkey::new_from_array(a.to_bytes())
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitVaultParams {
    pub curator: Pubkey,
    pub idle_buffer_bps: u16,
    pub sweep_fee: u64,
    pub min_sweep: u64,
    pub seed_amount: u64,
}

macro_rules! ix_data {
    ($name:ident, $disc:expr, { $($f:ident : $t:ty),* $(,)? }) => {
        #[derive(AnchorSerialize, Clone, Debug)]
        pub struct $name { $(pub $f: $t),* }
        impl Discriminator for $name { const DISCRIMINATOR: &'static [u8] = &$disc; }
        impl InstructionData for $name {}
    };
}

pub mod instruction {
    use super::*;
    ix_data!(InitVault, landfall::IX_INIT_VAULT, { params: InitVaultParams });
    ix_data!(SetCurator, landfall::IX_SET_CURATOR, { curator: Pubkey });
    ix_data!(SetParams, landfall::IX_SET_PARAMS, { idle_buffer_bps: u16, sweep_fee: u64, min_sweep: u64 });
    ix_data!(SetPaused, landfall::IX_SET_PAUSED, { paused: bool });
    ix_data!(SetWeights, landfall::IX_SET_WEIGHTS, { kamino_bps: u16, jlend_bps: u16, kamino_cap: u64, jlend_cap: u64 });
    ix_data!(SetStrategyEnabled, landfall::IX_SET_STRATEGY_ENABLED, { strategy: u8, enabled: bool });
    ix_data!(ConfigureKamino, landfall::IX_CONFIGURE_KAMINO, { enabled: bool });
    ix_data!(ConfigureJlend, landfall::IX_CONFIGURE_JLEND, { enabled: bool });
    ix_data!(OpenInbox, landfall::IX_OPEN_INBOX, {});
    ix_data!(Deposit, landfall::IX_DEPOSIT, { amount: u64 });
    ix_data!(SweepInbox, landfall::IX_SWEEP_INBOX, {});
    ix_data!(AllocateKamino, landfall::IX_ALLOCATE_KAMINO, { amount: u64 });
    ix_data!(AllocateJlend, landfall::IX_ALLOCATE_JLEND, { amount: u64 });
    ix_data!(DeallocateKamino, landfall::IX_DEALLOCATE_KAMINO, { collateral: u64 });
    ix_data!(DeallocateJlend, landfall::IX_DEALLOCATE_JLEND, { assets: u64 });
    ix_data!(SyncNav, landfall::IX_SYNC_NAV, {});
    ix_data!(Redeem, landfall::IX_REDEEM, { shares: u64, min_out: u64 });
    ix_data!(RedeemViaKamino, landfall::IX_REDEEM_VIA_KAMINO, { shares: u64, min_out: u64 });
    ix_data!(RedeemViaJlend, landfall::IX_REDEEM_VIA_JLEND, { shares: u64, min_out: u64 });
}

/// `(name, signer, writable)` lists, in program order.
macro_rules! accounts {
    ($name:ident { $($f:ident : $s:literal $w:literal),* $(,)? }) => {
        #[derive(Clone, Debug)]
        pub struct $name { $(pub $f: Pubkey),* }
        impl ToAccountMetas for $name {
            fn to_account_metas(&self, _: Option<bool>) -> Vec<AccountMeta> {
                vec![$(AccountMeta { pubkey: self.$f, is_signer: $s, is_writable: $w }),*]
            }
        }
    };
}

pub mod accounts {
    use super::*;
    accounts!(InitVault { admin: true true, usdc_mint: false false, vault: false true, share_mint: false true, idle: false true, dead_shares: false true, admin_usdc: false true, program_data: false false, token_program: false false, associated_token_program: false false, system_program: false false });
    accounts!(AdminOnly { admin: true false, vault: false true });
    accounts!(CuratorOnly { curator: true false, vault: false true });
    accounts!(ConfigureKamino { admin: true true, vault: false true, usdc_mint: false false, reserve: false false, collateral_mint: false false, collateral_account: false true, token_program: false false, associated_token_program: false false, system_program: false false });
    accounts!(ConfigureJlend { admin: true true, vault: false true, usdc_mint: false false, lending: false false, ftoken_mint: false false, ftoken_account: false true, token_program: false false, associated_token_program: false false, system_program: false false });
    accounts!(OpenInbox { payer: true true, vault: false false, usdc_mint: false false, owner: false false, inbox: false true, inbox_usdc: false true, token_program: false false, associated_token_program: false false, system_program: false false });
    accounts!(Deposit { depositor: true false, depositor_usdc: false true, owner: false false, owner_shares: false true, vault: false true, usdc_mint: false false, idle: false true, share_mint: false true, token_program: false false });
    accounts!(SweepInbox { keeper: true true, keeper_usdc: false true, vault: false true, usdc_mint: false false, inbox: false true, inbox_usdc: false true, owner: false false, owner_shares: false true, idle: false true, share_mint: false true, token_program: false false, associated_token_program: false false, system_program: false false });
    accounts!(KaminoCpi { reserve: false true, collateral_account: false true, lending_market: false false, lending_market_authority: false false, reserve_liquidity_supply: false true, collateral_mint: false true, instructions_sysvar: false false, kamino_program: false false });
    accounts!(JlendCpi { lending: false true, ftoken_account: false true, ftoken_mint: false true, lending_admin: false false, supply_token_reserves_liquidity: false true, lending_supply_position_on_liquidity: false true, rate_model: false false, liquidity_vault: false true, claim_account: false true, liquidity: false true, liquidity_program: false false, rewards_rate_model: false false, jlend_program: false false, associated_token_program: false false, system_program: false false });
    accounts!(SyncNav { vault: false true, idle: false false, kamino_reserve: false false, kamino_collateral: false false, jlend_lending: false false, jlend_ftoken: false false });
    accounts!(RedeemBase { owner: true false, owner_shares: false true, destination: false true, vault: false true, usdc_mint: false false, idle: false true, share_mint: false true, kamino_reserve: false false, kamino_collateral: false false, jlend_lending: false false, jlend_ftoken: false false, token_program: false false });

    #[derive(Clone, Debug)]
    pub struct AllocateKamino { pub keeper: Pubkey, pub vault: Pubkey, pub usdc_mint: Pubkey, pub idle: Pubkey, pub kamino: KaminoCpi, pub jlend_lending: Pubkey, pub jlend_ftoken: Pubkey, pub token_program: Pubkey }
    impl ToAccountMetas for AllocateKamino {
        fn to_account_metas(&self, s: Option<bool>) -> Vec<AccountMeta> {
            let mut m = vec![AccountMeta::new_readonly(self.keeper, true), AccountMeta::new(self.vault, false), AccountMeta::new_readonly(self.usdc_mint, false), AccountMeta::new(self.idle, false)];
            m.extend(self.kamino.to_account_metas(s));
            m.extend([AccountMeta::new_readonly(self.jlend_lending, false), AccountMeta::new_readonly(self.jlend_ftoken, false), AccountMeta::new_readonly(self.token_program, false)]);
            m
        }
    }
    #[derive(Clone, Debug)]
    pub struct AllocateJlend { pub keeper: Pubkey, pub vault: Pubkey, pub usdc_mint: Pubkey, pub idle: Pubkey, pub jlend: JlendCpi, pub kamino_reserve: Pubkey, pub kamino_collateral: Pubkey, pub token_program: Pubkey }
    impl ToAccountMetas for AllocateJlend {
        fn to_account_metas(&self, s: Option<bool>) -> Vec<AccountMeta> {
            let mut m = vec![AccountMeta::new_readonly(self.keeper, true), AccountMeta::new(self.vault, false), AccountMeta::new_readonly(self.usdc_mint, false), AccountMeta::new(self.idle, false)];
            m.extend(self.jlend.to_account_metas(s));
            m.extend([AccountMeta::new_readonly(self.kamino_reserve, false), AccountMeta::new_readonly(self.kamino_collateral, false), AccountMeta::new_readonly(self.token_program, false)]);
            m
        }
    }
    #[derive(Clone, Debug)]
    pub struct Redeem { pub base: RedeemBase }
    impl ToAccountMetas for Redeem {
        fn to_account_metas(&self, s: Option<bool>) -> Vec<AccountMeta> { self.base.to_account_metas(s) }
    }
    #[derive(Clone, Debug)]
    pub struct RedeemViaKamino { pub base: RedeemBase, pub kamino: KaminoCpi }
    impl ToAccountMetas for RedeemViaKamino {
        fn to_account_metas(&self, s: Option<bool>) -> Vec<AccountMeta> {
            let mut m = self.base.to_account_metas(s);
            m.extend(self.kamino.to_account_metas(s));
            m
        }
    }
    #[derive(Clone, Debug)]
    pub struct RedeemViaJlend { pub base: RedeemBase, pub jlend: JlendCpi }
    impl ToAccountMetas for RedeemViaJlend {
        fn to_account_metas(&self, s: Option<bool>) -> Vec<AccountMeta> {
            let mut m = self.base.to_account_metas(s);
            m.extend(self.jlend.to_account_metas(s));
            m
        }
    }
}

pub mod state {
    use super::*;

    #[derive(Clone, Copy, Debug)]
    pub struct Strategy {
        pub enabled: bool,
        pub weight_bps: u16,
        pub cap: u64,
        pub cached_value: u64,
        pub cached_slot: u64,
        pub reserve: Pubkey,
        pub collateral_account: Pubkey,
        pub lending: Pubkey,
        pub ftoken_account: Pubkey,
    }

    #[derive(Clone, Copy, Debug)]
    pub struct Vault {
        pub admin: Pubkey,
        pub curator: Pubkey,
        pub kamino: Strategy,
        pub jlend: Strategy,
        pub paused: bool,
        pub landed_total: u64,
        pub landed_count: u64,
        pub redeemed_total: u64,
    }

    impl Vault {
        pub fn try_deserialize(d: &mut &[u8]) -> Result<Self> {
            let v = landfall::state::Vault::decode(d).map_err(|_| error!(anchor_lang::error::ErrorCode::AccountDidNotDeserialize))?;
            let k = v.kamino;
            let j = v.jlend;
            Ok(Self {
                admin: pk(&v.admin),
                curator: pk(&v.curator),
                kamino: Strategy { enabled: k.enabled, weight_bps: k.weight_bps, cap: k.cap, cached_value: k.cached_value, cached_slot: k.cached_slot, reserve: pk(&k.reserve), collateral_account: pk(&k.collateral_account), lending: Pubkey::default(), ftoken_account: Pubkey::default() },
                jlend: Strategy { enabled: j.enabled, weight_bps: j.weight_bps, cap: j.cap, cached_value: j.cached_value, cached_slot: j.cached_slot, reserve: Pubkey::default(), collateral_account: Pubkey::default(), lending: pk(&j.lending), ftoken_account: pk(&j.ftoken_account) },
                paused: v.paused,
                landed_total: v.landed_total,
                landed_count: v.landed_count,
                redeemed_total: v.redeemed_total,
            })
        }
    }

    #[derive(Clone, Copy, Debug)]
    pub struct Inbox {
        pub vault: Pubkey,
        pub owner: Pubkey,
        pub swept_total: u64,
        pub sweep_count: u64,
    }

    impl Inbox {
        pub fn try_deserialize(d: &mut &[u8]) -> Result<Self> {
            let i = landfall::state::Inbox::decode(d).map_err(|_| error!(anchor_lang::error::ErrorCode::AccountDidNotDeserialize))?;
            Ok(Self { vault: pk(&i.vault), owner: pk(&i.owner), swept_total: i.swept_total, sweep_count: i.sweep_count })
        }
    }
}

pub mod strategies {
    pub mod kamino {
        use super::super::pk;
        use anchor_lang::prelude::Pubkey;
        pub use landfall::strategies::kamino::{IX_DEPOSIT_RESERVE_LIQUIDITY, IX_REFRESH_RESERVE};

        #[derive(Clone, Copy, Debug)]
        pub struct ReserveView {
            pub lending_market: Pubkey,
            pub liquidity_mint: Pubkey,
            pub collateral_mint: Pubkey,
            pub total_liquidity: u128,
            pub collateral_supply: u128,
            pub deposit_limit: u64,
            inner: landfall::strategies::kamino::ReserveView,
        }
        impl ReserveView {
            pub fn parse_data(d: &[u8]) -> Option<Self> {
                let v = landfall::strategies::kamino::ReserveView::parse_data(d)?;
                Some(Self {
                    lending_market: pk(&v.lending_market),
                    liquidity_mint: pk(&v.liquidity_mint),
                    collateral_mint: pk(&v.collateral_mint),
                    total_liquidity: v.total_liquidity,
                    collateral_supply: v.collateral_supply,
                    deposit_limit: v.deposit_limit,
                    inner: v,
                })
            }
            pub fn is_active(&self) -> bool {
                self.inner.is_active()
            }
            pub fn liquidity_for_collateral(&self, c: u64) -> Option<u64> {
                self.inner.liquidity_for_collateral(c)
            }
        }
    }
    pub mod jlend {
        use super::super::pk;
        use anchor_lang::prelude::Pubkey;
        pub use landfall::strategies::jlend::EXCHANGE_PRICE_PRECISION;

        #[derive(Clone, Copy, Debug)]
        pub struct LendingView {
            pub mint: Pubkey,
            pub ftoken_mint: Pubkey,
            pub token_exchange_price: u64,
            inner: landfall::strategies::jlend::LendingView,
        }
        impl LendingView {
            pub fn parse_data(d: &[u8]) -> Option<Self> {
                let v = landfall::strategies::jlend::LendingView::parse_data(d)?;
                Some(Self { mint: pk(&v.mint), ftoken_mint: pk(&v.ftoken_mint), token_exchange_price: v.token_exchange_price, inner: v })
            }
            pub fn assets_for_shares(&self, s: u64) -> Option<u64> {
                self.inner.assets_for_shares(s)
            }
        }
    }
}
