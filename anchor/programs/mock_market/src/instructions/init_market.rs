use anchor_lang::prelude::*;
use anchor_spl::token::Token;
use anchor_spl::token_interface::Mint;

use crate::{constants::*, error::MarketError, state::Market};

#[derive(Accounts)]
pub struct InitMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(init, payer = authority, space = 8 + Market::INIT_SPACE, seeds = [MARKET_SEED], bump)]
    pub market: Account<'info, Market>,
    #[account(
        init,
        payer = authority,
        seeds = [MINT_SEED, USDC_SYMBOL.as_bytes()],
        bump,
        mint::decimals = USDC_DECIMALS,
        mint::authority = market,
        mint::token_program = token_program,
    )]
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_init_market(
    ctx: Context<InitMarket>,
    spread_bps: u16,
    faucet_max: u64,
    oracle_max_age_secs: u32,
) -> Result<()> {
    require!(spread_bps <= MAX_SPREAD_BPS, MarketError::InvalidSpread);
    let market = &mut ctx.accounts.market;
    market.authority = ctx.accounts.authority.key();
    market.usdc_mint = ctx.accounts.usdc_mint.key();
    market.spread_bps = spread_bps;
    market.faucet_max = faucet_max;
    market.oracle_max_age_secs = oracle_max_age_secs;
    market.bump = ctx.bumps.market;
    Ok(())
}
