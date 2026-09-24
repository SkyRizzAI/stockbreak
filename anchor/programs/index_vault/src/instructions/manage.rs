use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::Token;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::Mint;

use crate::{
    constants::*,
    error::VaultError,
    events::{IndexUpdateCancelled, IndexUpdateProposed, IndexUpdated, ManagersSet, PausedSet},
    state::{GlobalConfig, Index, PendingUpdate, UpdateInput},
    vault,
};

/// remaining_accounts (only when `update.assets` is set): per asset `[mint, oracle]`.
#[derive(Accounts)]
pub struct ProposeUpdate<'info> {
    pub creator: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(mut, has_one = creator @ VaultError::Unauthorized, has_one = share_mint @ VaultError::AccountOrderMismatch)]
    pub index: Box<Account<'info, Index>>,
    pub share_mint: Box<InterfaceAccount<'info, Mint>>,
}

pub fn handle_propose_update<'info>(ctx: Context<'info, ProposeUpdate<'info>>, update: UpdateInput) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let key = ctx.accounts.index.key();
    let config = &ctx.accounts.config;
    let supply = ctx.accounts.share_mint.supply;
    let index = &mut ctx.accounts.index;
    vault::guard_no_ticket(index)?;
    require!(update.assets.is_some() || update.fees.is_some() || update.strategy.is_some(), VaultError::NoPendingUpdate);

    let assets = match &update.assets {
        Some(inputs) => {
            vault::validate_inputs(inputs, true)?;
            Some(vault::build_entries(inputs, ctx.remaining_accounts, 2, config, &index.assets)?)
        }
        None => {
            require!(ctx.remaining_accounts.is_empty(), VaultError::AccountOrderMismatch);
            None
        }
    };
    if let Some(f) = &update.fees {
        vault::validate_fees(f)?;
    }
    if let Some(s) = &update.strategy {
        vault::validate_strategy(s)?;
    }

    // Fee-only decreases apply immediately (PLAN §5.3).
    if let (None, None, Some(f)) = (&update.assets, &update.strategy, &update.fees) {
        let cur = index.fees;
        if f.mgmt_fee_bps <= cur.mgmt_fee_bps && f.entry_fee_bps <= cur.entry_fee_bps && f.exit_fee_bps <= cur.exit_fee_bps {
            vault::accrue(index, config, supply, now)?;
            index.fees = *f;
            emit!(IndexUpdated { index: key, assets_changed: false, fees_changed: true, strategy_changed: false });
            return Ok(());
        }
    }

    let eta = now.checked_add(config.timelock_secs as i64).ok_or(VaultError::MathOverflow)?;
    emit!(IndexUpdateProposed {
        index: key,
        eta,
        assets_changed: assets.is_some(),
        fees_changed: update.fees.is_some(),
        strategy_changed: update.strategy.is_some(),
    });
    index.pending_update = Some(PendingUpdate { assets, fees: update.fees, strategy: update.strategy, eta });
    Ok(())
}

/// remaining_accounts (only when the pending update changes assets): per
/// resulting asset (after dropping unfunded zero-weight entries) `[mint, vault_ata (w)]`.
#[derive(Accounts)]
pub struct ApplyUpdate<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(mut, has_one = share_mint @ VaultError::AccountOrderMismatch)]
    pub index: Box<Account<'info, Index>>,
    pub share_mint: Box<InterfaceAccount<'info, Mint>>,
    pub token_program: Program<'info, Token>,
    pub token_2022_program: Program<'info, Token2022>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_apply_update<'info>(ctx: Context<'info, ApplyUpdate<'info>>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let key = ctx.accounts.index.key();
    let supply = ctx.accounts.share_mint.supply;
    let config = &ctx.accounts.config;
    let index = &mut ctx.accounts.index;
    vault::guard_no_ticket(index)?;
    let pending = index.pending_update.clone().ok_or(VaultError::NoPendingUpdate)?;
    require!(now >= pending.eta, VaultError::TimelockActive);

    vault::accrue(index, config, supply, now)?;
    let assets_changed = pending.assets.is_some();
    if let Some(next) = pending.assets {
        vault::replace_assets(index, next)?;
        ensure_vault_atas(
            index,
            ctx.remaining_accounts,
            &ctx.accounts.payer.to_account_info(),
            &ctx.accounts.token_program.to_account_info(),
            &ctx.accounts.token_2022_program.to_account_info(),
            &ctx.accounts.associated_token_program.to_account_info(),
            &ctx.accounts.system_program.to_account_info(),
        )?;
    } else {
        require!(ctx.remaining_accounts.is_empty(), VaultError::AccountOrderMismatch);
    }
    if let Some(f) = pending.fees {
        index.fees = f;
    }
    if let Some(s) = pending.strategy {
        index.strategy = s;
    }
    index.pending_update = None;
    emit!(IndexUpdated {
        index: key,
        assets_changed,
        fees_changed: pending.fees.is_some(),
        strategy_changed: pending.strategy.is_some(),
    });
    Ok(())
}

/// Create (idempotently) the vault ATA of every asset. `rem` = per asset `[mint, vault_ata]`.
pub fn ensure_vault_atas<'info>(
    index: &Account<'info, Index>,
    rem: &[AccountInfo<'info>],
    payer: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    token_2022_program: &AccountInfo<'info>,
    associated_token_program: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
) -> Result<()> {
    require!(rem.len() == index.assets.len() * 2, VaultError::AccountOrderMismatch);
    let index_key = index.key();
    let index_ai = index.to_account_info();
    for (i, e) in index.assets.iter().enumerate() {
        require_keys_eq!(rem[2 * i].key(), e.mint, VaultError::AccountOrderMismatch);
        vault::expect_vault_ata(&rem[2 * i + 1], &index_key, e)?;
        let tp = vault::token_program_for(&e.token_program, token_program, token_2022_program)?;
        vault::create_vault_ata(payer, &rem[2 * i + 1], &index_ai, &rem[2 * i], system_program, &tp, associated_token_program)?;
    }
    Ok(())
}

#[derive(Accounts)]
pub struct CreatorOnly<'info> {
    pub creator: Signer<'info>,
    #[account(mut, has_one = creator @ VaultError::Unauthorized)]
    pub index: Box<Account<'info, Index>>,
}

pub fn handle_cancel_update(ctx: Context<CreatorOnly>) -> Result<()> {
    let key = ctx.accounts.index.key();
    let index = &mut ctx.accounts.index;
    vault::guard_no_ticket(index)?;
    require!(index.pending_update.is_some(), VaultError::NoPendingUpdate);
    index.pending_update = None;
    emit!(IndexUpdateCancelled { index: key });
    Ok(())
}

pub fn handle_set_managers(ctx: Context<CreatorOnly>, managers: Vec<Pubkey>) -> Result<()> {
    let key = ctx.accounts.index.key();
    let index = &mut ctx.accounts.index;
    vault::guard_no_ticket(index)?;
    require!(managers.len() <= MAX_MANAGERS, VaultError::InvalidManagers);
    let mut next = [Pubkey::default(); MAX_MANAGERS];
    for (i, m) in managers.iter().enumerate() {
        require!(*m != Pubkey::default(), VaultError::InvalidManagers);
        require!(!managers[..i].contains(m), VaultError::InvalidManagers);
        next[i] = *m;
    }
    index.managers = next;
    emit!(ManagersSet { index: key, managers });
    Ok(())
}

pub fn handle_set_paused(ctx: Context<CreatorOnly>, paused: bool) -> Result<()> {
    let key = ctx.accounts.index.key();
    let index = &mut ctx.accounts.index;
    vault::guard_no_ticket(index)?;
    index.paused = paused;
    emit!(PausedSet { index: key, paused });
    Ok(())
}
