mod common;

use anchor_lang::{prelude::Pubkey, InstructionData};
use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;

fn user(env: &mut Env, usdc: u64) -> Keypair {
    let k = Keypair::new();
    env.svm.airdrop(&k.pubkey(), 1_000_000_000).unwrap();
    env.fund_usdc(&k.pubkey(), usdc);
    k
}

fn shares_of(env: &Env, owner: &Pubkey) -> u64 {
    env.token_balance(&ata(owner, &env.share_mint))
}

#[test]
fn init_seeds_dead_shares() {
    let env = Env::new();
    assert_eq!(env.token_balance(&env.idle), 1_000_000);
    assert_eq!(env.mint_supply(&env.share_mint), 1_000_000);
    assert_eq!(env.token_balance(&ata(&env.vault, &env.share_mint)), 1_000_000);
}

#[test]
fn deposit_mints_at_nav() {
    let mut env = Env::new();
    let alice = user(&mut env, 25_000_000);
    let create = env.create_ata_ix(&alice.pubkey(), &alice.pubkey(), &env.share_mint);
    let ix = env.deposit_ix(&alice.pubkey(), &alice.pubkey(), 25_000_000);
    let cu = env.ok(&[create, ix], &[&alice]);
    // NAV 1 USDC / supply 1 share → 1:1
    assert_eq!(shares_of(&env, &alice.pubkey()), 25_000_000);
    assert_eq!(env.token_balance(&env.idle), 26_000_000);
    let v = env.vault_state();
    assert_eq!(v.landed_total, 25_000_000);
    assert_eq!(v.landed_count, 1);
    println!("deposit+create_ata CU: {cu}");
}

#[test]
fn deposit_cu_is_small() {
    let mut env = Env::new();
    let alice = user(&mut env, 5_000_000);
    let create = env.create_ata_ix(&alice.pubkey(), &alice.pubkey(), &env.share_mint);
    env.ok(&[create], &[&alice]);
    let cu = env.ok(&[env.deposit_ix(&alice.pubkey(), &alice.pubkey(), 5_000_000)], &[&alice]);
    println!("deposit CU: {cu}");
    assert!(cu < 40_000, "deposit used {cu} CU");
}

#[test]
fn deposit_to_another_owner() {
    let mut env = Env::new();
    let payer = user(&mut env, 3_000_000);
    let owner = Pubkey::new_unique();
    let create = env.create_ata_ix(&payer.pubkey(), &owner, &env.share_mint);
    env.ok(&[create, env.deposit_ix(&payer.pubkey(), &owner, 3_000_000)], &[&payer]);
    assert_eq!(shares_of(&env, &owner), 3_000_000);
    assert_eq!(shares_of(&env, &payer.pubkey()), 0);
}

#[test]
fn zero_deposit_is_noop() {
    let mut env = Env::new();
    let alice = Keypair::new();
    env.svm.airdrop(&alice.pubkey(), 1_000_000_000).unwrap();
    env.set_token(&ata(&alice.pubkey(), &USDC), &USDC, &alice.pubkey(), 0);
    let create = env.create_ata_ix(&alice.pubkey(), &alice.pubkey(), &env.share_mint);
    env.ok(&[create, env.deposit_ix(&alice.pubkey(), &alice.pubkey(), 0)], &[&alice]);
    assert_eq!(env.vault_state().landed_count, 0);
    // amount above balance on an empty account is also a no-op, not a failure
    env.ok(&[env.deposit_ix(&alice.pubkey(), &alice.pubkey(), 7)], &[&alice]);
    assert_eq!(env.vault_state().landed_count, 0);
}

#[test]
fn max_amount_deposits_whole_balance() {
    let mut env = Env::new();
    let alice = user(&mut env, 4_200_000);
    let create = env.create_ata_ix(&alice.pubkey(), &alice.pubkey(), &env.share_mint);
    env.ok(&[create, env.deposit_ix(&alice.pubkey(), &alice.pubkey(), u64::MAX)], &[&alice]);
    assert_eq!(env.token_balance(&ata(&alice.pubkey(), &USDC)), 0);
    assert_eq!(shares_of(&env, &alice.pubkey()), 4_200_000);
}

#[test]
fn paused_vault_still_lands() {
    let mut env = Env::new();
    let pause = env.curator_ix(landfall::instruction::SetPaused { paused: true }.data());
    let admin = env.admin.insecure_clone();
    env.ok(&[pause], &[&admin]);
    assert!(env.vault_state().paused);
    let alice = user(&mut env, 2_000_000);
    let create = env.create_ata_ix(&alice.pubkey(), &alice.pubkey(), &env.share_mint);
    env.ok(&[create, env.deposit_ix(&alice.pubkey(), &alice.pubkey(), 2_000_000)], &[&alice]);
    assert_eq!(shares_of(&env, &alice.pubkey()), 2_000_000);
}

#[test]
fn missing_valuation_accounts_do_not_block_a_landing() {
    let mut env = Env::new();
    let alice = user(&mut env, 2_000_000);
    let create = env.create_ata_ix(&alice.pubkey(), &alice.pubkey(), &env.share_mint);
    let mut ix = env.deposit_ix(&alice.pubkey(), &alice.pubkey(), 2_000_000);
    ix.accounts.truncate(9); // drop the four valuation accounts
    env.ok(&[create, ix], &[&alice]);
    assert_eq!(shares_of(&env, &alice.pubkey()), 2_000_000);
}

#[test]
fn inbox_is_owner_scoped_and_idempotent() {
    let mut env = Env::new();
    let payer = user(&mut env, 0);
    let owner = Pubkey::new_unique();
    let ix = env.open_inbox_ix(&payer.pubkey(), &owner);
    env.ok(&[ix.clone()], &[&payer]);
    env.svm.expire_blockhash();
    env.ok(&[ix], &[&payer]);
    let inbox = env.inbox_state(&owner);
    assert_eq!(inbox.owner, owner);
    assert_eq!(inbox.vault, env.vault);
    assert_ne!(inbox_pda(&env.vault, &owner), inbox_pda(&env.vault, &Pubkey::new_unique()));
}

#[test]
fn sweep_pays_fee_and_mints_to_owner() {
    let mut env = Env::new();
    let keeper = user(&mut env, 0);
    let owner = Pubkey::new_unique();
    env.ok(&[env.open_inbox_ix(&keeper.pubkey(), &owner)], &[&keeper]);
    // a persistent deposit address delivers 12.5 USDC to the inbox
    let inbox = inbox_pda(&env.vault, &owner);
    env.set_token(&ata(&inbox, &USDC), &USDC, &inbox, 12_500_000);
    let cu = env.ok(&[env.sweep_ix(&keeper.pubkey(), &owner)], &[&keeper]);
    println!("sweep CU (incl. share ATA create): {cu}");
    assert_eq!(env.token_balance(&ata(&inbox, &USDC)), 0);
    assert_eq!(env.token_balance(&ata(&keeper.pubkey(), &USDC)), 10_000); // fee 0.01 USDC
    assert_eq!(shares_of(&env, &owner), 12_490_000);
    let st = env.inbox_state(&owner);
    assert_eq!(st.swept_total, 12_490_000);
    assert_eq!(st.sweep_count, 1);
}

#[test]
fn sweep_fee_is_capped_at_one_percent() {
    let mut env = Env::new();
    let keeper = user(&mut env, 0);
    let owner = Pubkey::new_unique();
    let set = env.curator_ix(landfall::instruction::SetParams { idle_buffer_bps: 1_000, sweep_fee: 50_000, min_sweep: 1_000_000 }.data());
    let admin = env.admin.insecure_clone();
    env.ok(&[set], &[&admin]);
    env.ok(&[env.open_inbox_ix(&keeper.pubkey(), &owner)], &[&keeper]);
    let inbox = inbox_pda(&env.vault, &owner);
    env.set_token(&ata(&inbox, &USDC), &USDC, &inbox, 2_000_000);
    env.ok(&[env.sweep_ix(&keeper.pubkey(), &owner)], &[&keeper]);
    assert_eq!(env.token_balance(&ata(&keeper.pubkey(), &USDC)), 20_000);
}

#[test]
fn sweep_below_min_errors_and_moves_nothing() {
    let mut env = Env::new();
    let keeper = user(&mut env, 0);
    let owner = Pubkey::new_unique();
    env.ok(&[env.open_inbox_ix(&keeper.pubkey(), &owner)], &[&keeper]);
    let inbox = inbox_pda(&env.vault, &owner);
    env.set_token(&ata(&inbox, &USDC), &USDC, &inbox, 999_999);
    assert!(env.send(&[env.sweep_ix(&keeper.pubkey(), &owner)], &[&keeper]).is_err());
    assert_eq!(env.token_balance(&ata(&inbox, &USDC)), 999_999);
}

#[test]
fn sweep_cannot_credit_a_different_owner() {
    let mut env = Env::new();
    let keeper = user(&mut env, 0);
    let owner = Pubkey::new_unique();
    let thief = Pubkey::new_unique();
    env.ok(&[env.open_inbox_ix(&keeper.pubkey(), &owner)], &[&keeper]);
    let inbox = inbox_pda(&env.vault, &owner);
    env.set_token(&ata(&inbox, &USDC), &USDC, &inbox, 5_000_000);
    let mut ix = env.sweep_ix(&keeper.pubkey(), &owner);
    // swap the owner + owner_shares accounts for the thief's
    ix.accounts[6].pubkey = thief;
    ix.accounts[7].pubkey = ata(&thief, &env.share_mint);
    assert!(env.send(&[ix], &[&keeper]).is_err());
    assert_eq!(env.token_balance(&ata(&inbox, &USDC)), 5_000_000);
}

#[test]
fn redeem_from_idle_pays_owner() {
    let mut env = Env::new();
    let alice = user(&mut env, 10_000_000);
    let create = env.create_ata_ix(&alice.pubkey(), &alice.pubkey(), &env.share_mint);
    env.ok(&[create, env.deposit_ix(&alice.pubkey(), &alice.pubkey(), 10_000_000)], &[&alice]);
    let dest = ata(&alice.pubkey(), &USDC);
    env.ok(&[env.redeem_ix(&alice.pubkey(), &dest, 4_000_000, 4_000_000)], &[&alice]);
    assert_eq!(env.token_balance(&dest), 4_000_000);
    assert_eq!(shares_of(&env, &alice.pubkey()), 6_000_000);
    assert_eq!(env.vault_state().redeemed_total, 4_000_000);
}

#[test]
fn redeem_respects_min_out() {
    let mut env = Env::new();
    let alice = user(&mut env, 10_000_000);
    let create = env.create_ata_ix(&alice.pubkey(), &alice.pubkey(), &env.share_mint);
    env.ok(&[create, env.deposit_ix(&alice.pubkey(), &alice.pubkey(), 10_000_000)], &[&alice]);
    let dest = ata(&alice.pubkey(), &USDC);
    assert!(env.send(&[env.redeem_ix(&alice.pubkey(), &dest, 4_000_000, 4_000_001)], &[&alice]).is_err());
    assert_eq!(shares_of(&env, &alice.pubkey()), 10_000_000);
}

#[test]
fn only_owner_redeems() {
    let mut env = Env::new();
    let alice = user(&mut env, 10_000_000);
    let mallory = user(&mut env, 0);
    let create = env.create_ata_ix(&alice.pubkey(), &alice.pubkey(), &env.share_mint);
    env.ok(&[create, env.deposit_ix(&alice.pubkey(), &alice.pubkey(), 10_000_000)], &[&alice]);
    let mut ix = env.redeem_ix(&mallory.pubkey(), &ata(&mallory.pubkey(), &USDC), 1_000_000, 0);
    ix.accounts[1].pubkey = ata(&alice.pubkey(), &env.share_mint); // alice's shares, mallory signs
    assert!(env.send(&[ix], &[&mallory]).is_err());
    assert_eq!(shares_of(&env, &alice.pubkey()), 10_000_000);
}

#[test]
fn donation_cannot_zero_out_depositor() {
    let mut env = Env::new();
    // attacker donates 1,000 USDC straight to the vault's idle account
    let idle = env.idle;
    let vault = env.vault;
    let current = env.token_balance(&idle);
    env.set_token(&idle, &USDC, &vault, current + 1_000_000_000);
    let alice = user(&mut env, 1_000_000);
    let create = env.create_ata_ix(&alice.pubkey(), &alice.pubkey(), &env.share_mint);
    env.ok(&[create, env.deposit_ix(&alice.pubkey(), &alice.pubkey(), 1_000_000)], &[&alice]);
    let s = shares_of(&env, &alice.pubkey());
    assert!(s > 0, "victim got 0 shares");
    let dest = ata(&alice.pubkey(), &USDC);
    env.ok(&[env.redeem_ix(&alice.pubkey(), &dest, s, 0)], &[&alice]);
    let back = env.token_balance(&dest);
    assert!(back >= 990_000, "victim got back {back}");
}

#[test]
fn non_curator_cannot_pause() {
    let mut env = Env::new();
    let mallory = user(&mut env, 0);
    let mut ix = env.curator_ix(landfall::instruction::SetPaused { paused: true }.data());
    ix.accounts[0].pubkey = mallory.pubkey();
    assert!(env.send(&[ix], &[&mallory]).is_err());
    assert!(!env.vault_state().paused);
}
