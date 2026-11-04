//! Kamino Lending (klend) reserve: read-only valuation + CPI builders.
//!
//! Offsets are into the raw account data (8-byte discriminator included) of a
//! `Reserve` account and were verified against the mainnet USDC reserve
//! `D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59` (lending market at 32,
//! liquidity mint at 128, supply vault at 160, token program at 408,
//! collateral mint at 2560, deposit limit = 1e15 at 5016).

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};

use crate::constants::KAMINO_LENDING_PROGRAM;

pub const RESERVE_MIN_LEN: usize = 5032;
const OFF_LENDING_MARKET: usize = 32;
const OFF_LIQ_MINT: usize = 128;
const OFF_LIQ_AVAILABLE: usize = 224;
const OFF_LIQ_BORROWED_SF: usize = 232;
const OFF_PROTOCOL_FEES_SF: usize = 344;
const OFF_REFERRER_FEES_SF: usize = 360;
const OFF_PENDING_REFERRER_FEES_SF: usize = 376;
const OFF_COLL_MINT: usize = 2560;
const OFF_COLL_SUPPLY: usize = 2592;
const OFF_CONFIG_STATUS: usize = 4856;
const OFF_DEPOSIT_LIMIT: usize = 5016;
const SF_SHIFT: u32 = 60;

pub const IX_REFRESH_RESERVE: [u8; 8] = [0x02, 0xda, 0x8a, 0xeb, 0x4f, 0xc9, 0x19, 0x66];
pub const IX_DEPOSIT_RESERVE_LIQUIDITY: [u8; 8] = [0xa9, 0xc9, 0x1e, 0x7e, 0x06, 0xcd, 0x66, 0x44];
pub const IX_REDEEM_RESERVE_COLLATERAL: [u8; 8] = [0xea, 0x75, 0xb5, 0x7d, 0xb9, 0x8e, 0xdc, 0x1d];

fn u64_at(d: &[u8], o: usize) -> u64 {
    u64::from_le_bytes(d[o..o + 8].try_into().unwrap())
}
fn u128_at(d: &[u8], o: usize) -> u128 {
    u128::from_le_bytes(d[o..o + 16].try_into().unwrap())
}
fn key_at(d: &[u8], o: usize) -> Pubkey {
    Pubkey::new_from_array(d[o..o + 32].try_into().unwrap())
}

/// Parsed view of the fields the vault needs.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ReserveView {
    pub lending_market: Pubkey,
    pub liquidity_mint: Pubkey,
    pub collateral_mint: Pubkey,
    /// Total liquidity owned by depositors (available + borrowed − fees), in liquidity base units.
    pub total_liquidity: u128,
    pub collateral_supply: u128,
    pub status: u8,
    pub deposit_limit: u64,
}

impl ReserveView {
    pub fn parse(info: &AccountInfo) -> Option<Self> {
        if info.owner != &KAMINO_LENDING_PROGRAM {
            return None;
        }
        let data = info.try_borrow_data().ok()?;
        Self::parse_data(&data)
    }

    pub fn parse_data(d: &[u8]) -> Option<Self> {
        if d.len() < RESERVE_MIN_LEN {
            return None;
        }
        let available = (u64_at(d, OFF_LIQ_AVAILABLE) as u128).checked_shl(SF_SHIFT)?;
        let total_sf = available
            .checked_add(u128_at(d, OFF_LIQ_BORROWED_SF))?
            .checked_sub(u128_at(d, OFF_PROTOCOL_FEES_SF))?
            .checked_sub(u128_at(d, OFF_REFERRER_FEES_SF))?
            .checked_sub(u128_at(d, OFF_PENDING_REFERRER_FEES_SF))?;
        Some(Self {
            lending_market: key_at(d, OFF_LENDING_MARKET),
            liquidity_mint: key_at(d, OFF_LIQ_MINT),
            collateral_mint: key_at(d, OFF_COLL_MINT),
            total_liquidity: total_sf >> SF_SHIFT,
            collateral_supply: u64_at(d, OFF_COLL_SUPPLY) as u128,
            status: d[OFF_CONFIG_STATUS],
            deposit_limit: u64_at(d, OFF_DEPOSIT_LIMIT),
        })
    }

    /// Liquidity value of `collateral` cTokens, rounded down.
    pub fn liquidity_for_collateral(&self, collateral: u64) -> Option<u64> {
        if self.collateral_supply == 0 {
            return Some(collateral);
        }
        let v = (collateral as u128).checked_mul(self.total_liquidity)? / self.collateral_supply;
        u64::try_from(v).ok()
    }

    /// cTokens to burn so that at least `liquidity` comes back, rounded up.
    pub fn collateral_for_liquidity_ceil(&self, liquidity: u64) -> Option<u64> {
        if self.total_liquidity == 0 {
            return None;
        }
        let v = (liquidity as u128)
            .checked_mul(self.collateral_supply)?
            .div_ceil(self.total_liquidity);
        u64::try_from(v).ok()
    }

    /// How much more liquidity the reserve accepts before its deposit limit.
    pub fn deposit_room(&self) -> u64 {
        let used = u64::try_from(self.total_liquidity).unwrap_or(u64::MAX);
        self.deposit_limit.saturating_sub(used)
    }

    pub fn is_active(&self) -> bool {
        self.status == 0
    }
}

pub struct KaminoAccounts<'a, 'info> {
    pub owner: &'a AccountInfo<'info>,
    pub reserve: &'a AccountInfo<'info>,
    pub lending_market: &'a AccountInfo<'info>,
    pub lending_market_authority: &'a AccountInfo<'info>,
    pub liquidity_mint: &'a AccountInfo<'info>,
    pub liquidity_supply: &'a AccountInfo<'info>,
    pub collateral_mint: &'a AccountInfo<'info>,
    pub liquidity_account: &'a AccountInfo<'info>,
    pub collateral_account: &'a AccountInfo<'info>,
    pub token_program: &'a AccountInfo<'info>,
    pub instructions_sysvar: &'a AccountInfo<'info>,
}

impl<'a, 'info> KaminoAccounts<'a, 'info> {
    fn infos(&self) -> Vec<AccountInfo<'info>> {
        vec![
            self.owner.clone(),
            self.reserve.clone(),
            self.lending_market.clone(),
            self.lending_market_authority.clone(),
            self.liquidity_mint.clone(),
            self.liquidity_supply.clone(),
            self.collateral_mint.clone(),
            self.liquidity_account.clone(),
            self.collateral_account.clone(),
            self.token_program.clone(),
            self.instructions_sysvar.clone(),
        ]
    }

    /// `deposit_reserve_liquidity(liquidity_amount)` signed by the vault PDA.
    pub fn deposit(&self, amount: u64, signer: &[&[&[u8]]]) -> Result<()> {
        let mut data = IX_DEPOSIT_RESERVE_LIQUIDITY.to_vec();
        data.extend_from_slice(&amount.to_le_bytes());
        let ix = Instruction {
            program_id: KAMINO_LENDING_PROGRAM,
            accounts: vec![
                AccountMeta::new_readonly(self.owner.key(), true),
                AccountMeta::new(self.reserve.key(), false),
                AccountMeta::new_readonly(self.lending_market.key(), false),
                AccountMeta::new_readonly(self.lending_market_authority.key(), false),
                AccountMeta::new_readonly(self.liquidity_mint.key(), false),
                AccountMeta::new(self.liquidity_supply.key(), false),
                AccountMeta::new(self.collateral_mint.key(), false),
                AccountMeta::new(self.liquidity_account.key(), false),
                AccountMeta::new(self.collateral_account.key(), false),
                AccountMeta::new_readonly(self.token_program.key(), false),
                AccountMeta::new_readonly(self.token_program.key(), false),
                AccountMeta::new_readonly(self.instructions_sysvar.key(), false),
            ],
            data,
        };
        anchor_lang::solana_program::program::invoke_signed(&ix, &self.infos(), signer)?;
        Ok(())
    }

    /// `redeem_reserve_collateral(collateral_amount)` signed by the vault PDA.
    pub fn redeem(&self, collateral: u64, signer: &[&[&[u8]]]) -> Result<()> {
        let mut data = IX_REDEEM_RESERVE_COLLATERAL.to_vec();
        data.extend_from_slice(&collateral.to_le_bytes());
        let ix = Instruction {
            program_id: KAMINO_LENDING_PROGRAM,
            accounts: vec![
                AccountMeta::new_readonly(self.owner.key(), true),
                AccountMeta::new_readonly(self.lending_market.key(), false),
                AccountMeta::new(self.reserve.key(), false),
                AccountMeta::new_readonly(self.lending_market_authority.key(), false),
                AccountMeta::new_readonly(self.liquidity_mint.key(), false),
                AccountMeta::new(self.collateral_mint.key(), false),
                AccountMeta::new(self.liquidity_supply.key(), false),
                AccountMeta::new(self.collateral_account.key(), false),
                AccountMeta::new(self.liquidity_account.key(), false),
                AccountMeta::new_readonly(self.token_program.key(), false),
                AccountMeta::new_readonly(self.token_program.key(), false),
                AccountMeta::new_readonly(self.instructions_sysvar.key(), false),
            ],
            data,
        };
        anchor_lang::solana_program::program::invoke_signed(&ix, &self.infos(), signer)?;
        Ok(())
    }
}
