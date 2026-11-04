#![allow(dead_code)]
//! Loads the mainnet Kamino / Jupiter Lend snapshots into a LiteSVM and wires
//! the vault to them.

use anchor_lang::{
    prelude::Pubkey,
    solana_program::{clock::Clock, instruction::{AccountMeta, Instruction}},
    prelude::pubkey,
    InstructionData, ToAccountMetas,
};
use litesvm::LiteSVM;
use solana_account::Account;
use solana_signer::Signer;

use crate::common::*;

pub const KLEND: Pubkey = pubkey!("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
pub const K_MARKET: Pubkey = pubkey!("7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF");
pub const K_AUTHORITY: Pubkey = pubkey!("9DrvZvyWh1HuAoZxvYWMvkf2XCzryCpGgHqrMjyDWpmo");
pub const K_RESERVE: Pubkey = pubkey!("D6q6wuQSrifJKZYpR1M8R4YawnLDtDsMmWM1NbBmgJ59");
pub const K_SUPPLY: Pubkey = pubkey!("Bgq7trRgVMeq33yt235zM2onQ4bRDBsY5EWiTetF4qw6");
pub const K_CMINT: Pubkey = pubkey!("B8V6WVjPxW1UGwVDfxH2d2r8SyT4cqn7dQRK6XneVa7D");
pub const K_SCOPE: Pubkey = pubkey!("3t4JZcueEzTbVP6kLxXrL3VpWx45jDer4eqysweBchNH");

pub const JLEND: Pubkey = pubkey!("jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9");
pub const JLIQ: Pubkey = pubkey!("jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC");
pub const J_ADMIN: Pubkey = pubkey!("5nmGjA4s7ATzpBQXC5RNceRpaJ7pYw2wKsNBWyuSAZV6");
pub const J_LENDING: Pubkey = pubkey!("2vVYHYM8VYnvZqQWpTJSj8o8DBf1wM8pVs3bsTgYZiqJ");
pub const J_FMINT: Pubkey = pubkey!("9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D");
pub const J_RESERVES: Pubkey = pubkey!("94vK29npVbyRHXH63rRcTiSr26SFhrQTzbpNJuhQEDu");
pub const J_POSITION: Pubkey = pubkey!("Hf9gtkM4dpVBahVSzEXSVCAPpKzBsBcns3s8As3z77oF");
pub const J_RATE_MODEL: Pubkey = pubkey!("5pjzT5dFTsXcwixoab1QDLvZQvpYJxJeBphkyfHGn688");
pub const J_VAULT: Pubkey = pubkey!("BmkUoKMFYBxNSzWXyUjyMJjMAaVz4d8ZnxwwmhDCUXFB");
pub const J_LIQUIDITY: Pubkey = pubkey!("7s1da8DduuBFqGra5bJBjpnvL5E9mGzCuMk1Qkh4or2Z");
pub const J_REWARDS: Pubkey = pubkey!("5xSPBiD3TibamAnwHDhZABdB4z4F9dcj5PnbteroBTTd");
pub const J_CLAIM: Pubkey = pubkey!("HN1r4VfkDn53xQQfeGDYrNuDKFdemAhZsHYRwBrFhsW");

pub fn mainnet_svm() -> (LiteSVM, solana_keypair::Keypair, solana_keypair::Keypair) {
    let (mut svm, admin, usdc_auth) = Env::bare();
    let dir = fixtures_dir();
    for p in [KLEND, JLEND, JLIQ] {
        svm.add_program_from_file(p, dir.join("programs").join(format!("{p}.so"))).unwrap();
    }
    for entry in std::fs::read_dir(dir.join("accounts")).unwrap() {
        let path = entry.unwrap().path();
        if path.extension().map(|e| e == "json").unwrap_or(false) {
            let (key, _) = load_json_account(&mut svm, &path);
            if key == USDC {
                // keep the snapshot's layout but let the tests mint
                let mut a = svm.get_account(&USDC).unwrap();
                a.data[4..36].copy_from_slice(usdc_auth.pubkey().as_ref());
                svm.set_account(USDC, a).unwrap();
            }
        }
    }
    let slot: u64 = std::fs::read_to_string(dir.join("slot.txt")).unwrap().trim().parse().unwrap();
    let unix: i64 = std::fs::read_to_string(dir.join("unix.txt")).unwrap().trim().parse().unwrap();
    svm.warp_to_slot(slot);
    let mut clock: Clock = svm.get_sysvar();
    clock.slot = slot;
    clock.unix_timestamp = unix;
    svm.set_sysvar(&clock);
    (svm, admin, usdc_auth)
}

pub fn advance(env: &mut Env, seconds: i64, slots: u64) {
    let mut clock: Clock = env.svm.get_sysvar();
    clock.slot += slots;
    clock.unix_timestamp += seconds;
    env.svm.warp_to_slot(clock.slot);
    env.svm.set_sysvar(&clock);
}

pub fn refresh_reserve_ix() -> Instruction {
    Instruction {
        program_id: KLEND,
        accounts: vec![
            AccountMeta::new(K_RESERVE, false),
            AccountMeta::new_readonly(K_MARKET, false),
            AccountMeta::new_readonly(KLEND, false),
            AccountMeta::new_readonly(KLEND, false),
            AccountMeta::new_readonly(KLEND, false),
            AccountMeta::new_readonly(K_SCOPE, false),
        ],
        data: landfall::strategies::kamino::IX_REFRESH_RESERVE.to_vec(),
    }
}

pub fn kamino_cpi(env: &Env) -> landfall::accounts::KaminoCpi {
    landfall::accounts::KaminoCpi {
        reserve: K_RESERVE,
        collateral_account: ata(&env.vault, &K_CMINT),
        lending_market: K_MARKET,
        lending_market_authority: K_AUTHORITY,
        reserve_liquidity_supply: K_SUPPLY,
        collateral_mint: K_CMINT,
        instructions_sysvar: instructions_sysvar(),
        kamino_program: KLEND,
    }
}

pub fn jlend_cpi(env: &Env) -> landfall::accounts::JlendCpi {
    landfall::accounts::JlendCpi {
        lending: J_LENDING,
        ftoken_account: ata(&env.vault, &J_FMINT),
        ftoken_mint: J_FMINT,
        lending_admin: J_ADMIN,
        supply_token_reserves_liquidity: J_RESERVES,
        lending_supply_position_on_liquidity: J_POSITION,
        rate_model: J_RATE_MODEL,
        liquidity_vault: J_VAULT,
        claim_account: J_CLAIM,
        liquidity: J_LIQUIDITY,
        liquidity_program: JLIQ,
        rewards_rate_model: J_REWARDS,
        jlend_program: JLEND,
        associated_token_program: ATA_PROGRAM,
        system_program: SYSTEM_PROGRAM,
    }
}

impl Env {
    pub fn mainnet() -> Self {
        let (svm, admin, usdc) = mainnet_svm();
        Env::with_svm(svm, admin, usdc)
    }

    pub fn configure_kamino(&mut self) {
        let admin = self.admin.insecure_clone();
        let ix = Instruction::new_with_bytes(
            landfall::id(),
            &landfall::instruction::ConfigureKamino { enabled: true }.data(),
            landfall::accounts::ConfigureKamino {
                admin: admin.pubkey(),
                vault: self.vault,
                usdc_mint: USDC,
                reserve: K_RESERVE,
                collateral_mint: K_CMINT,
                collateral_account: ata(&self.vault, &K_CMINT),
                token_program: TOKEN_PROGRAM,
                associated_token_program: ATA_PROGRAM,
                system_program: SYSTEM_PROGRAM,
            }
            .to_account_metas(None),
        );
        self.ok(&[ix], &[&admin]);
    }

    pub fn configure_jlend(&mut self) {
        let admin = self.admin.insecure_clone();
        let ix = Instruction::new_with_bytes(
            landfall::id(),
            &landfall::instruction::ConfigureJlend { enabled: true }.data(),
            landfall::accounts::ConfigureJlend {
                admin: admin.pubkey(),
                vault: self.vault,
                usdc_mint: USDC,
                lending: J_LENDING,
                ftoken_mint: J_FMINT,
                ftoken_account: ata(&self.vault, &J_FMINT),
                token_program: TOKEN_PROGRAM,
                associated_token_program: ATA_PROGRAM,
                system_program: SYSTEM_PROGRAM,
            }
            .to_account_metas(None),
        );
        self.ok(&[ix], &[&admin]);
    }

    pub fn set_weights(&mut self, k_bps: u16, j_bps: u16, k_cap: u64, j_cap: u64) {
        let admin = self.admin.insecure_clone();
        let ix = self.curator_ix(landfall::instruction::SetWeights { kamino_bps: k_bps, jlend_bps: j_bps, kamino_cap: k_cap, jlend_cap: j_cap }.data());
        self.ok(&[ix], &[&admin]);
    }

    pub fn allocate_kamino_ixs(&self, keeper: &Pubkey, amount: u64) -> Vec<Instruction> {
        let n = self.nav_accounts();
        let ix = Instruction::new_with_bytes(
            landfall::id(),
            &landfall::instruction::AllocateKamino { amount }.data(),
            landfall::accounts::AllocateKamino {
                keeper: *keeper,
                vault: self.vault,
                usdc_mint: USDC,
                idle: self.idle,
                kamino: kamino_cpi(self),
                jlend_lending: n[2].pubkey,
                jlend_ftoken: n[3].pubkey,
                token_program: TOKEN_PROGRAM,
            }
            .to_account_metas(None),
        );
        vec![refresh_reserve_ix(), ix]
    }

    pub fn allocate_jlend_ix(&self, keeper: &Pubkey, amount: u64) -> Instruction {
        let n = self.nav_accounts();
        Instruction::new_with_bytes(
            landfall::id(),
            &landfall::instruction::AllocateJlend { amount }.data(),
            landfall::accounts::AllocateJlend {
                keeper: *keeper,
                vault: self.vault,
                usdc_mint: USDC,
                idle: self.idle,
                jlend: jlend_cpi(self),
                kamino_reserve: n[0].pubkey,
                kamino_collateral: n[1].pubkey,
                token_program: TOKEN_PROGRAM,
            }
            .to_account_metas(None),
        )
    }

    pub fn redeem_via_kamino_ixs(&self, owner: &Pubkey, destination: &Pubkey, shares: u64, min_out: u64) -> Vec<Instruction> {
        let ix = Instruction::new_with_bytes(
            landfall::id(),
            &landfall::instruction::RedeemViaKamino { shares, min_out }.data(),
            landfall::accounts::RedeemViaKamino { base: self.redeem_base(owner, destination), kamino: kamino_cpi(self) }.to_account_metas(None),
        );
        vec![refresh_reserve_ix(), ix]
    }

    pub fn redeem_via_jlend_ix(&self, owner: &Pubkey, destination: &Pubkey, shares: u64, min_out: u64) -> Instruction {
        Instruction::new_with_bytes(
            landfall::id(),
            &landfall::instruction::RedeemViaJlend { shares, min_out }.data(),
            landfall::accounts::RedeemViaJlend { base: self.redeem_base(owner, destination), jlend: jlend_cpi(self) }.to_account_metas(None),
        )
    }

    pub fn sync_nav_ix(&self) -> Instruction {
        let n = self.nav_accounts();
        Instruction::new_with_bytes(
            landfall::id(),
            &landfall::instruction::SyncNav {}.data(),
            landfall::accounts::SyncNav {
                vault: self.vault,
                idle: self.idle,
                kamino_reserve: n[0].pubkey,
                kamino_collateral: n[1].pubkey,
                jlend_lending: n[2].pubkey,
                jlend_ftoken: n[3].pubkey,
            }
            .to_account_metas(None),
        )
    }

    pub fn patch_account(&mut self, key: &Pubkey, f: impl FnOnce(&mut Account)) {
        let mut a = self.svm.get_account(key).unwrap();
        f(&mut a);
        self.svm.set_account(*key, a).unwrap();
    }
}
