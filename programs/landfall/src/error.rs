use pinocchio::error::ProgramError;

/// Custom errors, numbered from 6000 like Anchor programs so clients that
/// map Anchor error codes keep working.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum LandfallError {
    Unauthorized = 6000,
    InvalidParams,
    BelowMinSweep,
    Paused,
    StrategyDisabled,
    AllocationExceedsTarget,
    InsufficientIdle,
    InsufficientLiquidity,
    SlippageExceeded,
    InvalidStrategyAccount,
    StrategyValuationUnavailable,
    MathOverflow,
    InvalidSource,
    VaultInMaintenance,
    InvalidAccount,
    InvalidInstruction,
}

impl From<LandfallError> for ProgramError {
    fn from(e: LandfallError) -> Self {
        ProgramError::Custom(e as u32)
    }
}

pub type Result<T = ()> = core::result::Result<T, ProgramError>;

#[inline(always)]
pub fn require(cond: bool, e: LandfallError) -> Result {
    if cond {
        Ok(())
    } else {
        Err(e.into())
    }
}
