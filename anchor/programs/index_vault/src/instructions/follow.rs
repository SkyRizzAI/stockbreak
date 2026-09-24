use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::Token;
use anchor_spl::token_2022::Token2022;

use crate::{
    constants::*,
    error::VaultError,
    events::TargetsSynced,
    instructions::manage::ensure_vault_atas,
    state::{AssetEntry, GlobalConfig, Index},
    vault,
};

/// Copy the parent's asset list and weights (no timelock). Local funded assets
/// missing from the parent stay with weight 0.
/// remaining_accounts: per resulting asset `[mint, vault_ata (w)]` — parent
/// assets first (parent order), then kept local assets (local order).
#[derive(Accounts)]
pub struct SyncTargetsFromParent<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(mut)]
    pub index: Box<Account<'info, Index>>,
    pub parent_index: Box<Account<'info, Index>>,
    pub token_program: Program<'info, Token>,
    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_sync_targets_from_parent<'info>(ctx: Context<'info, SyncTargetsFromParent<'info>>) -> Result<()> {
    let key = ctx.accounts.index.key();
    let parent_key = ctx.accounts.parent_index.key();
    let parent_assets: Vec<AssetEntry> = ctx.accounts.parent_index.assets.clone();
    let index = &mut ctx.accounts.index;
    vault::guard_no_ticket(index)?;
    require!(index.follows_parent, VaultError::NotFollowing);
    require!(index.parent == Some(parent_key), VaultError::InvalidParent);

    let mut next: Vec<AssetEntry> = parent_assets
        .iter()
        .map(|p| AssetEntry {
            balance: index.assets.iter().find(|l| l.mint == p.mint).map(|l| l.balance).unwrap_or(0),
            ..*p
        })
        .collect();
    for local in index.assets.iter() {
        if local.balance > 0 && !next.iter().any(|n| n.mint == local.mint) {
            next.push(AssetEntry { target_weight_bps: 0, ..*local });
        }
    }
    require!(next.len() <= MAX_ASSETS, VaultError::TooManyAssets);
    index.assets = next;

    ensure_vault_atas(
        index,
        ctx.remaining_accounts,
        &ctx.accounts.payer.to_account_info(),
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.token_2022_program.to_account_info(),
        &ctx.accounts.associated_token_program.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
    )?;
    emit!(TargetsSynced { index: key, parent: parent_key });
    Ok(())
}
