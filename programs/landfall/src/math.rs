use crate::constants::{VIRTUAL_ASSETS, VIRTUAL_SHARES};

/// Shares minted for `assets` deposited into a vault holding `nav` assets with
/// `supply` shares outstanding. Rounds down (in favour of the vault).
pub fn shares_for_assets(assets: u64, supply: u64, nav: u64) -> Option<u64> {
    let num = (assets as u128).checked_mul(supply as u128 + VIRTUAL_SHARES)?;
    u64::try_from(num / (nav as u128 + VIRTUAL_ASSETS)).ok()
}

/// Assets paid out for burning `shares`. Rounds down (in favour of the vault).
pub fn assets_for_shares(shares: u64, supply: u64, nav: u64) -> Option<u64> {
    let num = (shares as u128).checked_mul(nav as u128 + VIRTUAL_ASSETS)?;
    u64::try_from(num / (supply as u128 + VIRTUAL_SHARES)).ok()
}

/// `value * bps / 10_000`, rounded down.
pub fn bps_of(value: u64, bps: u16) -> u64 {
    ((value as u128 * bps as u128) / 10_000u128) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_deposit_is_one_to_one() {
        assert_eq!(shares_for_assets(5_000_000, 0, 0), Some(5_000_000));
    }

    #[test]
    fn round_trip_never_pays_more_than_deposited() {
        let (supply, nav) = (1_234_567_890u64, 1_300_000_000u64);
        let a = 7_777_777u64;
        let s = shares_for_assets(a, supply, nav).unwrap();
        let back = assets_for_shares(s, supply + s, nav + a).unwrap();
        assert!(back <= a && a - back <= 2);
    }

    #[test]
    fn donation_does_not_zero_out_a_small_depositor() {
        assert!(shares_for_assets(1_000_000, 0, 1_000_000_000).unwrap() > 0);
    }
}
