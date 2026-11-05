//! Account checks, token account reads, PDAs and event logging.

use pinocchio::{AccountView, Address};

use crate::constants::{ID, TOKEN_PROGRAM};
use crate::error::{require, LandfallError, Result};

pub const TOKEN_ACCOUNT_LEN: usize = 165;
pub const MINT_LEN: usize = 82;

pub fn signer(acc: &AccountView) -> Result {
    require(acc.is_signer(), LandfallError::Unauthorized)
}

pub fn key_is(acc: &AccountView, expected: &Address) -> Result {
    require(acc.address() == expected, LandfallError::InvalidAccount)
}

/// Parsed SPL token account (classic token program only).
pub struct TokenAccount {
    pub mint: Address,
    pub owner: Address,
    pub amount: u64,
}

pub fn read_token(acc: &AccountView) -> Option<TokenAccount> {
    if !acc.owned_by(&TOKEN_PROGRAM) || acc.data_len() != TOKEN_ACCOUNT_LEN {
        return None;
    }
    let d = acc.try_borrow().ok()?;
    // state: 1 = initialized
    if d[108] != 1 {
        return None;
    }
    Some(TokenAccount {
        mint: Address::new_from_array(d[0..32].try_into().ok()?),
        owner: Address::new_from_array(d[32..64].try_into().ok()?),
        amount: u64::from_le_bytes(d[64..72].try_into().ok()?),
    })
}

/// A token account of `mint` whose authority is `authority`.
pub fn token_of(acc: &AccountView, mint: &Address, authority: &Address) -> Result<TokenAccount> {
    let t = read_token(acc).ok_or(LandfallError::InvalidAccount)?;
    require(&t.mint == mint && &t.owner == authority, LandfallError::InvalidAccount)?;
    Ok(t)
}

/// A token account of `mint` (any authority).
pub fn token_of_mint(acc: &AccountView, mint: &Address) -> Result<TokenAccount> {
    let t = read_token(acc).ok_or(LandfallError::InvalidAccount)?;
    require(&t.mint == mint, LandfallError::InvalidAccount)?;
    Ok(t)
}

pub struct Mint {
    pub supply: u64,
    pub decimals: u8,
}

pub fn read_mint(acc: &AccountView) -> Result<Mint> {
    require(acc.owned_by(&TOKEN_PROGRAM) && acc.data_len() == MINT_LEN, LandfallError::InvalidAccount)?;
    let d = acc.try_borrow()?;
    require(d[45] == 1, LandfallError::InvalidAccount)?;
    Ok(Mint { supply: u64::from_le_bytes(d[36..44].try_into().unwrap_or_default()), decimals: d[44] })
}

/// PDA with a known bump (cheap, no curve check: the bump came from a PDA search).
pub fn derive<const N: usize>(seeds: &[&[u8]; N], bump: u8) -> Address {
    Address::derive_address(seeds, Some(bump), &ID)
}

/// Canonical PDA search (on-chain only).
#[cfg(any(target_os = "solana", target_arch = "bpf"))]
pub fn find(seeds: &[&[u8]], program: &Address) -> (Address, u8) {
    Address::find_program_address(seeds, program)
}

#[cfg(not(any(target_os = "solana", target_arch = "bpf")))]
pub fn find(_seeds: &[&[u8]], _program: &Address) -> (Address, u8) {
    unimplemented!("PDA search runs on-chain only")
}

pub fn slot() -> Result<u64> {
    use pinocchio::sysvars::{clock::Clock, Sysvar};
    Ok(Clock::get()?.slot)
}

/// Rent-exempt minimum, correct for both Rent sysvar layouts: the classic one
/// (`lamports_per_byte_year` u64, `exemption_threshold` f64 = 2.0) and the
/// SIMD-0194 one (`lamports_per_byte` with threshold 1.0).
pub fn rent_exempt(len: usize) -> Result<u64> {
    const RENT_ID: Address = solana_address::address!("SysvarRent111111111111111111111111111111111");
    const OVERHEAD: u64 = 128;
    let mut raw = [0u8; 16];
    pinocchio::sysvars::get_sysvar(&mut raw, &RENT_ID, 0)?;
    let per_byte = u64::from_le_bytes(raw[0..8].try_into().unwrap_or_default());
    let threshold_bits = u64::from_le_bytes(raw[8..16].try_into().unwrap_or_default());
    // 1.0 → ×1, anything else (2.0 today) → ×2: never under-funds
    let mult = if threshold_bits == 1.0f64.to_bits() { 1 } else { 2 };
    (len as u64 + OVERHEAD)
        .checked_mul(per_byte)
        .and_then(|x| x.checked_mul(mult))
        .ok_or(LandfallError::MathOverflow.into())
}

/// Anchor-compatible event: "Program data: base64(discriminator ‖ borsh fields)".
pub struct Event {
    buf: [u8; 160],
    len: usize,
}

impl Event {
    pub fn new(discriminator: [u8; 8]) -> Self {
        let mut e = Self { buf: [0; 160], len: 0 };
        e.put(&discriminator);
        e
    }
    fn put(&mut self, b: &[u8]) {
        let end = (self.len + b.len()).min(self.buf.len());
        let n = end - self.len;
        self.buf[self.len..end].copy_from_slice(&b[..n]);
        self.len = end;
    }
    pub fn key(mut self, k: &Address) -> Self {
        self.put(k.as_ref());
        self
    }
    pub fn u64(mut self, x: u64) -> Self {
        self.put(&x.to_le_bytes());
        self
    }
    pub fn u8(mut self, x: u8) -> Self {
        self.put(&[x]);
        self
    }
    pub fn emit(self) {
        #[cfg(any(target_os = "solana", target_arch = "bpf"))]
        unsafe {
            let parts: [&[u8]; 1] = [&self.buf[..self.len]];
            pinocchio::syscalls::sol_log_data(parts.as_ptr() as *const u8, 1);
        }
        #[cfg(not(any(target_os = "solana", target_arch = "bpf")))]
        let _ = (self.buf, self.len);
    }
}

pub fn read_u64(data: &[u8], at: usize) -> Result<u64> {
    let b = data.get(at..at + 8).ok_or(LandfallError::InvalidInstruction)?;
    Ok(u64::from_le_bytes(b.try_into().unwrap_or_default()))
}

pub fn read_u16(data: &[u8], at: usize) -> Result<u16> {
    let b = data.get(at..at + 2).ok_or(LandfallError::InvalidInstruction)?;
    Ok(u16::from_le_bytes(b.try_into().unwrap_or_default()))
}

pub fn read_u8(data: &[u8], at: usize) -> Result<u8> {
    data.get(at).copied().ok_or(LandfallError::InvalidInstruction.into())
}

pub fn read_key(data: &[u8], at: usize) -> Result<Address> {
    let b = data.get(at..at + 32).ok_or(LandfallError::InvalidInstruction)?;
    Ok(Address::new_from_array(b.try_into().unwrap_or_default()))
}
