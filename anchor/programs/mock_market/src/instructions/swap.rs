use anchor_lang::prelude::*;
use anchor_spl::token_interface::{burn, mint_to, Burn, Mint, MintTo, TokenAccount, TokenInterface};
use index_math::{swap_out, Price};

use crate::{
    constants::*,
    error::MarketError,
    state::{Market, OracleFeed},
    utils::mint_mult_fp,
};

#[derive(Accounts)]
pub struct Swap<'info> {
    pub user: Signer<'info>,
    #[account(seeds = [MARKET_SEED], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(
        mut,
        mint::token_program = token_program_in,
        constraint = mint_in.mint_authority == Some(market.key()).into() @ MarketError::NotMarketMint,
    )]
    pub mint_in: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        mint::token_program = token_program_out,
        constraint = mint_out.mint_authority == Some(market.key()).into() @ MarketError::NotMarketMint,
    )]
    pub mint_out: InterfaceAccount<'info, Mint>,
    #[account(seeds = [FEED_SEED, mint_in.key().as_ref()], bump = feed_in.bump)]
    pub feed_in: Account<'info, OracleFeed>,
    #[account(seeds = [FEED_SEED, mint_out.key().as_ref()], bump = feed_out.bump)]
    pub feed_out: Account<'info, OracleFeed>,
    #[account(mut, token::mint = mint_in, token::authority = user, token::token_program = token_program_in)]
    pub user_ata_in: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint_out, token::token_program = token_program_out)]
    pub user_ata_out: InterfaceAccount<'info, TokenAccount>,
    pub token_program_in: Interface<'info, TokenInterface>,
    pub token_program_out: Interface<'info, TokenInterface>,
}

pub fn check_fresh(feed: &OracleFeed, now: i64, max_age: u32) -> Result<Price> {
    require!(feed.price > 0, MarketError::InvalidPrice);
    require!(now.saturating_sub(feed.publish_time) <= max_age as i64, MarketError::OracleStale);
    Ok(Price { price: feed.price, expo: feed.expo })
}

pub fn handle_swap(ctx: Context<Swap>, amount_in: u64, min_out: u64) -> Result<()> {
    require!(amount_in > 0, MarketError::ZeroAmount);
    require_keys_neq!(ctx.accounts.mint_in.key(), ctx.accounts.mint_out.key(), MarketError::SameMint);
    let market = &ctx.accounts.market;
    let now = Clock::get()?.unix_timestamp;
    let p_in = check_fresh(&ctx.accounts.feed_in, now, market.oracle_max_age_secs)?;
    let p_out = check_fresh(&ctx.accounts.feed_out, now, market.oracle_max_age_secs)?;
    let m_in = mint_mult_fp(&ctx.accounts.mint_in.to_account_info(), now)?;
    let m_out = mint_mult_fp(&ctx.accounts.mint_out.to_account_info(), now)?;
    let out = swap_out(
        amount_in,
        ctx.accounts.mint_in.decimals,
        m_in,
        p_in,
        ctx.accounts.mint_out.decimals,
        m_out,
        p_out,
        market.spread_bps,
    )
    .ok_or(MarketError::MathOverflow)?;
    require!(out > 0 && out >= min_out, MarketError::SlippageExceeded);

    burn(
        CpiContext::new(
            ctx.accounts.token_program_in.key(),
            Burn {
                mint: ctx.accounts.mint_in.to_account_info(),
                from: ctx.accounts.user_ata_in.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount_in,
    )?;
    mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program_out.key(),
            MintTo {
                mint: ctx.accounts.mint_out.to_account_info(),
                to: ctx.accounts.user_ata_out.to_account_info(),
                authority: market.to_account_info(),
            },
            &[&[MARKET_SEED, &[market.bump]]],
        ),
        out,
    )?;
    Ok(())
}
