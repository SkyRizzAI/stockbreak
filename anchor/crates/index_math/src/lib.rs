//! Pure, integer-only math shared by `index_vault`, `mock_market` and (via test
//! vectors) the TypeScript SDK. Every function returns `None` on overflow or
//! invalid input; callers map that to `MathOverflow` / `InvalidPrice`.
//!
//! Units (PLAN §5, §6):
//! - token amounts: raw `u64`
//! - USD: micro-USD `u64` (1_000_000 = $1)
//! - weights: basis points (10_000 = 100%)
//! - Scaled UI multiplier: fixed point `MULT_FP` (1e12 = 1.0)
//!
//! Rounding always favours the vault (floor on what the vault pays out,
//! ceil on what the vault receives).

#![cfg_attr(not(test), no_std)]

pub const MULT_FP: u128 = 1_000_000_000_000;
pub const BPS: u128 = 10_000;
pub const YEAR_SECS: u128 = 31_536_000;
pub const FEE_FP: u128 = 1_000_000_000_000;
pub const USD_DECIMALS: i32 = 6;

/// Convert a Scaled UI multiplier (f64, as stored by Token-2022) to fixed point.
/// The only place a float is touched. Must match `multFpFromF64` in the SDK.
pub fn mult_fp_from_f64(m: f64) -> Option<u128> {
    if !(m.is_finite() && m > 0.0) {
        return None;
    }
    let v = m * 1_000_000_000_000.0;
    if v >= 1.0e30 {
        return None;
    }
    // round half away from zero (positive only) == Math.round for positives
    let floor = v as u128;
    let frac = v - floor as f64;
    Some(if frac >= 0.5 { floor + 1 } else { floor })
}

fn pow10(e: u32) -> Option<u128> {
    10u128.checked_pow(e)
}

/// Asset price as read from an oracle (Pyth-like shape).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Price {
    pub price: i64,
    pub expo: i32,
}

/// Raw amount → UI-scaled raw amount (applies the Scaled UI multiplier), floored.
pub fn scale_raw(raw: u64, mult_fp: u128) -> Option<u128> {
    (raw as u128).checked_mul(mult_fp)?.checked_div(MULT_FP)
}

/// value_usd(raw) in micro-USD, floored (PLAN §6.3).
/// value = scaled_raw * price * 10^(expo + 6) / 10^decimals
pub fn value_usd(raw: u64, decimals: u8, mult_fp: u128, p: Price) -> Option<u64> {
    if p.price <= 0 {
        return None;
    }
    let scaled = scale_raw(raw, mult_fp)?;
    let num = scaled.checked_mul(p.price as u128)?;
    // shift = decimals - (expo + 6)
    let shift = decimals as i32 - (p.expo + USD_DECIMALS);
    let v = if shift >= 0 {
        num.checked_div(pow10(shift as u32)?)?
    } else {
        num.checked_mul(pow10((-shift) as u32)?)?
    };
    u64::try_from(v).ok()
}

/// Inverse of `value_usd`: the raw amount worth `value` micro-USD, floored.
pub fn raw_for_value(value: u64, decimals: u8, mult_fp: u128, p: Price) -> Option<u64> {
    if p.price <= 0 || mult_fp == 0 {
        return None;
    }
    let shift = decimals as i32 - (p.expo + USD_DECIMALS);
    let scaled = if shift >= 0 {
        (value as u128).checked_mul(pow10(shift as u32)?)?.checked_div(p.price as u128)?
    } else {
        (value as u128).checked_div(pow10((-shift) as u32)?)?.checked_div(p.price as u128)?
    };
    let raw = scaled.checked_mul(MULT_FP)?.checked_div(mult_fp)?;
    u64::try_from(raw).ok()
}

/// mock_market swap output (PLAN §5.4): value of input minus spread, converted to
/// output raw units. Floors at every step (favours the market).
pub fn swap_out(
    amount_in: u64,
    in_decimals: u8,
    in_mult_fp: u128,
    in_price: Price,
    out_decimals: u8,
    out_mult_fp: u128,
    out_price: Price,
    spread_bps: u16,
) -> Option<u64> {
    let v_in = value_usd(amount_in, in_decimals, in_mult_fp, in_price)?;
    let v_net = (v_in as u128)
        .checked_mul(BPS.checked_sub(spread_bps as u128)?)?
        .checked_div(BPS)?;
    raw_for_value(u64::try_from(v_net).ok()?, out_decimals, out_mult_fp, out_price)
}

pub fn ceil_div(a: u128, b: u128) -> Option<u128> {
    if b == 0 {
        return None;
    }
    let q = a / b;
    Some(if a % b == 0 { q } else { q.checked_add(1)? })
}

/// Proportional join (supply > 0), PLAN §6.1.
/// Returns (shares_total, amounts). Assets with balance 0 contribute 0 and are
/// ignored in the min. `None` if no asset has a balance.
pub fn join_proportional(
    max_amounts: &[u64],
    balances: &[u64],
    supply: u64,
) -> Option<(u64, [u64; 16], usize)> {
    let n = balances.len();
    if n != max_amounts.len() || n > 16 || supply == 0 {
        return None;
    }
    let mut shares: Option<u128> = None;
    for i in 0..n {
        if balances[i] == 0 {
            continue;
        }
        let s = (max_amounts[i] as u128)
            .checked_mul(supply as u128)?
            .checked_div(balances[i] as u128)?;
        shares = Some(match shares {
            Some(cur) if cur <= s => cur,
            _ => s,
        });
    }
    let shares_total = shares?;
    let mut amounts = [0u64; 16];
    for i in 0..n {
        if balances[i] == 0 {
            continue;
        }
        let a = ceil_div(shares_total.checked_mul(balances[i] as u128)?, supply as u128)?;
        amounts[i] = u64::try_from(a).ok()?;
    }
    Some((u64::try_from(shares_total).ok()?, amounts, n))
}

/// Redeem amounts (PLAN §6.2): amount_i = floor(net * balance_i / S).
pub fn redeem_amount(net_shares: u64, balance: u64, supply: u64) -> Option<u64> {
    if supply == 0 {
        return None;
    }
    let a = (net_shares as u128)
        .checked_mul(balance as u128)?
        .checked_div(supply as u128)?;
    u64::try_from(a).ok()
}

/// floor(amount * bps / 10_000)
pub fn bps_of(amount: u64, bps: u16) -> Option<u64> {
    let v = (amount as u128).checked_mul(bps as u128)?.checked_div(BPS)?;
    u64::try_from(v).ok()
}

/// Management + platform fee accrual via dilution (PLAN §6.4).
/// Returns (creator, platform, parent) shares to add to `owed_*`.
pub fn accrue_fees(
    supply: u64,
    elapsed: i64,
    mgmt_fee_bps: u16,
    platform_fee_bps: u16,
    clone_royalty_bps: u16,
    has_parent: bool,
) -> Option<(u64, u64, u64)> {
    let rate = mgmt_fee_bps as u128 + platform_fee_bps as u128;
    if rate == 0 || elapsed <= 0 || supply == 0 {
        return Some((0, 0, 0));
    }
    let f_fp = rate
        .checked_mul(elapsed as u128)?
        .checked_mul(FEE_FP)?
        .checked_div(BPS.checked_mul(YEAR_SECS)?)?;
    // Cap at 50% dilution per accrual to keep the formula finite.
    let f_fp = if f_fp > FEE_FP / 2 { FEE_FP / 2 } else { f_fp };
    let new = (supply as u128)
        .checked_mul(f_fp)?
        .checked_div(FEE_FP.checked_sub(f_fp)?)?;
    let mut creator = new.checked_mul(mgmt_fee_bps as u128)?.checked_div(rate)?;
    let platform = new.checked_sub(creator)?;
    let mut parent = 0u128;
    if has_parent {
        parent = creator.checked_mul(clone_royalty_bps as u128)?.checked_div(BPS)?;
        creator = creator.checked_sub(parent)?;
    }
    Some((
        u64::try_from(creator).ok()?,
        u64::try_from(platform).ok()?,
        u64::try_from(parent).ok()?,
    ))
}

/// weight_i = floor(value_i * 10_000 / NAV). Zero NAV → all zero.
pub fn weight_bps(value: u64, nav: u64) -> Option<u32> {
    if nav == 0 {
        return Some(0);
    }
    let w = (value as u128).checked_mul(BPS)?.checked_div(nav as u128)?;
    u32::try_from(w).ok()
}

/// (sum |w_i - t_i|, max |w_i - t_i|) from values and targets.
pub fn drift(values: &[u64], targets: &[u16]) -> Option<(u32, u32)> {
    if values.len() != targets.len() {
        return None;
    }
    let mut nav: u64 = 0;
    for v in values {
        nav = nav.checked_add(*v)?;
    }
    let mut sum: u32 = 0;
    let mut max: u32 = 0;
    for i in 0..values.len() {
        let w = weight_bps(values[i], nav)?;
        let t = targets[i] as u32;
        let d = if w > t { w - t } else { t - w };
        sum = sum.checked_add(d)?;
        if d > max {
            max = d;
        }
    }
    Some((sum, max))
}

/// Initial-deposit weight check (PLAN §6.1): |w_i - t_i| ≤ tolerance for all i.
pub fn initial_weights_ok(values: &[u64], targets: &[u16], tolerance_bps: u32) -> Option<bool> {
    let (_, max) = drift(values, targets)?;
    Some(max <= tolerance_bps)
}

/// share price (micro-USD per 1 share with 6 decimals) = NAV * 10^6 / S
pub fn share_price(nav: u64, supply: u64) -> Option<u64> {
    if supply == 0 {
        return Some(0);
    }
    let v = (nav as u128).checked_mul(1_000_000)?.checked_div(supply as u128)?;
    u64::try_from(v).ok()
}

/// IPO conversion output: floor(amount * num / den).
pub fn convert_amount(amount: u64, num: u64, den: u64) -> Option<u64> {
    if den == 0 {
        return None;
    }
    let v = (amount as u128).checked_mul(num as u128)?.checked_div(den as u128)?;
    u64::try_from(v).ok()
}

#[cfg(test)]
mod vectors;
