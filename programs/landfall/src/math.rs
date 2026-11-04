use crate::constants::{VIRTUAL_ASSETS, VIRTUAL_SHARES};

/// Shares minted for `assets` deposited into a vault holding `nav` assets with
/// `supply` shares outstanding. Rounds down (in favour of the vault).
pub fn shares_for_assets(assets: u64, supply: u64, nav: u64) -> Option<u64> {
    let num = (assets as u128).checked_mul(supply as u128 + VIRTUAL_SHARES)?;
    let den = nav as u128 + VIRTUAL_ASSETS;
    u64::try_from(num / den).ok()
}

/// Assets paid out for burning `shares`. Rounds down (in favour of the vault).
pub fn assets_for_shares(shares: u64, supply: u64, nav: u64) -> Option<u64> {
    let num = (shares as u128).checked_mul(nav as u128 + VIRTUAL_ASSETS)?;
    let den = supply as u128 + VIRTUAL_SHARES;
    u64::try_from(num / den).ok()
}

/// `value * bps / 10_000`, rounded down.
pub fn bps_of(value: u64, bps: u16) -> u64 {
    ((value as u128 * bps as u128) / 10_000u128) as u64
}

/// `ceil(a * b / c)` in u128.
pub fn mul_div_ceil(a: u128, b: u128, c: u128) -> Option<u128> {
    if c == 0 {
        return None;
    }
    let p = a.checked_mul(b)?;
    Some(p.div_ceil(c))
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
        assert!(back <= a);
        assert!(a - back <= 2);
    }

    #[test]
    fn donation_does_not_zero_out_a_small_depositor() {
        // 1,000 USDC donated to an empty vault, then a 1 USDC deposit.
        let s = shares_for_assets(1_000_000, 0, 1_000_000_000).unwrap();
        assert!(s > 0);
    }

    #[test]
    fn mul_div_ceil_rounds_up() {
        assert_eq!(mul_div_ceil(10, 3, 4), Some(8));
        assert_eq!(mul_div_ceil(10, 2, 4), Some(5));
        assert_eq!(mul_div_ceil(1, 1, 0), None);
    }
}
