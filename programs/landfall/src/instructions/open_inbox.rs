use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::constants::*;
use crate::events::InboxOpened;
use crate::state::{Inbox, Vault};

/// Creates (idempotently) the owner's inbox and its USDC account. The USDC
/// account is the recipient of the owner's persistent deposit addresses.
#[derive(Accounts)]
pub struct OpenInbox<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(has_one = usdc_mint)]
    pub vault: Box<Account<'info, Vault>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    /// CHECK: any pubkey may own an inbox (a wallet or an Intents Connect intermediary).
    pub owner: UncheckedAccount<'info>,
    #[account(
        init_if_needed,
        payer = payer,
        space = 8 + Inbox::INIT_SPACE,
        seeds = [INBOX_SEED, vault.key().as_ref(), owner.key().as_ref()],
        bump
    )]
    pub inbox: Box<Account<'info, Inbox>>,
    #[account(
        init_if_needed,
        payer = payer,
        associated_token::mint = usdc_mint,
        associated_token::authority = inbox,
    )]
    pub inbox_usdc: Box<Account<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<OpenInbox>) -> Result<()> {
    let inbox = &mut ctx.accounts.inbox;
    if inbox.owner == Pubkey::default() {
        inbox.vault = ctx.accounts.vault.key();
        inbox.owner = ctx.accounts.owner.key();
        inbox.created_slot = Clock::get()?.slot;
        inbox.bump = ctx.bumps.inbox;
        emit!(InboxOpened {
            vault: inbox.vault,
            owner: inbox.owner,
            inbox: inbox.key(),
        });
    }
    Ok(())
}
