//! Account layouts. Byte-for-byte the Borsh layout of the original Anchor
//! accounts (8-byte discriminator first), so off-chain decoders are unchanged.

use pinocchio::{AccountView, Address};

use crate::constants::{ACC_INBOX, ACC_VAULT, ID};
use crate::error::{require, LandfallError, Result};

fn key(d: &[u8], o: usize) -> Address {
    Address::new_from_array(d[o..o + 32].try_into().unwrap_or_default())
}
fn u64_at(d: &[u8], o: usize) -> u64 {
    u64::from_le_bytes(d[o..o + 8].try_into().unwrap_or_default())
}
fn u16_at(d: &[u8], o: usize) -> u16 {
    u16::from_le_bytes(d[o..o + 2].try_into().unwrap_or_default())
}
fn put_key(d: &mut [u8], o: usize, k: &Address) {
    d[o..o + 32].copy_from_slice(k.as_ref());
}
fn put_u64(d: &mut [u8], o: usize, v: u64) {
    d[o..o + 8].copy_from_slice(&v.to_le_bytes());
}
fn put_u16(d: &mut [u8], o: usize, v: u16) {
    d[o..o + 2].copy_from_slice(&v.to_le_bytes());
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct KaminoStrategy {
    pub enabled: bool,
    pub reserve: Address,
    pub market: Address,
    pub collateral_mint: Address,
    pub collateral_account: Address,
    pub weight_bps: u16,
    pub cap: u64,
    pub cached_value: u64,
    pub cached_slot: u64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct JlendStrategy {
    pub enabled: bool,
    pub lending: Address,
    pub ftoken_mint: Address,
    pub ftoken_account: Address,
    pub weight_bps: u16,
    pub cap: u64,
    pub cached_value: u64,
    pub cached_slot: u64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Vault {
    pub admin: Address,
    pub curator: Address,
    pub usdc_mint: Address,
    pub share_mint: Address,
    pub idle: Address,
    pub kamino: KaminoStrategy,
    pub jlend: JlendStrategy,
    pub idle_buffer_bps: u16,
    pub sweep_fee: u64,
    pub min_sweep: u64,
    pub paused: bool,
    pub landed_total: u64,
    pub landed_count: u64,
    pub redeemed_total: u64,
    pub bump: u8,
    pub share_mint_bump: u8,
}

impl Vault {
    pub const LEN: usize = 491;

    pub fn decode(d: &[u8]) -> Result<Self> {
        require(d.len() >= Self::LEN && d[..8] == ACC_VAULT, LandfallError::InvalidAccount)?;
        Ok(Self {
            admin: key(d, 8),
            curator: key(d, 40),
            usdc_mint: key(d, 72),
            share_mint: key(d, 104),
            idle: key(d, 136),
            kamino: KaminoStrategy {
                enabled: d[168] == 1,
                reserve: key(d, 169),
                market: key(d, 201),
                collateral_mint: key(d, 233),
                collateral_account: key(d, 265),
                weight_bps: u16_at(d, 297),
                cap: u64_at(d, 299),
                cached_value: u64_at(d, 307),
                cached_slot: u64_at(d, 315),
            },
            jlend: JlendStrategy {
                enabled: d[323] == 1,
                lending: key(d, 324),
                ftoken_mint: key(d, 356),
                ftoken_account: key(d, 388),
                weight_bps: u16_at(d, 420),
                cap: u64_at(d, 422),
                cached_value: u64_at(d, 430),
                cached_slot: u64_at(d, 438),
            },
            idle_buffer_bps: u16_at(d, 446),
            sweep_fee: u64_at(d, 448),
            min_sweep: u64_at(d, 456),
            paused: d[464] == 1,
            landed_total: u64_at(d, 465),
            landed_count: u64_at(d, 473),
            redeemed_total: u64_at(d, 481),
            bump: d[489],
            share_mint_bump: d[490],
        })
    }

    pub fn encode(&self, d: &mut [u8]) {
        d[..8].copy_from_slice(&ACC_VAULT);
        put_key(d, 8, &self.admin);
        put_key(d, 40, &self.curator);
        put_key(d, 72, &self.usdc_mint);
        put_key(d, 104, &self.share_mint);
        put_key(d, 136, &self.idle);
        let k = &self.kamino;
        d[168] = k.enabled as u8;
        put_key(d, 169, &k.reserve);
        put_key(d, 201, &k.market);
        put_key(d, 233, &k.collateral_mint);
        put_key(d, 265, &k.collateral_account);
        put_u16(d, 297, k.weight_bps);
        put_u64(d, 299, k.cap);
        put_u64(d, 307, k.cached_value);
        put_u64(d, 315, k.cached_slot);
        let j = &self.jlend;
        d[323] = j.enabled as u8;
        put_key(d, 324, &j.lending);
        put_key(d, 356, &j.ftoken_mint);
        put_key(d, 388, &j.ftoken_account);
        put_u16(d, 420, j.weight_bps);
        put_u64(d, 422, j.cap);
        put_u64(d, 430, j.cached_value);
        put_u64(d, 438, j.cached_slot);
        put_u16(d, 446, self.idle_buffer_bps);
        put_u64(d, 448, self.sweep_fee);
        put_u64(d, 456, self.min_sweep);
        d[464] = self.paused as u8;
        put_u64(d, 465, self.landed_total);
        put_u64(d, 473, self.landed_count);
        put_u64(d, 481, self.redeemed_total);
        d[489] = self.bump;
        d[490] = self.share_mint_bump;
    }

    /// Loads a vault account owned by this program.
    pub fn load(acc: &AccountView) -> Result<Self> {
        require(acc.owned_by(&ID), LandfallError::InvalidAccount)?;
        let d = acc.try_borrow()?;
        Self::decode(&d)
    }

    pub fn store(&self, acc: &mut AccountView) -> Result {
        let mut d = acc.try_borrow_mut()?;
        self.encode(&mut d);
        Ok(())
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Inbox {
    pub vault: Address,
    pub owner: Address,
    pub swept_total: u64,
    pub sweep_count: u64,
    pub created_slot: u64,
    pub bump: u8,
}

impl Inbox {
    pub const LEN: usize = 97;

    pub fn decode(d: &[u8]) -> Result<Self> {
        require(d.len() >= Self::LEN && d[..8] == ACC_INBOX, LandfallError::InvalidAccount)?;
        Ok(Self {
            vault: key(d, 8),
            owner: key(d, 40),
            swept_total: u64_at(d, 72),
            sweep_count: u64_at(d, 80),
            created_slot: u64_at(d, 88),
            bump: d[96],
        })
    }

    pub fn encode(&self, d: &mut [u8]) {
        d[..8].copy_from_slice(&ACC_INBOX);
        put_key(d, 8, &self.vault);
        put_key(d, 40, &self.owner);
        put_u64(d, 72, self.swept_total);
        put_u64(d, 80, self.sweep_count);
        put_u64(d, 88, self.created_slot);
        d[96] = self.bump;
    }

    pub fn load(acc: &AccountView) -> Result<Self> {
        require(acc.owned_by(&ID), LandfallError::InvalidAccount)?;
        let d = acc.try_borrow()?;
        Self::decode(&d)
    }

    pub fn store(&self, acc: &mut AccountView) -> Result {
        let mut d = acc.try_borrow_mut()?;
        self.encode(&mut d);
        Ok(())
    }
}
