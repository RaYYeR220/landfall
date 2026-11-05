#![allow(dead_code)]
//! LiteSVM harness. Core tests run with a synthetic USDC mint at the real USDC
//! address; strategy tests additionally load mainnet snapshots of Kamino and
//! Jupiter Lend (see `scripts/dump-fixtures.sh`).

pub mod lc;

use std::path::PathBuf;

use anchor_lang::{
    prelude::Pubkey,
    solana_program::instruction::Instruction,
    AccountDeserialize, InstructionData, ToAccountMetas,
};
use base64::Engine;
use litesvm::{types::TransactionResult, LiteSVM};
use solana_account::Account;
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

pub const USDC: Pubkey = anchor_lang::prelude::pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
pub const TOKEN_PROGRAM: Pubkey = anchor_lang::prelude::pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
pub const ATA_PROGRAM: Pubkey = anchor_lang::prelude::pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
pub const SYSTEM_PROGRAM: Pubkey = anchor_lang::solana_program::system_program::ID;

pub fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures")
}

pub fn ata(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[owner.as_ref(), TOKEN_PROGRAM.as_ref(), mint.as_ref()], &ATA_PROGRAM).0
}

pub fn vault_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[lc::VAULT_SEED, mint.as_ref()], &lc::id()).0
}
pub fn share_mint_pda(vault: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[lc::SHARES_SEED, vault.as_ref()], &lc::id()).0
}
pub fn inbox_pda(vault: &Pubkey, owner: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[lc::INBOX_SEED, vault.as_ref(), owner.as_ref()], &lc::id()).0
}

pub fn program_data_address() -> Pubkey {
    Pubkey::find_program_address(&[lc::id().as_ref()], &lc::BPF_UPGRADEABLE_LOADER).0
}

/// ProgramData header (loader state 3) naming `authority` as upgrade authority.
pub fn set_upgrade_authority(svm: &mut LiteSVM, authority: &Pubkey) {
    let mut d = vec![0u8; 45];
    d[0..4].copy_from_slice(&3u32.to_le_bytes());
    d[12] = 1;
    d[13..45].copy_from_slice(authority.as_ref());
    svm.set_account(
        program_data_address(),
        Account { lamports: 1_000_000_000, data: d, owner: lc::BPF_UPGRADEABLE_LOADER, executable: false, rent_epoch: 0 },
    )
    .unwrap();
}

pub fn mint_data(authority: &Pubkey, supply: u64, decimals: u8) -> Vec<u8> {
    let mut d = vec![0u8; 82];
    d[0..4].copy_from_slice(&1u32.to_le_bytes());
    d[4..36].copy_from_slice(authority.as_ref());
    d[36..44].copy_from_slice(&supply.to_le_bytes());
    d[44] = decimals;
    d[45] = 1;
    d
}

pub fn token_account_data(mint: &Pubkey, owner: &Pubkey, amount: u64) -> Vec<u8> {
    let mut d = vec![0u8; 165];
    d[0..32].copy_from_slice(mint.as_ref());
    d[32..64].copy_from_slice(owner.as_ref());
    d[64..72].copy_from_slice(&amount.to_le_bytes());
    d[108] = 1; // initialized
    d
}

pub fn load_json_account(svm: &mut LiteSVM, path: &PathBuf) -> (Pubkey, Account) {
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let key: Pubkey = v["pubkey"].as_str().unwrap().parse().unwrap();
    let a = &v["account"];
    let data = base64::engine::general_purpose::STANDARD.decode(a["data"][0].as_str().unwrap()).unwrap();
    let acc = Account {
        lamports: a["lamports"].as_u64().unwrap(),
        data,
        owner: a["owner"].as_str().unwrap().parse().unwrap(),
        executable: a["executable"].as_bool().unwrap(),
        rent_epoch: 0,
    };
    svm.set_account(key, acc.clone()).unwrap();
    (key, acc)
}

pub struct Env {
    pub svm: LiteSVM,
    pub admin: Keypair,
    pub usdc_authority: Keypair,
    pub vault: Pubkey,
    pub share_mint: Pubkey,
    pub idle: Pubkey,
}

impl Env {
    /// Fresh SVM with the landfall program and a synthetic USDC mint.
    pub fn bare() -> (LiteSVM, Keypair, Keypair) {
        let mut svm = LiteSVM::new();
        let so = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../target/deploy/landfall.so");
        svm.add_program_from_file(lc::id(), so).unwrap();
        let admin = Keypair::new();
        let usdc_authority = Keypair::new();
        svm.airdrop(&admin.pubkey(), 100_000_000_000).unwrap();
        set_upgrade_authority(&mut svm, &admin.pubkey());
        svm.set_account(
            USDC,
            Account { lamports: 1_000_000_000, data: mint_data(&usdc_authority.pubkey(), 0, 6), owner: TOKEN_PROGRAM, executable: false, rent_epoch: 0 },
        )
        .unwrap();
        (svm, admin, usdc_authority)
    }

    pub fn new() -> Self {
        let (svm, admin, usdc_authority) = Self::bare();
        Self::with_svm(svm, admin, usdc_authority)
    }

    pub fn with_svm(svm: LiteSVM, admin: Keypair, usdc_authority: Keypair) -> Self {
        let mut env = Self::uninitialised(svm, admin, usdc_authority);
        env.init_vault(1_000_000);
        env
    }

    /// Everything but `init_vault` (admin funded with 10 test USDC).
    pub fn uninitialised(svm: LiteSVM, admin: Keypair, usdc_authority: Keypair) -> Self {
        let vault = vault_pda(&USDC);
        let share_mint = share_mint_pda(&vault);
        let idle = ata(&vault, &USDC);
        let mut env = Env { svm, admin, usdc_authority, vault, share_mint, idle };
        let admin_pk = env.admin.pubkey();
        env.fund_usdc(&admin_pk, 10_000_000);
        env
    }

    pub fn send(&mut self, ixs: &[Instruction], signers: &[&Keypair]) -> TransactionResult {
        let payer = signers[0].pubkey();
        let bh = self.svm.latest_blockhash();
        let msg = Message::new_with_blockhash(ixs, Some(&payer), &bh);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
        let r = self.svm.send_transaction(tx);
        self.svm.expire_blockhash();
        r
    }

    pub fn ok(&mut self, ixs: &[Instruction], signers: &[&Keypair]) -> u64 {
        match self.send(ixs, signers) {
            Ok(meta) => meta.compute_units_consumed,
            Err(e) => panic!("tx failed: {:?}\nlogs:\n{}", e.err, e.meta.logs.join("\n")),
        }
    }

    /// Credits `amount` test USDC to the owner's USDC ATA (creating it).
    pub fn fund_usdc(&mut self, owner: &Pubkey, amount: u64) -> Pubkey {
        let a = ata(owner, &USDC);
        let current = self.token_balance(&a);
        self.set_token(&a, &USDC, owner, current + amount);
        a
    }

    pub fn set_token(&mut self, address: &Pubkey, mint: &Pubkey, owner: &Pubkey, amount: u64) {
        self.svm
            .set_account(
                *address,
                Account { lamports: 2_039_280, data: token_account_data(mint, owner, amount), owner: TOKEN_PROGRAM, executable: false, rent_epoch: 0 },
            )
            .unwrap();
    }

    pub fn token_balance(&self, address: &Pubkey) -> u64 {
        self.svm
            .get_account(address)
            .filter(|a| a.data.len() >= 72)
            .map(|a| u64::from_le_bytes(a.data[64..72].try_into().unwrap()))
            .unwrap_or(0)
    }

    pub fn mint_supply(&self, mint: &Pubkey) -> u64 {
        let a = self.svm.get_account(mint).unwrap();
        u64::from_le_bytes(a.data[36..44].try_into().unwrap())
    }

    pub fn vault_state(&self) -> lc::state::Vault {
        let a = self.svm.get_account(&self.vault).unwrap();
        lc::state::Vault::try_deserialize(&mut a.data.as_slice()).unwrap()
    }

    pub fn inbox_state(&self, owner: &Pubkey) -> lc::state::Inbox {
        let a = self.svm.get_account(&inbox_pda(&self.vault, owner)).unwrap();
        lc::state::Inbox::try_deserialize(&mut a.data.as_slice()).unwrap()
    }

    pub fn init_vault(&mut self, seed: u64) {
        let admin_kp = self.admin.insecure_clone();
        let ix = self.init_vault_ix(&admin_kp.pubkey(), seed);
        self.ok(&[ix], &[&admin_kp]);
    }

    pub fn init_vault_ix(&self, admin: &Pubkey, seed: u64) -> Instruction {
        let admin = *admin;
        Instruction::new_with_bytes(
            lc::id(),
            &lc::instruction::InitVault {
                params: lc::InitVaultParams { curator: admin, idle_buffer_bps: 1_000, sweep_fee: 10_000, min_sweep: 1_000_000, seed_amount: seed },
            }
            .data(),
            lc::accounts::InitVault {
                admin,
                usdc_mint: USDC,
                vault: self.vault,
                share_mint: self.share_mint,
                idle: self.idle,
                dead_shares: ata(&self.vault, &self.share_mint),
                admin_usdc: ata(&admin, &USDC),
                program_data: program_data_address(),
                token_program: TOKEN_PROGRAM,
                associated_token_program: ATA_PROGRAM,
                system_program: SYSTEM_PROGRAM,
            }
            .to_account_metas(None),
        )
    }

    /// The four valuation accounts in program order.
    pub fn nav_accounts(&self) -> Vec<anchor_lang::solana_program::instruction::AccountMeta> {
        let v = self.vault_state();
        let pick = |k: Pubkey| if k == Pubkey::default() { SYSTEM_PROGRAM } else { k };
        vec![
            anchor_lang::solana_program::instruction::AccountMeta::new_readonly(pick(v.kamino.reserve), false),
            anchor_lang::solana_program::instruction::AccountMeta::new_readonly(pick(v.kamino.collateral_account), false),
            anchor_lang::solana_program::instruction::AccountMeta::new_readonly(pick(v.jlend.lending), false),
            anchor_lang::solana_program::instruction::AccountMeta::new_readonly(pick(v.jlend.ftoken_account), false),
        ]
    }

    pub fn create_ata_ix(&self, payer: &Pubkey, owner: &Pubkey, mint: &Pubkey) -> Instruction {
        Instruction {
            program_id: ATA_PROGRAM,
            accounts: vec![
                anchor_lang::solana_program::instruction::AccountMeta::new(*payer, true),
                anchor_lang::solana_program::instruction::AccountMeta::new(ata(owner, mint), false),
                anchor_lang::solana_program::instruction::AccountMeta::new_readonly(*owner, false),
                anchor_lang::solana_program::instruction::AccountMeta::new_readonly(*mint, false),
                anchor_lang::solana_program::instruction::AccountMeta::new_readonly(SYSTEM_PROGRAM, false),
                anchor_lang::solana_program::instruction::AccountMeta::new_readonly(TOKEN_PROGRAM, false),
            ],
            data: vec![1], // CreateIdempotent
        }
    }

    pub fn deposit_ix(&self, depositor: &Pubkey, owner: &Pubkey, amount: u64) -> Instruction {
        let mut metas = lc::accounts::Deposit {
            depositor: *depositor,
            depositor_usdc: ata(depositor, &USDC),
            owner: *owner,
            owner_shares: ata(owner, &self.share_mint),
            vault: self.vault,
            usdc_mint: USDC,
            idle: self.idle,
            share_mint: self.share_mint,
            token_program: TOKEN_PROGRAM,
        }
        .to_account_metas(None);
        metas.extend(self.nav_accounts());
        Instruction::new_with_bytes(lc::id(), &lc::instruction::Deposit { amount }.data(), metas)
    }

    pub fn open_inbox_ix(&self, payer: &Pubkey, owner: &Pubkey) -> Instruction {
        let inbox = inbox_pda(&self.vault, owner);
        Instruction::new_with_bytes(
            lc::id(),
            &lc::instruction::OpenInbox {}.data(),
            lc::accounts::OpenInbox {
                payer: *payer,
                vault: self.vault,
                usdc_mint: USDC,
                owner: *owner,
                inbox,
                inbox_usdc: ata(&inbox, &USDC),
                token_program: TOKEN_PROGRAM,
                associated_token_program: ATA_PROGRAM,
                system_program: SYSTEM_PROGRAM,
            }
            .to_account_metas(None),
        )
    }

    pub fn sweep_ix(&self, keeper: &Pubkey, owner: &Pubkey) -> Instruction {
        let inbox = inbox_pda(&self.vault, owner);
        let mut metas = lc::accounts::SweepInbox {
            keeper: *keeper,
            keeper_usdc: ata(keeper, &USDC),
            vault: self.vault,
            usdc_mint: USDC,
            inbox,
            inbox_usdc: ata(&inbox, &USDC),
            owner: *owner,
            owner_shares: ata(owner, &self.share_mint),
            idle: self.idle,
            share_mint: self.share_mint,
            token_program: TOKEN_PROGRAM,
            associated_token_program: ATA_PROGRAM,
            system_program: SYSTEM_PROGRAM,
        }
        .to_account_metas(None);
        metas.extend(self.nav_accounts());
        Instruction::new_with_bytes(lc::id(), &lc::instruction::SweepInbox {}.data(), metas)
    }

    pub fn redeem_base(&self, owner: &Pubkey, destination: &Pubkey) -> lc::accounts::RedeemBase {
        let n = self.nav_accounts();
        lc::accounts::RedeemBase {
            owner: *owner,
            owner_shares: ata(owner, &self.share_mint),
            destination: *destination,
            vault: self.vault,
            usdc_mint: USDC,
            idle: self.idle,
            share_mint: self.share_mint,
            kamino_reserve: n[0].pubkey,
            kamino_collateral: n[1].pubkey,
            jlend_lending: n[2].pubkey,
            jlend_ftoken: n[3].pubkey,
            token_program: TOKEN_PROGRAM,
        }
    }

    pub fn redeem_ix(&self, owner: &Pubkey, destination: &Pubkey, shares: u64, min_out: u64) -> Instruction {
        Instruction::new_with_bytes(
            lc::id(),
            &lc::instruction::Redeem { shares, min_out }.data(),
            lc::accounts::Redeem { base: self.redeem_base(owner, destination) }.to_account_metas(None),
        )
    }

    pub fn curator_ix(&self, data: Vec<u8>) -> Instruction {
        Instruction::new_with_bytes(
            lc::id(),
            &data,
            lc::accounts::CuratorOnly { curator: self.admin.pubkey(), vault: self.vault }.to_account_metas(None),
        )
    }
}

pub fn instructions_sysvar() -> Pubkey {
    lc::INSTRUCTIONS_SYSVAR
}

/// Writes one compute-unit measurement to `eval/results/compute/<name>.json`.
pub fn record_cu(name: &str, what: &str, cu: u64) {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../eval/results/compute");
    std::fs::create_dir_all(&dir).unwrap();
    let body = format!("{{
  \"instruction\": \"{name}\",
  \"transaction\": \"{what}\",
  \"compute_units\": {cu}
}}
");
    std::fs::write(dir.join(format!("{name}.json")), body).unwrap();
}
