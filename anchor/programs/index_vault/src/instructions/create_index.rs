use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::Token;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::{
    constants::*,
    error::VaultError,
    events::IndexCreated,
    state::{AssetInput, FeeConfig, GlobalConfig, Index, Strategy},
    vault,
};

/// remaining_accounts: per asset `[mint, oracle, vault_ata (writable)]`.
#[derive(Accounts)]
#[instruction(index_id: u64)]
pub struct CreateIndex<'info> {
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, GlobalConfig>,
    #[account(
        init,
        payer = creator,
        space = 8 + Index::INIT_SPACE,
        seeds = [INDEX_SEED, creator.key().as_ref(), &index_id.to_le_bytes()],
        bump
    )]
    pub index: Box<Account<'info, Index>>,
    #[account(
        init,
        payer = creator,
        seeds = [SHARE_SEED, index.key().as_ref()],
        bump,
        mint::decimals = SHARE_DECIMALS,
        mint::authority = index,
        mint::token_program = token_program,
    )]
    pub share_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = creator,
        associated_token::mint = share_mint,
        associated_token::authority = index,
        associated_token::token_program = token_program,
    )]
    pub index_share_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub parent_index: Option<Box<Account<'info, Index>>>,
    pub token_program: Program<'info, Token>,
    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn handle_create_index<'info>(
    ctx: Context<'info, CreateIndex<'info>>,
    index_id: u64,
    name: String,
    symbol: String,
    uri: String,
    assets: Vec<AssetInput>,
    fees: FeeConfig,
    strategy: Strategy,
    follows_parent: bool,
) -> Result<()> {
    vault::validate_metadata(&name, &symbol, &uri)?;
    vault::validate_inputs(&assets, false)?;
    vault::validate_fees(&fees)?;
    vault::validate_strategy(&strategy)?;
    let parent = ctx.accounts.parent_index.as_ref().map(|p| p.key());
    require!(!follows_parent || parent.is_some(), VaultError::InvalidParent);
    if let Some(p) = parent {
        require_keys_neq!(p, ctx.accounts.index.key(), VaultError::InvalidParent);
    }

    let rem = ctx.remaining_accounts;
    let config = &ctx.accounts.config;
    let entries = vault::build_entries(&assets, rem, 3, config, &[])?;

    let index_key = ctx.accounts.index.key();
    let index_ai = ctx.accounts.index.to_account_info();
    for (i, e) in entries.iter().enumerate() {
        let vault_ai = &rem[3 * i + 2];
        vault::expect_vault_ata(vault_ai, &index_key, e)?;
        let tp = vault::token_program_for(
            &e.token_program,
            &ctx.accounts.token_program.to_account_info(),
            &ctx.accounts.token_2022_program.to_account_info(),
        )?;
        vault::create_vault_ata(
            &ctx.accounts.creator.to_account_info(),
            vault_ai,
            &index_ai,
            &rem[3 * i],
            &ctx.accounts.system_program.to_account_info(),
            &tp,
            &ctx.accounts.associated_token_program.to_account_info(),
        )?;
    }

    let now = Clock::get()?.unix_timestamp;
    let index = &mut ctx.accounts.index;
    index.creator = ctx.accounts.creator.key();
    index.index_id = index_id;
    index.share_mint = ctx.accounts.share_mint.key();
    index.name = name.clone();
    index.symbol = symbol.clone();
    index.uri = uri;
    index.assets = entries;
    index.fees = fees;
    index.strategy = strategy;
    index.managers = [Pubkey::default(); MAX_MANAGERS];
    index.parent = parent;
    index.follows_parent = follows_parent;
    index.pending_update = None;
    index.paused = false;
    index.owed_creator_shares = 0;
    index.owed_platform_shares = 0;
    index.owed_parent_shares = 0;
    index.last_fee_ts = now;
    index.last_rebalance_ts = now;
    index.rebalance_ticket = None;
    index.created_at = now;
    index.bump = ctx.bumps.index;
    index.share_mint_bump = ctx.bumps.share_mint;

    let config = &mut ctx.accounts.config;
    config.index_count = config.index_count.checked_add(1).ok_or(VaultError::MathOverflow)?;

    emit!(IndexCreated {
        index: index_key,
        creator: index.creator,
        index_id,
        parent,
        follows_parent,
        name,
        symbol,
    });
    Ok(())
}
