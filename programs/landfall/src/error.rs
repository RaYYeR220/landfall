use anchor_lang::prelude::*;

#[error_code]
pub enum LandfallError {
    #[msg("Signer is not allowed to perform this action")]
    Unauthorized,
    #[msg("Invalid vault parameters")]
    InvalidParams,
    #[msg("Inbox balance is below the minimum sweep amount")]
    BelowMinSweep,
    #[msg("Vault is paused for allocations")]
    Paused,
    #[msg("Strategy is not configured or not enabled")]
    StrategyDisabled,
    #[msg("Allocation would exceed the strategy target weight or cap")]
    AllocationExceedsTarget,
    #[msg("Not enough idle liquidity above the buffer")]
    InsufficientIdle,
    #[msg("Not enough liquidity in the selected source to cover the redemption")]
    InsufficientLiquidity,
    #[msg("Redeemed amount is below the requested minimum")]
    SlippageExceeded,
    #[msg("A strategy account does not match the vault configuration")]
    InvalidStrategyAccount,
    #[msg("Strategy accounts must be provided and valid for this instruction")]
    StrategyValuationUnavailable,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Unknown redemption source")]
    InvalidSource,
}
