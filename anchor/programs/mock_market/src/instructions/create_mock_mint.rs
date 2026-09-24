use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::system_program::{create_account, CreateAccount};
use anchor_spl::token_2022::spl_token_2022::{
    extension::{scaled_ui_amount::instruction as scaled_ix, ExtensionType},
    state::Mint as MintState,
};
use anchor_spl::token_interface::{initialize_mint2, InitializeMint2, TokenInterface};

use crate::{constants::*, error::MarketError, state::Market};

#[derive(Accounts)]
#[instruction(symbol: String)]
pub struct CreateMockMint<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [MARKET_SEED], bump = market.bump, has_one = authority @ MarketError::Unauthorized)]
    pub market: Account<'info, Market>,
    /// CHECK: created here as a PDA mint; seeds enforce the address.
    #[account(mut, seeds = [MINT_SEED, symbol.as_bytes()], bump)]
    pub mint: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_mock_mint(
    ctx: Context<CreateMockMint>,
    symbol: String,
    decimals: u8,
    token_2022: bool,
    scaled_ui: bool,
) -> Result<()> {
    require!(!symbol.is_empty() && symbol.len() <= MAX_SYMBOL_LEN, MarketError::InvalidSymbol);
    require!(decimals <= 9, MarketError::InvalidDecimals);
    let tp = ctx.accounts.token_program.key();
    let expected_tp = if token_2022 { anchor_spl::token_2022::ID } else { anchor_spl::token::ID };
    require_keys_eq!(tp, expected_tp, MarketError::InvalidTokenProgram);
    require!(!scaled_ui || token_2022, MarketError::InvalidTokenProgram);

    let extensions: &[ExtensionType] = if scaled_ui { &[ExtensionType::ScaledUiAmount] } else { &[] };
    let space = ExtensionType::try_calculate_account_len::<MintState>(extensions)?;
    let lamports = Rent::get()?.minimum_balance(space);
    let mint_bump = ctx.bumps.mint;
    let mint_seeds: &[&[u8]] = &[MINT_SEED, symbol.as_bytes(), &[mint_bump]];
    create_account(
        CpiContext::new_with_signer(
            ctx.accounts.system_program.key(),
            CreateAccount {
                from: ctx.accounts.authority.to_account_info(),
                to: ctx.accounts.mint.to_account_info(),
            },
            &[mint_seeds],
        ),
        lamports,
        space as u64,
        &tp,
    )?;

    let market_key = ctx.accounts.market.key();
    if scaled_ui {
        let ix = scaled_ix::initialize(&tp, ctx.accounts.mint.key, Some(market_key), 1.0)?;
        invoke_signed(&ix, &[ctx.accounts.mint.to_account_info()], &[])?;
    }
    initialize_mint2(
        CpiContext::new(tp, InitializeMint2 { mint: ctx.accounts.mint.to_account_info() }),
        decimals,
        &market_key,
        None,
    )?;
    Ok(())
}
