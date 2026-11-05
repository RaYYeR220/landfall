//! Kamino Lending (klend) reserve: read-only valuation + CPI.
//!
//! Offsets are into the raw `Reserve` account data (discriminator included),
//! verified against the mainnet USDC reserve
//! `D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59` (lending market at 32,
//! liquidity mint at 128, supply vault at 160, token program at 408,
//! collateral mint at 2560, deposit limit = 1e15 at 5016).

use pinocchio::cpi::{invoke_signed, Signer};
use pinocchio::instruction::{InstructionAccount, InstructionView};
use pinocchio::{AccountView, Address, ProgramResult};

use crate::constants::KAMINO_LENDING_PROGRAM;

pub const RESERVE_MIN_LEN: usize = 5032;
/// `sha256("account:Reserve")[..8]`
pub const RESERVE_DISCRIMINATOR: [u8; 8] = [0x2b, 0xf2, 0xcc, 0xca, 0x1a, 0xf7, 0x3b, 0x7f];
pub const IX_REFRESH_RESERVE: [u8; 8] = [0x02, 0xda, 0x8a, 0xeb, 0x4f, 0xc9, 0x19, 0x66];
pub const IX_DEPOSIT_RESERVE_LIQUIDITY: [u8; 8] = [0xa9, 0xc9, 0x1e, 0x7e, 0x06, 0xcd, 0x66, 0x44];
pub const IX_REDEEM_RESERVE_COLLATERAL: [u8; 8] = [0xea, 0x75, 0xb5, 0x7d, 0xb9, 0x8e, 0xdc, 0x1d];
const SF_SHIFT: u32 = 60;

fn u64_at(d: &[u8], o: usize) -> u64 {
    u64::from_le_bytes(d[o..o + 8].try_into().unwrap_or_default())
}
fn u128_at(d: &[u8], o: usize) -> u128 {
    u128::from_le_bytes(d[o..o + 16].try_into().unwrap_or_default())
}
fn key_at(d: &[u8], o: usize) -> Address {
    Address::new_from_array(d[o..o + 32].try_into().unwrap_or_default())
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ReserveView {
    pub lending_market: Address,
    pub liquidity_mint: Address,
    pub collateral_mint: Address,
    /// Liquidity owned by depositors (available + borrowed − fees), base units.
    pub total_liquidity: u128,
    pub collateral_supply: u128,
    pub status: u8,
    pub deposit_limit: u64,
}

impl ReserveView {
    pub fn parse(acc: &AccountView) -> Option<Self> {
        if !acc.owned_by(&KAMINO_LENDING_PROGRAM) {
            return None;
        }
        let d = acc.try_borrow().ok()?;
        Self::parse_data(&d)
    }

    pub fn parse_data(d: &[u8]) -> Option<Self> {
        if d.len() < RESERVE_MIN_LEN || d[..8] != RESERVE_DISCRIMINATOR {
            return None;
        }
        let available = (u64_at(d, 224) as u128).checked_shl(SF_SHIFT)?;
        let total_sf = available
            .checked_add(u128_at(d, 232))?
            .checked_sub(u128_at(d, 344))?
            .checked_sub(u128_at(d, 360))?
            .checked_sub(u128_at(d, 376))?;
        Some(Self {
            lending_market: key_at(d, 32),
            liquidity_mint: key_at(d, 128),
            collateral_mint: key_at(d, 2560),
            total_liquidity: total_sf >> SF_SHIFT,
            collateral_supply: u64_at(d, 2592) as u128,
            status: d[4856],
            deposit_limit: u64_at(d, 5016),
        })
    }

    pub fn liquidity_for_collateral(&self, collateral: u64) -> Option<u64> {
        if self.collateral_supply == 0 {
            return Some(collateral);
        }
        u64::try_from((collateral as u128).checked_mul(self.total_liquidity)? / self.collateral_supply).ok()
    }

    pub fn collateral_for_liquidity_ceil(&self, liquidity: u64) -> Option<u64> {
        if self.total_liquidity == 0 {
            return None;
        }
        u64::try_from((liquidity as u128).checked_mul(self.collateral_supply)?.div_ceil(self.total_liquidity)).ok()
    }

    pub fn deposit_room(&self) -> u64 {
        self.deposit_limit.saturating_sub(u64::try_from(self.total_liquidity).unwrap_or(u64::MAX))
    }

    pub fn is_active(&self) -> bool {
        self.status == 0
    }
}

/// Accounts of `deposit_reserve_liquidity` / `redeem_reserve_collateral`.
pub struct KaminoCpi<'a> {
    pub owner: &'a AccountView,
    pub reserve: &'a AccountView,
    pub lending_market: &'a AccountView,
    pub lending_market_authority: &'a AccountView,
    pub liquidity_mint: &'a AccountView,
    pub liquidity_supply: &'a AccountView,
    pub collateral_mint: &'a AccountView,
    pub liquidity_account: &'a AccountView,
    pub collateral_account: &'a AccountView,
    pub token_program: &'a AccountView,
    pub instructions_sysvar: &'a AccountView,
}

impl KaminoCpi<'_> {
    pub fn deposit(&self, amount: u64, signer: &[Signer]) -> ProgramResult {
        let mut data = [0u8; 16];
        data[..8].copy_from_slice(&IX_DEPOSIT_RESERVE_LIQUIDITY);
        data[8..].copy_from_slice(&amount.to_le_bytes());
        let metas = [
            InstructionAccount::readonly_signer(self.owner.address()),
            InstructionAccount::writable(self.reserve.address()),
            InstructionAccount::readonly(self.lending_market.address()),
            InstructionAccount::readonly(self.lending_market_authority.address()),
            InstructionAccount::readonly(self.liquidity_mint.address()),
            InstructionAccount::writable(self.liquidity_supply.address()),
            InstructionAccount::writable(self.collateral_mint.address()),
            InstructionAccount::writable(self.liquidity_account.address()),
            InstructionAccount::writable(self.collateral_account.address()),
            InstructionAccount::readonly(self.token_program.address()),
            InstructionAccount::readonly(self.token_program.address()),
            InstructionAccount::readonly(self.instructions_sysvar.address()),
        ];
        let ix = InstructionView { program_id: &KAMINO_LENDING_PROGRAM, data: &data, accounts: &metas };
        invoke_signed(
            &ix,
            &[
                self.owner,
                self.reserve,
                self.lending_market,
                self.lending_market_authority,
                self.liquidity_mint,
                self.liquidity_supply,
                self.collateral_mint,
                self.liquidity_account,
                self.collateral_account,
                self.token_program,
                self.token_program,
                self.instructions_sysvar,
            ],
            signer,
        )
    }

    pub fn redeem(&self, collateral: u64, signer: &[Signer]) -> ProgramResult {
        let mut data = [0u8; 16];
        data[..8].copy_from_slice(&IX_REDEEM_RESERVE_COLLATERAL);
        data[8..].copy_from_slice(&collateral.to_le_bytes());
        let metas = [
            InstructionAccount::readonly_signer(self.owner.address()),
            InstructionAccount::readonly(self.lending_market.address()),
            InstructionAccount::writable(self.reserve.address()),
            InstructionAccount::readonly(self.lending_market_authority.address()),
            InstructionAccount::readonly(self.liquidity_mint.address()),
            InstructionAccount::writable(self.collateral_mint.address()),
            InstructionAccount::writable(self.liquidity_supply.address()),
            InstructionAccount::writable(self.collateral_account.address()),
            InstructionAccount::writable(self.liquidity_account.address()),
            InstructionAccount::readonly(self.token_program.address()),
            InstructionAccount::readonly(self.token_program.address()),
            InstructionAccount::readonly(self.instructions_sysvar.address()),
        ];
        let ix = InstructionView { program_id: &KAMINO_LENDING_PROGRAM, data: &data, accounts: &metas };
        invoke_signed(
            &ix,
            &[
                self.owner,
                self.lending_market,
                self.reserve,
                self.lending_market_authority,
                self.liquidity_mint,
                self.collateral_mint,
                self.liquidity_supply,
                self.collateral_account,
                self.liquidity_account,
                self.token_program,
                self.token_program,
                self.instructions_sysvar,
            ],
            signer,
        )
    }
}
