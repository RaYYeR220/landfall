use anchor_lang::prelude::*;
use anchor_lang::system_program::{allocate, assign, create_account, transfer, Allocate, Assign, CreateAccount, Transfer};
use anchor_spl::associated_token::{self, AssociatedToken, Create};
use anchor_spl::token::{self, InitializeMint2, Mint, MintTo, Token, TokenAccount, TransferChecked};

use crate::constants::*;
use crate::error::LandfallError;
use crate::math;
use crate::state::Vault;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct InitVaultParams {
    pub curator: Pubkey,
    pub idle_buffer_bps: u16,
    pub sweep_fee: u64,
    pub min_sweep: u64,
    /// USDC moved from the admin into the vault as permanently locked dead shares.
    pub seed_amount: u64,
}

#[derive(Accounts)]
pub struct InitVault<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    #[account(
        init,
        payer = admin,
        space = 8 + Vault::INIT_SPACE,
        seeds = [VAULT_SEED, usdc_mint.key().as_ref()],
        bump
    )]
    pub vault: Box<Account<'info, Vault>>,
    /// CHECK: created and initialised in the handler as a classic SPL mint (PDA).
    #[account(mut, seeds = [SHARES_SEED, vault.key().as_ref()], bump)]
    pub share_mint: UncheckedAccount<'info>,
    #[account(
        init,
        payer = admin,
        associated_token::mint = usdc_mint,
        associated_token::authority = vault,
    )]
    pub idle: Box<Account<'info, TokenAccount>>,
    /// CHECK: ATA(vault, share_mint), created in the handler. Holds the seed
    /// shares forever: no instruction lets the vault redeem its own shares.
    #[account(mut)]
    pub dead_shares: UncheckedAccount<'info>,
    #[account(mut, token::mint = usdc_mint, token::authority = admin)]
    pub admin_usdc: Box<Account<'info, TokenAccount>>,
    /// CHECK: this program's ProgramData account; `admin` must be its upgrade
    /// authority, so only the deployer can create the canonical vault.
    pub program_data: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

/// Requires `admin` to be the upgrade authority recorded in this program's
/// ProgramData (BPF upgradeable loader state 3: tag u32, slot u64, Option<Pubkey>).
fn require_upgrade_authority(program_data: &AccountInfo, admin: &Pubkey) -> Result<()> {
    let (expected, _) = Pubkey::find_program_address(&[crate::ID.as_ref()], &BPF_UPGRADEABLE_LOADER);
    require_keys_eq!(program_data.key(), expected, LandfallError::Unauthorized);
    require_keys_eq!(*program_data.owner, BPF_UPGRADEABLE_LOADER, LandfallError::Unauthorized);
    let d = program_data.try_borrow_data()?;
    require!(d.len() >= 45 && d[0..4] == 3u32.to_le_bytes() && d[12] == 1, LandfallError::Unauthorized);
    require!(&d[13..45] == admin.as_ref(), LandfallError::Unauthorized);
    Ok(())
}

pub fn handler(ctx: Context<InitVault>, params: InitVaultParams) -> Result<()> {
    require_upgrade_authority(&ctx.accounts.program_data.to_account_info(), &ctx.accounts.admin.key())?;
    require!(params.idle_buffer_bps as u128 <= BPS, LandfallError::InvalidParams);
    require!(params.seed_amount > 0, LandfallError::InvalidParams);

    let vault = &mut ctx.accounts.vault;
    vault.admin = ctx.accounts.admin.key();
    vault.curator = params.curator;
    vault.usdc_mint = ctx.accounts.usdc_mint.key();
    vault.share_mint = ctx.accounts.share_mint.key();
    vault.idle = ctx.accounts.idle.key();
    vault.idle_buffer_bps = params.idle_buffer_bps;
    vault.sweep_fee = params.sweep_fee;
    vault.min_sweep = params.min_sweep;
    vault.paused = false;
    vault.bump = ctx.bumps.vault;
    vault.share_mint_bump = ctx.bumps.share_mint;

    token::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.admin_usdc.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.idle.to_account_info(),
                authority: ctx.accounts.admin.to_account_info(),
            },
        ),
        params.seed_amount,
        ctx.accounts.usdc_mint.decimals,
    )?;

    // Share mint: classic SPL mint at a PDA, authority = vault.
    let vault_key = ctx.accounts.vault.key();
    let mint_bump = [ctx.bumps.share_mint];
    let mint_seeds: &[&[u8]] = &[SHARES_SEED, vault_key.as_ref(), &mint_bump];
    // Works even if someone pre-funded the predictable mint address.
    let space = Mint::LEN;
    let rent = Rent::get()?.minimum_balance(space);
    let mint_info = ctx.accounts.share_mint.to_account_info();
    let sys = ctx.accounts.system_program.key();
    if mint_info.lamports() == 0 {
        create_account(
            CpiContext::new_with_signer(sys, CreateAccount { from: ctx.accounts.admin.to_account_info(), to: mint_info.clone() }, &[mint_seeds]),
            rent,
            space as u64,
            &ctx.accounts.token_program.key(),
        )?;
    } else {
        let missing = rent.saturating_sub(mint_info.lamports());
        if missing > 0 {
            transfer(CpiContext::new(sys, Transfer { from: ctx.accounts.admin.to_account_info(), to: mint_info.clone() }), missing)?;
        }
        allocate(CpiContext::new_with_signer(sys, Allocate { account_to_allocate: mint_info.clone() }, &[mint_seeds]), space as u64)?;
        assign(CpiContext::new_with_signer(sys, Assign { account_to_assign: mint_info.clone() }, &[mint_seeds]), &ctx.accounts.token_program.key())?;
    }
    token::initialize_mint2(
        CpiContext::new(ctx.accounts.token_program.key(), InitializeMint2 { mint: ctx.accounts.share_mint.to_account_info() }),
        SHARE_DECIMALS,
        &vault_key,
        None,
    )?;
    associated_token::create(CpiContext::new(
        ctx.accounts.associated_token_program.key(),
        Create {
            payer: ctx.accounts.admin.to_account_info(),
            associated_token: ctx.accounts.dead_shares.to_account_info(),
            authority: ctx.accounts.vault.to_account_info(),
            mint: ctx.accounts.share_mint.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            token_program: ctx.accounts.token_program.to_account_info(),
        },
    ))?;

    let shares = math::shares_for_assets(params.seed_amount, 0, 0).ok_or(LandfallError::MathOverflow)?;
    let usdc_key = ctx.accounts.usdc_mint.key();
    let seeds: &[&[u8]] = &[VAULT_SEED, usdc_key.as_ref(), &[ctx.bumps.vault]];
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.share_mint.to_account_info(),
                to: ctx.accounts.dead_shares.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            &[seeds],
        ),
        shares,
    )?;
    Ok(())
}
