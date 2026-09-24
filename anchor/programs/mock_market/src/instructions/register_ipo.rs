use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::{
    constants::*,
    error::MarketError,
    state::{IpoConversion, Market, OracleFeed},
};

#[derive(Accounts)]
pub struct RegisterIpo<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [MARKET_SEED], bump = market.bump, has_one = authority @ MarketError::Unauthorized)]
    pub market: Account<'info, Market>,
    #[account(constraint = old_mint.mint_authority == Some(market.key()).into() @ MarketError::NotMarketMint)]
    pub old_mint: InterfaceAccount<'info, Mint>,
    #[account(constraint = new_mint.mint_authority == Some(market.key()).into() @ MarketError::NotMarketMint)]
    pub new_mint: InterfaceAccount<'info, Mint>,
    #[account(seeds = [FEED_SEED, new_mint.key().as_ref()], bump = new_feed.bump)]
    pub new_feed: Account<'info, OracleFeed>,
    #[account(init, payer = authority, space = 8 + IpoConversion::INIT_SPACE, seeds = [IPO_SEED, old_mint.key().as_ref()], bump)]
    pub ipo: Account<'info, IpoConversion>,
    pub system_program: Program<'info, System>,
}

pub fn handle_register_ipo(ctx: Context<RegisterIpo>, ratio_num: u64, ratio_den: u64) -> Result<()> {
    require!(ratio_num > 0 && ratio_den > 0, MarketError::InvalidRatio);
    require_keys_neq!(ctx.accounts.old_mint.key(), ctx.accounts.new_mint.key(), MarketError::SameMint);
    let ipo = &mut ctx.accounts.ipo;
    ipo.old_mint = ctx.accounts.old_mint.key();
    ipo.new_mint = ctx.accounts.new_mint.key();
    ipo.ratio_num = ratio_num;
    ipo.ratio_den = ratio_den;
    ipo.active = true;
    ipo.bump = ctx.bumps.ipo;
    Ok(())
}
