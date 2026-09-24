use anchor_lang::prelude::*;
use anchor_spl::token_interface::{burn, mint_to, Burn, Mint, MintTo, TokenAccount, TokenInterface};
use index_math::convert_amount;

use crate::{
    constants::*,
    error::MarketError,
    state::{IpoConversion, Market},
};

/// Burns pre-IPO tokens and mints the listed stock at the registered ratio.
/// `owner` may be a PDA signing through CPI (index vault migration).
#[derive(Accounts)]
pub struct Convert<'info> {
    pub owner: Signer<'info>,
    #[account(seeds = [MARKET_SEED], bump = market.bump)]
    pub market: Account<'info, Market>,
    #[account(
        seeds = [IPO_SEED, old_mint.key().as_ref()],
        bump = ipo.bump,
        has_one = old_mint @ MarketError::IpoInactive,
        has_one = new_mint @ MarketError::IpoInactive,
        constraint = ipo.active @ MarketError::IpoInactive,
    )]
    pub ipo: Account<'info, IpoConversion>,
    #[account(mut, mint::token_program = token_program_old)]
    pub old_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, mint::token_program = token_program_new)]
    pub new_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint = old_mint, token::authority = owner, token::token_program = token_program_old)]
    pub owner_old_ata: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = new_mint, token::authority = owner, token::token_program = token_program_new)]
    pub owner_new_ata: InterfaceAccount<'info, TokenAccount>,
    pub token_program_old: Interface<'info, TokenInterface>,
    pub token_program_new: Interface<'info, TokenInterface>,
}

pub fn handle_convert(ctx: Context<Convert>, amount: u64) -> Result<()> {
    require!(amount > 0, MarketError::ZeroAmount);
    let ipo = &ctx.accounts.ipo;
    let out = convert_amount(amount, ipo.ratio_num, ipo.ratio_den).ok_or(MarketError::MathOverflow)?;
    burn(
        CpiContext::new(
            ctx.accounts.token_program_old.key(),
            Burn {
                mint: ctx.accounts.old_mint.to_account_info(),
                from: ctx.accounts.owner_old_ata.to_account_info(),
                authority: ctx.accounts.owner.to_account_info(),
            },
        ),
        amount,
    )?;
    if out > 0 {
        let market = &ctx.accounts.market;
        mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program_new.key(),
                MintTo {
                    mint: ctx.accounts.new_mint.to_account_info(),
                    to: ctx.accounts.owner_new_ata.to_account_info(),
                    authority: market.to_account_info(),
                },
                &[&[MARKET_SEED, &[market.bump]]],
            ),
            out,
        )?;
    }
    Ok(())
}
