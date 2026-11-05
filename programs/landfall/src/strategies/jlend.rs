//! Jupiter Lend Earn (fToken): read-only valuation + CPI.
//!
//! `Lending` account (196 bytes, mainnet USDC market
//! `2vVYHYM8VYnvZqQWpTJSj8o8DBf1wM8pVs3bsTgYZiqJ`): mint at 8, f_token_mint
//! at 40, token_exchange_price u64 at 115 (1e12 precision).

use pinocchio::cpi::{invoke_signed, Signer};
use pinocchio::instruction::{InstructionAccount, InstructionView};
use pinocchio::{AccountView, Address, ProgramResult};

use crate::constants::JUPITER_LEND_PROGRAM;

pub const LENDING_LEN: usize = 196;
/// `sha256("account:Lending")[..8]`
pub const LENDING_DISCRIMINATOR: [u8; 8] = [0x87, 0xc7, 0x52, 0x10, 0xf9, 0x83, 0xb6, 0xf1];
pub const EXCHANGE_PRICE_PRECISION: u128 = 1_000_000_000_000;
pub const IX_DEPOSIT: [u8; 8] = [0xf2, 0x23, 0xc6, 0x89, 0x52, 0xe1, 0xf2, 0xb6];
pub const IX_WITHDRAW: [u8; 8] = [0xb7, 0x12, 0x46, 0x9c, 0x94, 0x6d, 0xa1, 0x22];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LendingView {
    pub mint: Address,
    pub ftoken_mint: Address,
    pub token_exchange_price: u64,
}

impl LendingView {
    pub fn parse(acc: &AccountView) -> Option<Self> {
        if !acc.owned_by(&JUPITER_LEND_PROGRAM) {
            return None;
        }
        let d = acc.try_borrow().ok()?;
        Self::parse_data(&d)
    }

    pub fn parse_data(d: &[u8]) -> Option<Self> {
        if d.len() < LENDING_LEN || d[..8] != LENDING_DISCRIMINATOR {
            return None;
        }
        let price = u64::from_le_bytes(d[115..123].try_into().ok()?);
        if price == 0 {
            return None;
        }
        Some(Self {
            mint: Address::new_from_array(d[8..40].try_into().ok()?),
            ftoken_mint: Address::new_from_array(d[40..72].try_into().ok()?),
            token_exchange_price: price,
        })
    }

    pub fn assets_for_shares(&self, shares: u64) -> Option<u64> {
        u64::try_from((shares as u128).checked_mul(self.token_exchange_price as u128)? / EXCHANGE_PRICE_PRECISION).ok()
    }
}

/// Accounts of the Earn `deposit` / `withdraw` instructions.
pub struct JlendCpi<'a> {
    pub signer: &'a AccountView,
    pub asset_account: &'a AccountView,
    pub ftoken_account: &'a AccountView,
    pub mint: &'a AccountView,
    pub lending_admin: &'a AccountView,
    pub lending: &'a AccountView,
    pub ftoken_mint: &'a AccountView,
    pub supply_token_reserves_liquidity: &'a AccountView,
    pub lending_supply_position_on_liquidity: &'a AccountView,
    pub rate_model: &'a AccountView,
    pub liquidity_vault: &'a AccountView,
    pub claim_account: &'a AccountView,
    pub liquidity: &'a AccountView,
    pub liquidity_program: &'a AccountView,
    pub rewards_rate_model: &'a AccountView,
    pub token_program: &'a AccountView,
    pub associated_token_program: &'a AccountView,
    pub system_program: &'a AccountView,
}

impl JlendCpi<'_> {
    pub fn deposit(&self, assets: u64, signer: &[Signer]) -> ProgramResult {
        let mut data = [0u8; 16];
        data[..8].copy_from_slice(&IX_DEPOSIT);
        data[8..].copy_from_slice(&assets.to_le_bytes());
        let metas = [
            InstructionAccount::writable_signer(self.signer.address()),
            InstructionAccount::writable(self.asset_account.address()),
            InstructionAccount::writable(self.ftoken_account.address()),
            InstructionAccount::readonly(self.mint.address()),
            InstructionAccount::readonly(self.lending_admin.address()),
            InstructionAccount::writable(self.lending.address()),
            InstructionAccount::writable(self.ftoken_mint.address()),
            InstructionAccount::writable(self.supply_token_reserves_liquidity.address()),
            InstructionAccount::writable(self.lending_supply_position_on_liquidity.address()),
            InstructionAccount::readonly(self.rate_model.address()),
            InstructionAccount::writable(self.liquidity_vault.address()),
            InstructionAccount::writable(self.liquidity.address()),
            InstructionAccount::readonly(self.liquidity_program.address()),
            InstructionAccount::readonly(self.rewards_rate_model.address()),
            InstructionAccount::readonly(self.token_program.address()),
            InstructionAccount::readonly(self.associated_token_program.address()),
            InstructionAccount::readonly(self.system_program.address()),
        ];
        let ix = InstructionView { program_id: &JUPITER_LEND_PROGRAM, data: &data, accounts: &metas };
        invoke_signed(
            &ix,
            &[
                self.signer,
                self.asset_account,
                self.ftoken_account,
                self.mint,
                self.lending_admin,
                self.lending,
                self.ftoken_mint,
                self.supply_token_reserves_liquidity,
                self.lending_supply_position_on_liquidity,
                self.rate_model,
                self.liquidity_vault,
                self.liquidity,
                self.liquidity_program,
                self.rewards_rate_model,
                self.token_program,
                self.associated_token_program,
                self.system_program,
            ],
            signer,
        )
    }

    pub fn withdraw(&self, assets: u64, signer: &[Signer]) -> ProgramResult {
        let mut data = [0u8; 16];
        data[..8].copy_from_slice(&IX_WITHDRAW);
        data[8..].copy_from_slice(&assets.to_le_bytes());
        let metas = [
            InstructionAccount::writable_signer(self.signer.address()),
            InstructionAccount::writable(self.ftoken_account.address()),
            InstructionAccount::writable(self.asset_account.address()),
            InstructionAccount::readonly(self.lending_admin.address()),
            InstructionAccount::writable(self.lending.address()),
            InstructionAccount::readonly(self.mint.address()),
            InstructionAccount::writable(self.ftoken_mint.address()),
            InstructionAccount::writable(self.supply_token_reserves_liquidity.address()),
            InstructionAccount::writable(self.lending_supply_position_on_liquidity.address()),
            InstructionAccount::readonly(self.rate_model.address()),
            InstructionAccount::writable(self.liquidity_vault.address()),
            InstructionAccount::writable(self.claim_account.address()),
            InstructionAccount::writable(self.liquidity.address()),
            InstructionAccount::readonly(self.liquidity_program.address()),
            InstructionAccount::readonly(self.rewards_rate_model.address()),
            InstructionAccount::readonly(self.token_program.address()),
            InstructionAccount::readonly(self.associated_token_program.address()),
            InstructionAccount::readonly(self.system_program.address()),
        ];
        let ix = InstructionView { program_id: &JUPITER_LEND_PROGRAM, data: &data, accounts: &metas };
        invoke_signed(
            &ix,
            &[
                self.signer,
                self.ftoken_account,
                self.asset_account,
                self.lending_admin,
                self.lending,
                self.mint,
                self.ftoken_mint,
                self.supply_token_reserves_liquidity,
                self.lending_supply_position_on_liquidity,
                self.rate_model,
                self.liquidity_vault,
                self.claim_account,
                self.liquidity,
                self.liquidity_program,
                self.rewards_rate_model,
                self.token_program,
                self.associated_token_program,
                self.system_program,
            ],
            signer,
        )
    }
}
