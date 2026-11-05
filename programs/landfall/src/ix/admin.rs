//! Vault creation and admin / curator configuration.

use pinocchio::cpi::{Seed, Signer};
use pinocchio::error::ProgramError;
use pinocchio::{AccountView, Address, ProgramResult};
use pinocchio_associated_token_account::instructions::CreateIdempotent;
use pinocchio_system::instructions::{Allocate, Assign, CreateAccount, Transfer};
use pinocchio_token::instructions::InitializeMint2;

use crate::constants::*;
use crate::error::{require, LandfallError, Result};
use crate::math;
use crate::state::{JlendStrategy, KaminoStrategy, Vault};
use crate::strategies::{jlend::LendingView, kamino::ReserveView};
use crate::token;
use crate::util::*;

/// Creates a PDA even if someone pre-funded its (predictable) address.
pub fn create_pda(payer: &AccountView, target: &AccountView, space: usize, owner: &Address, signers: &[Signer]) -> ProgramResult {
    require(target.owned_by(&SYSTEM_PROGRAM) && target.data_len() == 0, LandfallError::InvalidAccount)?;
    let rent = rent_exempt(space)?;
    if target.lamports() == 0 {
        return CreateAccount { from: payer, to: target, lamports: rent, space: space as u64, owner }.invoke_signed(signers);
    }
    let missing = rent.saturating_sub(target.lamports());
    if missing > 0 {
        Transfer { from: payer, to: target, lamports: missing }.invoke()?;
    }
    Allocate { account: target, space: space as u64 }.invoke_signed(signers)?;
    Assign { account: target, owner }.invoke_signed(signers)
}

fn programs(token: &AccountView, ata: &AccountView, system: &AccountView) -> Result {
    key_is(token, &TOKEN_PROGRAM)?;
    key_is(ata, &ATA_PROGRAM)?;
    key_is(system, &SYSTEM_PROGRAM)
}

/// `admin` must be the upgrade authority recorded in this program's
/// ProgramData (loader state 3: tag u32, slot u64, Option<Pubkey>).
fn require_upgrade_authority(program_data: &AccountView, admin: &Address) -> Result {
    let (expected, _) = find(&[ID.as_ref()], &BPF_UPGRADEABLE_LOADER);
    require(program_data.address() == &expected && program_data.owned_by(&BPF_UPGRADEABLE_LOADER), LandfallError::Unauthorized)?;
    let d = program_data.try_borrow()?;
    require(d.len() >= 45 && d[0..4] == 3u32.to_le_bytes() && d[12] == 1 && &d[13..45] == admin.as_ref(), LandfallError::Unauthorized)
}

/// `[admin, usdc_mint, vault, share_mint, idle, dead_shares, admin_usdc, program_data, token, ata, system]`
/// data: curator, idle_buffer_bps u16, sweep_fee u64, min_sweep u64, seed_amount u64
pub fn init_vault(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [admin, usdc_mint, vault_acc, share_mint, idle, dead_shares, admin_usdc, program_data, token_p, ata_p, system_p, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    let curator = read_key(data, 0)?;
    let idle_buffer_bps = read_u16(data, 32)?;
    let sweep_fee = read_u64(data, 34)?;
    let min_sweep = read_u64(data, 42)?;
    let seed_amount = read_u64(data, 50)?;
    require(idle_buffer_bps as u128 <= BPS && seed_amount > 0, LandfallError::InvalidParams)?;

    signer(admin)?;
    require_upgrade_authority(program_data, admin.address())?;
    programs(token_p, ata_p, system_p)?;
    let usdc = read_mint(usdc_mint)?;

    let (vault_key, vault_bump) = find(&[VAULT_SEED, usdc_mint.address().as_ref()], &ID);
    key_is(vault_acc, &vault_key)?;
    let vb = [vault_bump];
    let vault_seeds = [Seed::from(VAULT_SEED), Seed::from(usdc_mint.address().as_ref()), Seed::from(&vb)];
    create_pda(admin, vault_acc, Vault::LEN, &ID, &[Signer::from(&vault_seeds)])?;

    let (mint_key, mint_bump) = find(&[SHARES_SEED, vault_key.as_ref()], &ID);
    key_is(share_mint, &mint_key)?;
    let mb = [mint_bump];
    let mint_seeds = [Seed::from(SHARES_SEED), Seed::from(vault_key.as_ref()), Seed::from(&mb)];
    create_pda(admin, share_mint, MINT_LEN, &TOKEN_PROGRAM, &[Signer::from(&mint_seeds)])?;
    InitializeMint2::new(share_mint, SHARE_DECIMALS, &vault_key, None).invoke()?;

    // idle = ATA(vault, USDC); dead shares = ATA(vault, share mint). The ATA program checks both addresses.
    CreateIdempotent { funding_account: admin, account: idle, wallet: vault_acc, mint: usdc_mint, system_program: system_p, token_program: token_p }.invoke()?;
    CreateIdempotent { funding_account: admin, account: dead_shares, wallet: vault_acc, mint: share_mint, system_program: system_p, token_program: token_p }.invoke()?;

    let v = Vault {
        admin: *admin.address(),
        curator,
        usdc_mint: *usdc_mint.address(),
        share_mint: mint_key,
        idle: *idle.address(),
        kamino: KaminoStrategy::default(),
        jlend: JlendStrategy::default(),
        idle_buffer_bps,
        sweep_fee,
        min_sweep,
        paused: false,
        landed_total: 0,
        landed_count: 0,
        redeemed_total: 0,
        bump: vault_bump,
        share_mint_bump: mint_bump,
    };
    v.store(vault_acc)?;

    token_of(admin_usdc, usdc_mint.address(), admin.address())?;
    token::transfer(admin_usdc, usdc_mint, idle, admin, seed_amount, usdc.decimals, &[])?;
    let shares = math::shares_for_assets(seed_amount, 0, 0).ok_or(LandfallError::MathOverflow)?;
    token::with_vault_signer(&v, |s| token::mint_to(share_mint, dead_shares, vault_acc, shares, s))
}

fn load_for(role: &AccountView, vault_acc: &AccountView, admin: bool) -> Result<Vault> {
    signer(role)?;
    let v = Vault::load(vault_acc)?;
    require(role.address() == if admin { &v.admin } else { &v.curator }, LandfallError::Unauthorized)?;
    Ok(v)
}

/// `[admin, vault]` data: curator
pub fn set_curator(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [admin, vault_acc, ..] = accounts else { return Err(ProgramError::NotEnoughAccountKeys) };
    let mut v = load_for(admin, vault_acc, true)?;
    v.curator = read_key(data, 0)?;
    v.store(vault_acc)
}

/// `[admin, vault]` data: strategy u8, enabled bool
pub fn set_strategy_enabled(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [admin, vault_acc, ..] = accounts else { return Err(ProgramError::NotEnoughAccountKeys) };
    let mut v = load_for(admin, vault_acc, true)?;
    let enabled = read_u8(data, 1)? == 1;
    match read_u8(data, 0)? {
        SOURCE_KAMINO => v.kamino.enabled = enabled,
        SOURCE_JLEND => v.jlend.enabled = enabled,
        _ => return Err(LandfallError::InvalidSource.into()),
    }
    v.store(vault_acc)
}

/// `[curator, vault]` data: idle_buffer_bps u16, sweep_fee u64, min_sweep u64
pub fn set_params(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [curator, vault_acc, ..] = accounts else { return Err(ProgramError::NotEnoughAccountKeys) };
    let mut v = load_for(curator, vault_acc, false)?;
    let buffer = read_u16(data, 0)?;
    require(buffer as u128 <= BPS, LandfallError::InvalidParams)?;
    v.idle_buffer_bps = buffer;
    v.sweep_fee = read_u64(data, 2)?;
    v.min_sweep = read_u64(data, 10)?;
    v.store(vault_acc)
}

/// `[curator, vault]` data: paused bool
pub fn set_paused(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [curator, vault_acc, ..] = accounts else { return Err(ProgramError::NotEnoughAccountKeys) };
    let mut v = load_for(curator, vault_acc, false)?;
    v.paused = read_u8(data, 0)? == 1;
    v.store(vault_acc)
}

/// `[curator, vault]` data: kamino_bps u16, jlend_bps u16, kamino_cap u64, jlend_cap u64
pub fn set_weights(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [curator, vault_acc, ..] = accounts else { return Err(ProgramError::NotEnoughAccountKeys) };
    let mut v = load_for(curator, vault_acc, false)?;
    let (k, j) = (read_u16(data, 0)?, read_u16(data, 2)?);
    require(k as u128 + j as u128 <= BPS, LandfallError::InvalidParams)?;
    v.kamino.weight_bps = k;
    v.jlend.weight_bps = j;
    v.kamino.cap = read_u64(data, 4)?;
    v.jlend.cap = read_u64(data, 12)?;
    v.store(vault_acc)
}

/// `[admin, vault, usdc_mint, reserve, collateral_mint, collateral_account, token, ata, system]` data: enabled bool
pub fn configure_kamino(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [admin, vault_acc, usdc_mint, reserve, coll_mint, coll_acc, token_p, ata_p, system_p, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    let mut v = load_for(admin, vault_acc, true)?;
    programs(token_p, ata_p, system_p)?;
    key_is(usdc_mint, &v.usdc_mint)?;
    // a configured strategy cannot be re-pointed (funds in the old position would be orphaned)
    require(v.kamino.reserve == Address::default() || &v.kamino.reserve == reserve.address(), LandfallError::InvalidStrategyAccount)?;
    let view = ReserveView::parse(reserve).ok_or(LandfallError::InvalidStrategyAccount)?;
    require(view.liquidity_mint == v.usdc_mint && &view.collateral_mint == coll_mint.address(), LandfallError::InvalidStrategyAccount)?;
    CreateIdempotent { funding_account: admin, account: coll_acc, wallet: vault_acc, mint: coll_mint, system_program: system_p, token_program: token_p }.invoke()?;
    v.kamino.enabled = read_u8(data, 0)? == 1;
    v.kamino.reserve = *reserve.address();
    v.kamino.market = view.lending_market;
    v.kamino.collateral_mint = view.collateral_mint;
    v.kamino.collateral_account = *coll_acc.address();
    v.store(vault_acc)
}

/// `[admin, vault, usdc_mint, lending, ftoken_mint, ftoken_account, token, ata, system]` data: enabled bool
pub fn configure_jlend(accounts: &mut [AccountView], data: &[u8]) -> ProgramResult {
    let [admin, vault_acc, usdc_mint, lending, ft_mint, ft_acc, token_p, ata_p, system_p, ..] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    let mut v = load_for(admin, vault_acc, true)?;
    programs(token_p, ata_p, system_p)?;
    key_is(usdc_mint, &v.usdc_mint)?;
    require(v.jlend.lending == Address::default() || &v.jlend.lending == lending.address(), LandfallError::InvalidStrategyAccount)?;
    let view = LendingView::parse(lending).ok_or(LandfallError::InvalidStrategyAccount)?;
    require(view.mint == v.usdc_mint && &view.ftoken_mint == ft_mint.address(), LandfallError::InvalidStrategyAccount)?;
    CreateIdempotent { funding_account: admin, account: ft_acc, wallet: vault_acc, mint: ft_mint, system_program: system_p, token_program: token_p }.invoke()?;
    v.jlend.enabled = read_u8(data, 0)? == 1;
    v.jlend.lending = *lending.address();
    v.jlend.ftoken_mint = view.ftoken_mint;
    v.jlend.ftoken_account = *ft_acc.address();
    v.store(vault_acc)
}
