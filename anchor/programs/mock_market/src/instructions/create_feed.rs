use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::{
    constants::*,
    error::MarketError,
    state::{AssetKind, Market, OracleFeed},
};

#[derive(Accounts)]
pub struct CreateFeed<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [MARKET_SEED], bump = market.bump, has_one = authority @ MarketError::Unauthorized)]
    pub market: Account<'info, Market>,
    #[account(constraint = mint.mint_authority == Some(market.key()).into() @ MarketError::NotMarketMint)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(init, payer = authority, space = 8 + OracleFeed::INIT_SPACE, seeds = [FEED_SEED, mint.key().as_ref()], bump)]
    pub feed: Account<'info, OracleFeed>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_feed(ctx: Context<CreateFeed>, kind: AssetKind) -> Result<()> {
    let feed = &mut ctx.accounts.feed;
    feed.mint = ctx.accounts.mint.key();
    feed.kind = kind;
    feed.price = 0;
    feed.expo = -8;
    feed.conf = 0;
    feed.publish_time = 0;
    feed.bump = ctx.bumps.feed;
    Ok(())
}
