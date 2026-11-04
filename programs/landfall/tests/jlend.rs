mod common;
mod strategies;

use common::*;
use solana_keypair::Keypair;
use solana_signer::Signer;
use strategies::*;

fn user(env: &mut Env) -> Keypair {
    let k = Keypair::new();
    env.svm.airdrop(&k.pubkey(), 1_000_000_000).unwrap();
    k
}

fn deposit(env: &mut Env, who: &Keypair, amount: u64) {
    env.fund_usdc(&who.pubkey(), amount);
    let create = env.create_ata_ix(&who.pubkey(), &who.pubkey(), &env.share_mint);
    let ix = env.deposit_ix(&who.pubkey(), &who.pubkey(), amount);
    env.ok(&[create, ix], &[who]);
}

fn lending_view(env: &Env) -> landfall::strategies::jlend::LendingView {
    landfall::strategies::jlend::LendingView::parse_data(&env.svm.get_account(&J_LENDING).unwrap().data).unwrap()
}

fn setup(k_bps: u16, j_bps: u16) -> (Env, Keypair) {
    let mut env = Env::mainnet();
    env.configure_kamino();
    env.configure_jlend();
    env.set_weights(k_bps, j_bps, u64::MAX, u64::MAX);
    let keeper = user(&mut env);
    (env, keeper)
}

#[test]
fn lending_snapshot_parses() {
    let env = Env::mainnet();
    let v = lending_view(&env);
    assert_eq!(v.mint, USDC);
    assert_eq!(v.ftoken_mint, J_FMINT);
    assert!(v.token_exchange_price as u128 > landfall::strategies::jlend::EXCHANGE_PRICE_PRECISION);
}

#[test]
fn allocate_moves_spare_idle_into_jupiter_lend() {
    let (mut env, keeper) = setup(0, 10_000);
    let alice = user(&mut env);
    deposit(&mut env, &alice, 100_000_000);
    let amount = 80_000_000;
    let cu = env.ok(&[env.allocate_jlend_ix(&keeper.pubkey(), amount)], &[&keeper]);
    println!("allocate_jlend CU: {cu}");
    let ftokens = env.token_balance(&ata(&env.vault, &J_FMINT));
    assert!(ftokens > 0);
    let valued = lending_view(&env).assets_for_shares(ftokens).unwrap();
    assert!(valued <= amount && amount - valued <= 2, "valued {valued} vs {amount}");
    assert_eq!(env.vault_state().jlend.cached_value, valued);
}

#[test]
fn curator_split_sixty_forty() {
    let (mut env, keeper) = setup(6_000, 4_000);
    env.ok(
        &[env.curator_ix(anchor_lang::InstructionData::data(&landfall::instruction::SetParams { idle_buffer_bps: 0, sweep_fee: 10_000, min_sweep: 1_000_000 }))],
        &[&env.admin.insecure_clone()],
    );
    let alice = user(&mut env);
    deposit(&mut env, &alice, 99_000_000); // NAV 100 USDC
    // Kamino target 60, Jupiter Lend target 40
    assert!(env.send(&env.allocate_kamino_ixs(&keeper.pubkey(), 61_000_000), &[&keeper]).is_err());
    env.ok(&env.allocate_kamino_ixs(&keeper.pubkey(), 59_000_000), &[&keeper]);
    assert!(env.send(&[env.allocate_jlend_ix(&keeper.pubkey(), 41_000_000)], &[&keeper]).is_err());
    env.ok(&[env.allocate_jlend_ix(&keeper.pubkey(), 39_000_000)], &[&keeper]);
    let v = env.vault_state();
    assert!(v.kamino.cached_value > 58_990_000);
    assert!(v.jlend.cached_value > 38_990_000);
}

#[test]
fn redeem_pulls_shortfall_from_jupiter_lend() {
    let (mut env, keeper) = setup(0, 10_000);
    let alice = user(&mut env);
    deposit(&mut env, &alice, 100_000_000);
    env.ok(&[env.allocate_jlend_ix(&keeper.pubkey(), 90_000_000)], &[&keeper]);
    let shares = env.token_balance(&ata(&alice.pubkey(), &env.share_mint));
    let dest = ata(&alice.pubkey(), &USDC);
    let cu = env.ok(&[env.redeem_via_jlend_ix(&alice.pubkey(), &dest, shares, 99_990_000)], &[&alice]);
    println!("redeem_via_jlend CU: {cu}");
    let got = env.token_balance(&dest);
    assert!(got >= 99_990_000 && got <= 100_000_000, "got {got}");
}

#[test]
fn nav_counts_both_strategies() {
    let (mut env, keeper) = setup(5_000, 5_000);
    let alice = user(&mut env);
    deposit(&mut env, &alice, 100_000_000);
    env.ok(&env.allocate_kamino_ixs(&keeper.pubkey(), 40_000_000), &[&keeper]);
    env.ok(&[env.allocate_jlend_ix(&keeper.pubkey(), 40_000_000)], &[&keeper]);
    // a second depositor gets shares at ~1.0 USDC each (no gain, no loss from allocation)
    let bob = user(&mut env);
    deposit(&mut env, &bob, 10_000_000);
    let bob_shares = env.token_balance(&ata(&bob.pubkey(), &env.share_mint));
    assert!((9_999_990..=10_000_010).contains(&bob_shares), "bob shares {bob_shares}");
}
