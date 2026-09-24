use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::extension::scaled_ui_amount::ScaledUiAmountConfig;
use anchor_spl::token_interface::get_mint_extension_data;
use index_math::{mult_fp_from_f64, MULT_FP};

/// Effective Scaled UI multiplier of a mint in fixed point (PLAN §6.3).
/// Classic SPL mints and Token-2022 mints without the extension return 1.0.
pub fn mint_mult_fp(mint: &AccountInfo, now: i64) -> Result<u128> {
    if *mint.owner != anchor_spl::token_2022::ID {
        return Ok(MULT_FP);
    }
    match get_mint_extension_data::<ScaledUiAmountConfig>(mint) {
        Ok(cfg) => {
            let eff_ts: i64 = cfg.new_multiplier_effective_timestamp.into();
            let m: f64 = if now >= eff_ts { cfg.new_multiplier.into() } else { cfg.multiplier.into() };
            mult_fp_from_f64(m).ok_or_else(|| error!(crate::error::MarketError::InvalidMultiplier))
        }
        Err(_) => Ok(MULT_FP),
    }
}

/// Signer seeds for the market PDA.
#[macro_export]
macro_rules! market_seeds {
    ($bump:expr) => {
        &[$crate::constants::MARKET_SEED, &[$bump]]
    };
}
