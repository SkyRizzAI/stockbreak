use anchor_lang::prelude::*;
use anchor_spl::token::Token;
use anchor_spl::token_interface::{mint_to, Mint, MintTo, TokenAccount};

use crate::{constants::*, error::MarketError, state::Market};

#[derive(Accounts)]
pub struct Faucet<'info> {
    pub user: Signer<'info>,
    #[account(seeds = [MARKET_SEED], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(mut, address = market.usdc_mint)]
    pub usdc_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = usdc_mint, token::authority = user, token::token_program = token_program)]
    pub user_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_faucet(ctx: Context<Faucet>, amount: u64) -> Result<()> {
    require!(amount > 0, MarketError::ZeroAmount);
    let market = &ctx.accounts.market;
    require!(amount <= market.faucet_max, MarketError::FaucetLimitExceeded);
    mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            MintTo {
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.user_ata.to_account_info(),
                authority: market.to_account_info(),
            },
            &[&[MARKET_SEED, &[market.bump]]],
        ),
        amount,
    )
}
