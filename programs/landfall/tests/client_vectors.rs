//! Writes the program's own (Anchor-generated) account metas and instruction
//! data for every instruction into `packages/sdk/test/vectors.json`, so the
//! TypeScript SDK is checked byte-for-byte against the program interface.

mod common;
mod strategies;

use anchor_lang::{prelude::Pubkey, solana_program::instruction::Instruction, InstructionData, ToAccountMetas};
use common::*;
use serde_json::{json, Value};
use solana_keypair::Keypair;
use solana_signer::Signer;
use strategies::*;

fn enc(ix: &Instruction) -> Value {
    json!({
        "data": ix.data.iter().map(|b| format!("{b:02x}")).collect::<String>(),
        "keys": ix.accounts.iter().map(|m| json!([m.pubkey.to_string(), m.is_signer, m.is_writable])).collect::<Vec<_>>(),
    })
}

#[test]
fn write_client_vectors() {
    let mut env = Env::mainnet();
    env.configure_kamino();
    env.configure_jlend();
    let user = Pubkey::new_from_array([7u8; 32]);
    let owner = Pubkey::new_from_array([9u8; 32]);
    let keeper = Pubkey::new_from_array([11u8; 32]);
    let dest = ata(&user, &USDC);
    let admin = env.admin.pubkey();

    let mut v = serde_json::Map::new();
    v.insert("admin".into(), json!(admin.to_string()));
    v.insert("user".into(), json!(user.to_string()));
    v.insert("owner".into(), json!(owner.to_string()));
    v.insert("keeper".into(), json!(keeper.to_string()));
    v.insert("deposit".into(), enc(&env.deposit_ix(&user, &owner, 1_234_567)));
    v.insert("open_inbox".into(), enc(&env.open_inbox_ix(&keeper, &owner)));
    v.insert("sweep_inbox".into(), enc(&env.sweep_ix(&keeper, &owner)));
    v.insert("allocate_kamino".into(), enc(&env.allocate_kamino_ixs(&keeper, 5_000_000)[1]));
    v.insert("allocate_jlend".into(), enc(&env.allocate_jlend_ix(&keeper, 4_000_000)));
    v.insert("sync_nav".into(), enc(&env.sync_nav_ix()));
    v.insert("redeem".into(), enc(&env.redeem_ix(&user, &dest, 3_000_000, 2_990_000)));
    v.insert("redeem_via_kamino".into(), enc(&env.redeem_via_kamino_ixs(&user, &dest, 3_000_000, 2_990_000)[1]));
    v.insert("redeem_via_jlend".into(), enc(&env.redeem_via_jlend_ix(&user, &dest, 3_000_000, 2_990_000)));
    v.insert("refresh_reserve".into(), enc(&refresh_reserve_ix()));
    let set_weights = env.curator_ix(landfall::instruction::SetWeights { kamino_bps: 6000, jlend_bps: 4000, kamino_cap: 77, jlend_cap: 88 }.data());
    v.insert("set_weights".into(), enc(&set_weights));

    let init = Instruction::new_with_bytes(
        landfall::id(),
        &landfall::instruction::InitVault {
            params: landfall::InitVaultParams { curator: admin, idle_buffer_bps: 1000, sweep_fee: 10_000, min_sweep: 1_000_000, seed_amount: 1_000_000 },
        }
        .data(),
        landfall::accounts::InitVault {
            admin,
            usdc_mint: USDC,
            vault: env.vault,
            share_mint: env.share_mint,
            idle: env.idle,
            dead_shares: ata(&env.vault, &env.share_mint),
            admin_usdc: ata(&admin, &USDC),
            token_program: TOKEN_PROGRAM,
            associated_token_program: ATA_PROGRAM,
            system_program: SYSTEM_PROGRAM,
        }
        .to_account_metas(None),
    );
    v.insert("init_vault".into(), enc(&init));
    let _ = Keypair::new();

    let out = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../packages/sdk/test/vectors.json");
    std::fs::write(out, serde_json::to_string_pretty(&Value::Object(v)).unwrap()).unwrap();
}
