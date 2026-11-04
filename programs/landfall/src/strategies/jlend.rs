//! Jupiter Lend Earn (fToken) market: read-only valuation + CPI builders.
//!
//! `Lending` account layout (196 bytes, verified on the mainnet USDC market
//! `2vVYHYM8VYnvZqQWpTJSj8o8DBf1wM8pVs3bsTgYZiqJ`): mint at 8, f_token_mint at
//! 40, rewards_rate_model at 75, liquidity_exchange_price u64 at 107,
//! token_exchange_price u64 at 115 (1e12 precision), token_reserves_liquidity
//! at 131, supply_position_on_liquidity at 163.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};

use crate::constants::JUPITER_LEND_PROGRAM;

pub const LENDING_LEN: usize = 196;
/// `sha256("account:Lending")[..8]`
pub const LENDING_DISCRIMINATOR: [u8; 8] = [0x87, 0xc7, 0x52, 0x10, 0xf9, 0x83, 0xb6, 0xf1];
const OFF_MINT: usize = 8;
const OFF_FTOKEN_MINT: usize = 40;
const OFF_TOKEN_EXCHANGE_PRICE: usize = 115;
pub const EXCHANGE_PRICE_PRECISION: u128 = 1_000_000_000_000;

pub const IX_DEPOSIT: [u8; 8] = [0xf2, 0x23, 0xc6, 0x89, 0x52, 0xe1, 0xf2, 0xb6];
pub const IX_WITHDRAW: [u8; 8] = [0xb7, 0x12, 0x46, 0x9c, 0x94, 0x6d, 0xa1, 0x22];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LendingView {
    pub mint: Pubkey,
    pub ftoken_mint: Pubkey,
    pub token_exchange_price: u64,
}

impl LendingView {
    pub fn parse(info: &AccountInfo) -> Option<Self> {
        if info.owner != &JUPITER_LEND_PROGRAM {
            return None;
        }
        let data = info.try_borrow_data().ok()?;
        Self::parse_data(&data)
    }

    pub fn parse_data(d: &[u8]) -> Option<Self> {
        if d.len() < LENDING_LEN || d[..8] != LENDING_DISCRIMINATOR {
            return None;
        }
        let price = u64::from_le_bytes(d[OFF_TOKEN_EXCHANGE_PRICE..OFF_TOKEN_EXCHANGE_PRICE + 8].try_into().ok()?);
        if price == 0 {
            return None;
        }
        Some(Self {
            mint: Pubkey::new_from_array(d[OFF_MINT..OFF_MINT + 32].try_into().ok()?),
            ftoken_mint: Pubkey::new_from_array(d[OFF_FTOKEN_MINT..OFF_FTOKEN_MINT + 32].try_into().ok()?),
            token_exchange_price: price,
        })
    }

    /// Underlying value of `shares` fTokens, rounded down.
    pub fn assets_for_shares(&self, shares: u64) -> Option<u64> {
        let v = (shares as u128).checked_mul(self.token_exchange_price as u128)? / EXCHANGE_PRICE_PRECISION;
        u64::try_from(v).ok()
    }
}

/// Accounts of the Earn `deposit` / `withdraw` instructions, in program order.
/// `claim_account` is only used by `withdraw`.
pub struct JlendAccounts<'a, 'info> {
    pub signer: &'a AccountInfo<'info>,
    pub asset_account: &'a AccountInfo<'info>,
    pub ftoken_account: &'a AccountInfo<'info>,
    pub mint: &'a AccountInfo<'info>,
    pub lending_admin: &'a AccountInfo<'info>,
    pub lending: &'a AccountInfo<'info>,
    pub ftoken_mint: &'a AccountInfo<'info>,
    pub supply_token_reserves_liquidity: &'a AccountInfo<'info>,
    pub lending_supply_position_on_liquidity: &'a AccountInfo<'info>,
    pub rate_model: &'a AccountInfo<'info>,
    pub liquidity_vault: &'a AccountInfo<'info>,
    pub claim_account: &'a AccountInfo<'info>,
    pub liquidity: &'a AccountInfo<'info>,
    pub liquidity_program: &'a AccountInfo<'info>,
    pub rewards_rate_model: &'a AccountInfo<'info>,
    pub token_program: &'a AccountInfo<'info>,
    pub associated_token_program: &'a AccountInfo<'info>,
    pub system_program: &'a AccountInfo<'info>,
}

impl<'a, 'info> JlendAccounts<'a, 'info> {
    fn infos(&self) -> Vec<AccountInfo<'info>> {
        vec![
            self.signer.clone(),
            self.asset_account.clone(),
            self.ftoken_account.clone(),
            self.mint.clone(),
            self.lending_admin.clone(),
            self.lending.clone(),
            self.ftoken_mint.clone(),
            self.supply_token_reserves_liquidity.clone(),
            self.lending_supply_position_on_liquidity.clone(),
            self.rate_model.clone(),
            self.liquidity_vault.clone(),
            self.claim_account.clone(),
            self.liquidity.clone(),
            self.liquidity_program.clone(),
            self.rewards_rate_model.clone(),
            self.token_program.clone(),
            self.associated_token_program.clone(),
            self.system_program.clone(),
        ]
    }

    pub fn deposit(&self, assets: u64, signer: &[&[&[u8]]]) -> Result<()> {
        let mut data = IX_DEPOSIT.to_vec();
        data.extend_from_slice(&assets.to_le_bytes());
        let ix = Instruction {
            program_id: JUPITER_LEND_PROGRAM,
            accounts: vec![
                AccountMeta::new(self.signer.key(), true),
                AccountMeta::new(self.asset_account.key(), false),
                AccountMeta::new(self.ftoken_account.key(), false),
                AccountMeta::new_readonly(self.mint.key(), false),
                AccountMeta::new_readonly(self.lending_admin.key(), false),
                AccountMeta::new(self.lending.key(), false),
                AccountMeta::new(self.ftoken_mint.key(), false),
                AccountMeta::new(self.supply_token_reserves_liquidity.key(), false),
                AccountMeta::new(self.lending_supply_position_on_liquidity.key(), false),
                AccountMeta::new_readonly(self.rate_model.key(), false),
                AccountMeta::new(self.liquidity_vault.key(), false),
                AccountMeta::new(self.liquidity.key(), false),
                AccountMeta::new_readonly(self.liquidity_program.key(), false),
                AccountMeta::new_readonly(self.rewards_rate_model.key(), false),
                AccountMeta::new_readonly(self.token_program.key(), false),
                AccountMeta::new_readonly(self.associated_token_program.key(), false),
                AccountMeta::new_readonly(self.system_program.key(), false),
            ],
            data,
        };
        anchor_lang::solana_program::program::invoke_signed(&ix, &self.infos(), signer)?;
        Ok(())
    }

    pub fn withdraw(&self, assets: u64, signer: &[&[&[u8]]]) -> Result<()> {
        let mut data = IX_WITHDRAW.to_vec();
        data.extend_from_slice(&assets.to_le_bytes());
        let ix = Instruction {
            program_id: JUPITER_LEND_PROGRAM,
            accounts: vec![
                AccountMeta::new(self.signer.key(), true),
                AccountMeta::new(self.ftoken_account.key(), false),
                AccountMeta::new(self.asset_account.key(), false),
                AccountMeta::new_readonly(self.lending_admin.key(), false),
                AccountMeta::new(self.lending.key(), false),
                AccountMeta::new_readonly(self.mint.key(), false),
                AccountMeta::new(self.ftoken_mint.key(), false),
                AccountMeta::new(self.supply_token_reserves_liquidity.key(), false),
                AccountMeta::new(self.lending_supply_position_on_liquidity.key(), false),
                AccountMeta::new_readonly(self.rate_model.key(), false),
                AccountMeta::new(self.liquidity_vault.key(), false),
                AccountMeta::new(self.claim_account.key(), false),
                AccountMeta::new(self.liquidity.key(), false),
                AccountMeta::new_readonly(self.liquidity_program.key(), false),
                AccountMeta::new_readonly(self.rewards_rate_model.key(), false),
                AccountMeta::new_readonly(self.token_program.key(), false),
                AccountMeta::new_readonly(self.associated_token_program.key(), false),
                AccountMeta::new_readonly(self.system_program.key(), false),
            ],
            data,
        };
        anchor_lang::solana_program::program::invoke_signed(&ix, &self.infos(), signer)?;
        Ok(())
    }
}
