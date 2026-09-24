//! Single oracle adapter (PLAN §5.4). Swap this module to use another oracle.

use anchor_lang::prelude::*;
use index_math::Price;
use mock_market::state::{AssetKind as FeedKind, OracleFeed};

use crate::{constants::*, error::VaultError, state::AssetKind};

pub fn feed_address(mint: &Pubkey, market_program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[mock_market::constants::FEED_SEED, mint.as_ref()], market_program).0
}

/// Load a feed account after verifying owner and PDA address.
pub fn load_feed(feed: &AccountInfo, mint: &Pubkey, market_program: &Pubkey) -> Result<OracleFeed> {
    require_keys_eq!(*feed.owner, *market_program, VaultError::InvalidOracle);
    require_keys_eq!(feed.key(), feed_address(mint, market_program), VaultError::InvalidOracle);
    let data = feed.try_borrow_data()?;
    let parsed = OracleFeed::try_deserialize(&mut &data[..]).map_err(|_| error!(VaultError::InvalidOracle))?;
    require_keys_eq!(parsed.mint, *mint, VaultError::InvalidOracle);
    Ok(parsed)
}

pub fn feed_kind(feed: &OracleFeed) -> AssetKind {
    match feed.kind {
        FeedKind::Stock => AssetKind::Stock,
        FeedKind::PreIpo => AssetKind::PreIpo,
        FeedKind::Stable => AssetKind::Stable,
    }
}

/// read_price(account, now) → Price, rejecting stale / low-confidence prices.
pub fn read_price(feed: &AccountInfo, mint: &Pubkey, market_program: &Pubkey, max_age: u32, now: i64) -> Result<Price> {
    let f = load_feed(feed, mint, market_program)?;
    require!(f.price > 0, VaultError::InvalidPrice);
    require!(now.saturating_sub(f.publish_time) <= max_age as i64, VaultError::OracleStale);
    let conf_bps = (f.conf as u128)
        .checked_mul(10_000)
        .ok_or(VaultError::MathOverflow)?
        / (f.price as u128);
    require!(conf_bps <= ORACLE_MAX_CONF_BPS as u128, VaultError::OracleConfidence);
    Ok(Price { price: f.price, expo: f.expo })
}
