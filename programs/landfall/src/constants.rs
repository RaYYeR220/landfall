use anchor_lang::prelude::*;

pub const VAULT_SEED: &[u8] = b"vault";
pub const SHARES_SEED: &[u8] = b"shares";
pub const INBOX_SEED: &[u8] = b"inbox";

/// Share token decimals (same as USDC).
pub const SHARE_DECIMALS: u8 = 6;

/// Virtual shares / assets used by the share price formula. Together with the
/// dead shares seeded at `init_vault` they make donation (inflation) attacks
/// unprofitable.
pub const VIRTUAL_SHARES: u128 = 1_000_000;
pub const VIRTUAL_ASSETS: u128 = 1_000_000;

pub const BPS: u128 = 10_000;

/// Strategy identifiers used by `redeem` to choose where a shortfall is pulled from.
pub const SOURCE_IDLE: u8 = 0;
pub const SOURCE_KAMINO: u8 = 1;
pub const SOURCE_JLEND: u8 = 2;

pub const KAMINO_LENDING_PROGRAM: Pubkey = pubkey!("KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD");
pub const JUPITER_LEND_PROGRAM: Pubkey = pubkey!("jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9");
pub const INSTRUCTIONS_SYSVAR: Pubkey = pubkey!("Sysvar1nstructions1111111111111111111111111");
pub const BPF_UPGRADEABLE_LOADER: Pubkey = pubkey!("BPFLoaderUpgradeab1e11111111111111111111111");
