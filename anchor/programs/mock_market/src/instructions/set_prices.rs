use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::MarketError,
    state::{Market, OracleFeed, PriceInput},
};

/// Feeds are passed in `remaining_accounts` (writable), same order as `prices`.
#[derive(Accounts)]
pub struct SetPrices<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [MARKET_SEED], bump = market.bump, has_one = authority @ MarketError::Unauthorized)]
    pub market: Account<'info, Market>,
}

pub fn handle_set_prices<'info>(
    ctx: Context<'info, SetPrices<'info>>,
    prices: Vec<PriceInput>,
) -> Result<()> {
    require!(prices.len() <= MAX_PRICES_PER_TX, MarketError::TooManyPrices);
    require!(prices.len() == ctx.remaining_accounts.len(), MarketError::FeedMismatch);
    let now = Clock::get()?.unix_timestamp;
    for (input, info) in prices.iter().zip(ctx.remaining_accounts.iter()) {
        require!(input.price > 0, MarketError::InvalidPrice);
        require_keys_eq!(*info.owner, crate::ID, MarketError::FeedMismatch);
        require!(info.is_writable, MarketError::FeedMismatch);
        let mut feed = {
            let data = info.try_borrow_data()?;
            OracleFeed::try_deserialize(&mut &data[..])?
        };
        feed.price = input.price;
        feed.expo = input.expo;
        feed.conf = input.conf;
        feed.publish_time = now;
        let mut data = info.try_borrow_mut_data()?;
        feed.try_serialize(&mut &mut data[..])?;
    }
    Ok(())
}
