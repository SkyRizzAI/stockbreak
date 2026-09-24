use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";
#[constant]
pub const INDEX_SEED: &[u8] = b"index";
#[constant]
pub const SHARE_SEED: &[u8] = b"share";

/// Max assets per index (A05: fits with a per-index Address Lookup Table).
pub const MAX_ASSETS: usize = 10;
pub const MAX_MANAGERS: usize = 3;
pub const MAX_NAME_LEN: usize = 32;
pub const MAX_SYMBOL_LEN: usize = 10;
pub const MAX_URI_LEN: usize = 128;

#[constant]
pub const SHARE_DECIMALS: u8 = 6;
#[constant]
pub const LOCKED_SHARES: u64 = 1_000;
#[constant]
pub const MIN_INITIAL_VALUE: u64 = 1_000_000;
#[constant]
pub const MAX_MGMT_FEE_BPS: u16 = 500;
#[constant]
pub const MAX_ENTRY_FEE_BPS: u16 = 100;
#[constant]
pub const MAX_EXIT_FEE_BPS: u16 = 100;
#[constant]
pub const MAX_PLATFORM_FEE_BPS: u16 = 200;
#[constant]
pub const MAX_CLONE_ROYALTY_BPS: u16 = 5_000;
#[constant]
pub const MIN_SLIPPAGE_BPS: u16 = 50;
#[constant]
pub const MAX_SLIPPAGE_BPS: u16 = 500;
#[constant]
pub const INITIAL_WEIGHT_TOLERANCE_BPS: u16 = 200;
#[constant]
pub const ORACLE_MAX_AGE_SECS: u32 = 120;
#[constant]
pub const ORACLE_MAX_CONF_BPS: u16 = 200;
#[constant]
pub const TOTAL_WEIGHT_BPS: u16 = 10_000;

pub const COMPUTE_BUDGET_ID: Pubkey = pubkey!("ComputeBudget111111111111111111111111111111");
