use anchor_lang::prelude::*;

#[constant]
pub const MARKET_SEED: &[u8] = b"market";
#[constant]
pub const MINT_SEED: &[u8] = b"mint";
#[constant]
pub const FEED_SEED: &[u8] = b"feed";
#[constant]
pub const IPO_SEED: &[u8] = b"ipo";
#[constant]
pub const USDC_SYMBOL: &str = "USDC";
#[constant]
pub const USDC_DECIMALS: u8 = 6;
pub const MAX_SYMBOL_LEN: usize = 16;
#[constant]
pub const MAX_SPREAD_BPS: u16 = 500;
pub const MAX_PRICES_PER_TX: usize = 24;
