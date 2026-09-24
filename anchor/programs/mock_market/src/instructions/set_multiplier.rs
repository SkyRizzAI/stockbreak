use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_spl::token_2022::spl_token_2022::extension::scaled_ui_amount::instruction as scaled_ix;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::Mint;

use crate::{constants::*, error::MarketError, state::Market};

#[derive(Accounts)]
pub struct SetMultiplier<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [MARKET_SEED], bump = market.bump, has_one = authority @ MarketError::Unauthorized)]
    pub market: Account<'info, Market>,
    #[account(mut, mint::token_program = token_program)]
    pub mint: InterfaceAccount<'info, Mint>,
    pub token_program: Program<'info, Token2022>,
}

pub fn handle_set_multiplier(ctx: Context<SetMultiplier>, multiplier: f64, effective_ts: i64) -> Result<()> {
    require!(multiplier.is_finite() && multiplier > 0.0, MarketError::InvalidMultiplier);
    let market = &ctx.accounts.market;
    let ix = scaled_ix::update_multiplier(
        &ctx.accounts.token_program.key(),
        &ctx.accounts.mint.key(),
        &market.key(),
        &[],
        multiplier,
        effective_ts,
    )?;
    invoke_signed(
        &ix,
        &[ctx.accounts.mint.to_account_info(), market.to_account_info()],
        &[&[MARKET_SEED, &[market.bump]]],
    )?;
    Ok(())
}
