//! Landing under adverse conditions: the documented Intents Connect bridge-in
//! recipe for Kamino (`refresh_reserve` + `deposit_reserve_liquidity`) versus
//! the Landfall landing (`deposit`), each assembled the way the Intents
//! Connect relayer assembles a Solana bridge-in transaction: the intermediary
//! runs the steps with `{MIN_AMOUNT_OUT}` = bridged amount − network fee, and
//! the relayer's fee transfer (paid in USDC from the intermediary) is appended.
//!
//! A bridge-in transaction that reverts burns its durable nonce and strands the
//! bridged USDC in the intermediary. Writes `eval/results/landing.json`.

mod common;
mod strategies;

use anchor_lang::{
    prelude::Pubkey,
    solana_program::instruction::{AccountMeta, Instruction},
};
use common::*;
use serde_json::json;
use solana_keypair::Keypair;
use solana_signer::Signer;
use strategies::*;

const BRIDGED: u64 = 25_000_000; // 25 USDC arrives in the intermediary
const NETWORK_FEE: u64 = 40_000; // relayer fee in USDC (docs example)

struct Outcome {
    landed: bool,
    error: Option<String>,
    cu: u64,
    stranded_in_intermediary: u64,
}

fn fee_transfer_ix(intermediary: &Pubkey, fee_payer: &Pubkey) -> Instruction {
    // SPL TransferChecked(amount, decimals)
    let mut data = vec![12u8];
    data.extend_from_slice(&NETWORK_FEE.to_le_bytes());
    data.push(6);
    Instruction {
        program_id: TOKEN_PROGRAM,
        accounts: vec![
            AccountMeta::new(ata(intermediary, &USDC), false),
            AccountMeta::new_readonly(USDC, false),
            AccountMeta::new(ata(fee_payer, &USDC), false),
            AccountMeta::new_readonly(*intermediary, true),
        ],
        data,
    }
}

fn docs_recipe_ixs(intermediary: &Pubkey, amount: u64) -> Vec<Instruction> {
    let mut data = landfall::strategies::kamino::IX_DEPOSIT_RESERVE_LIQUIDITY.to_vec();
    data.extend_from_slice(&amount.to_le_bytes());
    let deposit = Instruction {
        program_id: KLEND,
        accounts: vec![
            AccountMeta::new_readonly(*intermediary, true),
            AccountMeta::new(K_RESERVE, false),
            AccountMeta::new_readonly(K_MARKET, false),
            AccountMeta::new_readonly(K_AUTHORITY, false),
            AccountMeta::new_readonly(USDC, false),
            AccountMeta::new(K_SUPPLY, false),
            AccountMeta::new(K_CMINT, false),
            AccountMeta::new(ata(intermediary, &USDC), false),
            AccountMeta::new(ata(intermediary, &K_CMINT), false),
            AccountMeta::new_readonly(TOKEN_PROGRAM, false),
            AccountMeta::new_readonly(TOKEN_PROGRAM, false),
            AccountMeta::new_readonly(landfall::INSTRUCTIONS_SYSVAR, false),
        ],
        data,
    };
    vec![refresh_reserve_ix(), deposit]
}

/// Builds a fresh mainnet-snapshot vault with 40 USDC already in Kamino, then
/// applies `adverse` to the world before the bridged funds arrive.
fn world(adverse: &dyn Fn(&mut Env)) -> (Env, Keypair, Keypair) {
    let mut env = Env::mainnet();
    env.configure_kamino();
    env.set_weights(10_000, 0, u64::MAX, 0);
    let keeper = Keypair::new();
    env.svm.airdrop(&keeper.pubkey(), 1_000_000_000).unwrap();
    let lp = Keypair::new();
    env.svm.airdrop(&lp.pubkey(), 1_000_000_000).unwrap();
    env.fund_usdc(&lp.pubkey(), 50_000_000);
    let create = env.create_ata_ix(&lp.pubkey(), &lp.pubkey(), &env.share_mint);
    let dep = env.deposit_ix(&lp.pubkey(), &lp.pubkey(), 50_000_000);
    env.ok(&[create, dep], &[&lp]);
    env.ok(&env.allocate_kamino_ixs(&keeper.pubkey(), 40_000_000), &[&keeper]);
    let _ = env.send(&[env.sync_nav_ix()], &[&keeper]);

    let intermediary = Keypair::new();
    let fee_payer = Keypair::new();
    env.svm.airdrop(&fee_payer.pubkey(), 1_000_000_000).unwrap();
    env.fund_usdc(&intermediary.pubkey(), BRIDGED);
    env.fund_usdc(&fee_payer.pubkey(), 0);
    // ATAs the relayer would provision: intermediary's cUSDC (docs) and lfUSDC (Landfall)
    let (i, f) = (intermediary.pubkey(), fee_payer.pubkey());
    let c1 = env.create_ata_ix(&f, &i, &K_CMINT);
    let c2 = env.create_ata_ix(&f, &i, &env.share_mint);
    env.ok(&[c1, c2], &[&fee_payer]);
    adverse(&mut env);
    (env, intermediary, fee_payer)
}

fn run(env: &mut Env, mut steps: Vec<Instruction>, intermediary: &Keypair, fee_payer: &Keypair) -> Outcome {
    steps.push(fee_transfer_ix(&intermediary.pubkey(), &fee_payer.pubkey()));
    let before = env.token_balance(&ata(&intermediary.pubkey(), &USDC));
    let r = env.send(&steps, &[fee_payer, intermediary]);
    let after = env.token_balance(&ata(&intermediary.pubkey(), &USDC));
    match r {
        Ok(meta) => Outcome { landed: true, error: None, cu: meta.compute_units_consumed, stranded_in_intermediary: after },
        Err(e) => {
            let msg = e
                .meta
                .logs
                .iter()
                .rev()
                .find(|l| l.contains("Error") || l.contains("failed"))
                .cloned()
                .unwrap_or_else(|| format!("{:?}", e.err));
            Outcome { landed: false, error: Some(msg), cu: e.meta.compute_units_consumed, stranded_in_intermediary: before }
        }
    }
}

struct Scenario {
    id: &'static str,
    what: &'static str,
    adverse: Box<dyn Fn(&mut Env)>,
}

fn scenarios() -> Vec<Scenario> {
    vec![
        Scenario { id: "healthy", what: "Normal conditions (negative control: both must land)", adverse: Box::new(|_| {}) },
        Scenario {
            id: "deposit_limit_reached",
            what: "Kamino USDC reserve is at its deposit limit when the bridged funds arrive",
            adverse: Box::new(|env| {
                let v = landfall::strategies::kamino::ReserveView::parse_data(&env.svm.get_account(&K_RESERVE).unwrap().data).unwrap();
                let total = v.total_liquidity as u64;
                env.patch_account(&K_RESERVE, |a| a.data[5016..5024].copy_from_slice(&total.to_le_bytes()));
            }),
        },
        Scenario {
            id: "usdc_outside_price_band",
            what: "USDC prints outside the reserve's accepted price band (0.98–1.01), e.g. a depeg wobble",
            adverse: Box::new(|env| {
                // raise the band floor above the current price: refresh_reserve must reject the price
                env.patch_account(&K_RESERVE, |a| a.data[5064..5072].copy_from_slice(&102u64.to_le_bytes()));
            }),
        },
        Scenario {
            id: "oracle_stale",
            what: "No fresh Scope price for 10 minutes (reserve max price age is 180 s)",
            adverse: Box::new(|env| advance(env, 600, 1_500)),
        },
        Scenario {
            id: "market_emergency_mode",
            what: "Kamino main market switches to emergency mode",
            adverse: Box::new(|env| env.patch_account(&K_MARKET, |a| a.data[122] = 1)),
        },
        Scenario {
            id: "reserve_not_active",
            what: "The USDC reserve is marked obsolete (status ≠ active)",
            adverse: Box::new(|env| env.patch_account(&K_RESERVE, |a| a.data[4856] = 1)),
        },
        Scenario {
            id: "reserve_layout_changed",
            what: "A protocol upgrade leaves the reserve account unreadable to integrators",
            adverse: Box::new(|env| env.patch_account(&K_RESERVE, |a| a.data.truncate(4000))),
        },
    ]
}

#[test]
fn landing_under_adverse_conditions() {
    let mut rows = Vec::new();
    let (mut docs_landed, mut lf_landed) = (0, 0);
    let all = scenarios();
    for s in &all {
        let amount = BRIDGED - NETWORK_FEE; // {MIN_AMOUNT_OUT}
        let (mut env_a, im_a, fp_a) = world(&*s.adverse);
        let docs = run(&mut env_a, docs_recipe_ixs(&im_a.pubkey(), amount), &im_a, &fp_a);

        let (mut env_b, im_b, fp_b) = world(&*s.adverse);
        let dep = env_b.deposit_ix(&im_b.pubkey(), &im_b.pubkey(), amount);
        let lf = run(&mut env_b, vec![dep], &im_b, &fp_b);
        let shares = env_b.token_balance(&ata(&im_b.pubkey(), &env_b.share_mint));

        docs_landed += docs.landed as u32;
        lf_landed += lf.landed as u32;
        println!(
            "{:<26} docs recipe: {:<8} landfall: {:<8} {}",
            s.id,
            if docs.landed { "LANDED" } else { "REVERTED" },
            if lf.landed { "LANDED" } else { "REVERTED" },
            docs.error.clone().unwrap_or_default()
        );
        rows.push(json!({
            "id": s.id,
            "scenario": s.what,
            "docs_recipe": {
                "landed": docs.landed, "error": docs.error, "compute_units": docs.cu,
                "usdc_left_in_intermediary": docs.stranded_in_intermediary,
            },
            "landfall": {
                "landed": lf.landed, "error": lf.error, "compute_units": lf.cu,
                "usdc_left_in_intermediary": lf.stranded_in_intermediary, "shares_minted": shares,
            },
        }));
        assert!(lf.landed, "Landfall failed to land in {}", s.id);
        if s.id == "healthy" {
            assert!(docs.landed, "negative control broken: docs recipe must land in healthy conditions");
        }
    }
    let out = json!({
        "description": "Solana bridge-in landing transaction (Intents Connect shape) under adverse lending-market conditions. Mainnet snapshot, LiteSVM.",
        "bridged_usdc": BRIDGED, "network_fee_usdc": NETWORK_FEE,
        "scenarios": all.len(),
        "docs_recipe_landed": docs_landed,
        "landfall_landed": lf_landed,
        "results": rows,
    });
    let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../eval/results");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("landing.json"), serde_json::to_string_pretty(&out).unwrap()).unwrap();
    println!("docs recipe landed {docs_landed}/{} · Landfall landed {lf_landed}/{}", all.len(), all.len());
}
