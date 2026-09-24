//! Flash rebalance "sandwich" (PLAN §6.3):
//! begin_rebalance → mock_market.swap → transfer_checked(executor → vault) → end_rebalance
//! all in one transaction, checked against oracles and weight direction.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{get_stack_height, TRANSACTION_LEVEL_STACK_HEIGHT};
use anchor_lang::Discriminator;
use anchor_spl::token::Token;
use anchor_spl::token_2022::Token2022;
use index_math as m;
use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked};

use crate::{
    constants::*,
    error::VaultError,
    events::RebalanceExecuted,
    state::{AssetKind, GlobalConfig, Index, RebalanceTicket, StrategyMode},
    vault, with_index_signer,
};

/// remaining_accounts: per asset `[mint, oracle]`.
#[derive(Accounts)]
pub struct BeginRebalance<'info> {
    pub executor: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(mut)]
    pub index: Box<Account<'info, Index>>,
    /// CHECK: validated as the index's ATA for asset_out.
    #[account(mut)]
    pub vault_out_ata: UncheckedAccount<'info>,
    /// CHECK: validated as a token account of asset_out's mint owned by the executor.
    #[account(mut)]
    pub executor_out_ata: UncheckedAccount<'info>,
    /// CHECK: validated as the index's ATA for asset_in.
    pub vault_in_ata: UncheckedAccount<'info>,
    /// CHECK: address-checked instructions sysvar.
    #[account(address = solana_instructions_sysvar::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub token_2022_program: Program<'info, Token2022>,
}

/// remaining_accounts: per asset `[mint, oracle]`.
#[derive(Accounts)]
pub struct EndRebalance<'info> {
    pub executor: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(mut)]
    pub index: Box<Account<'info, Index>>,
    /// CHECK: validated as the index's ATA for asset_in.
    pub vault_in_ata: UncheckedAccount<'info>,
}

/// Account position of `index` in EndRebalance (executor, config, index, ...).
const END_INDEX_ACCOUNT_POS: usize = 2;

fn allowed_between(program_id: &Pubkey, config: &GlobalConfig) -> bool {
    *program_id == config.market_program
        || *program_id == anchor_spl::token::ID
        || *program_id == anchor_spl::token_2022::ID
        || *program_id == anchor_spl::associated_token::ID
        || *program_id == COMPUTE_BUDGET_ID
}

/// Scan instructions after `begin`: only allowed programs until exactly one
/// `end_rebalance` for the same index (A04).
fn check_sandwich(ixs: &AccountInfo, index: &Pubkey, executor: &Pubkey, config: &GlobalConfig) -> Result<()> {
    let cur = load_current_index_checked(ixs)? as usize;
    let mut i = cur + 1;
    loop {
        let ix = match load_instruction_at_checked(i, ixs) {
            Ok(ix) => ix,
            Err(_) => return err!(VaultError::MissingEndInstruction),
        };
        if ix.program_id == crate::ID {
            let is_end = ix.data.len() >= 8 && &ix.data[..8] == crate::instruction::EndRebalance::DISCRIMINATOR;
            require!(is_end, VaultError::InvalidRebalanceTx);
            let idx = ix.accounts.get(END_INDEX_ACCOUNT_POS).ok_or(VaultError::InvalidRebalanceTx)?;
            require_keys_eq!(idx.pubkey, *index, VaultError::InvalidRebalanceTx);
            let exe = ix.accounts.first().ok_or(VaultError::InvalidRebalanceTx)?;
            require_keys_eq!(exe.pubkey, *executor, VaultError::InvalidRebalanceTx);
            return Ok(());
        }
        require!(allowed_between(&ix.program_id, config), VaultError::InvalidRebalanceTx);
        i += 1;
    }
}

pub fn handle_begin_rebalance<'info>(
    ctx: Context<'info, BeginRebalance<'info>>,
    asset_out: u8,
    amount_out: u64,
    asset_in: u8,
    min_amount_in: u64,
) -> Result<()> {
    require_eq!(get_stack_height(), TRANSACTION_LEVEL_STACK_HEIGHT, VaultError::NotTopLevel);
    let now = Clock::get()?.unix_timestamp;
    let config = &ctx.accounts.config;
    let index_key = ctx.accounts.index.key();
    let executor = ctx.accounts.executor.key();
    let rem = ctx.remaining_accounts;
    let index = &mut ctx.accounts.index;

    let n = index.assets.len();
    let (o, inn) = (asset_out as usize, asset_in as usize);
    require!(o != inn, VaultError::SameAsset);
    require!(o < n && inn < n, VaultError::InvalidAssetIndex);
    require!(amount_out > 0, VaultError::ZeroShares);
    require!(amount_out <= index.assets[o].balance, VaultError::InsufficientBalance);
    require!(!index.paused, VaultError::Paused);
    vault::guard_no_ticket(index)?;
    require!(
        now.saturating_sub(index.last_rebalance_ts) >= index.strategy.cooldown_secs as i64,
        VaultError::CooldownActive
    );

    let values = vault::balance_values(index, rem, config, now)?;
    let (drift_sum, drift_max) = m::drift(&values, &vault::targets(index)).ok_or(VaultError::MathOverflow)?;

    let privileged = executor == index.creator || index.is_manager(&executor);
    if !privileged {
        let s = index.strategy;
        require!(s.allow_keeper, VaultError::Unauthorized);
        require!(
            index.assets[o].kind != AssetKind::PreIpo && index.assets[inn].kind != AssetKind::PreIpo,
            VaultError::Unauthorized
        );
        let triggered = match s.mode {
            StrategyMode::Manual => false,
            StrategyMode::Threshold => drift_max > s.drift_threshold_bps as u32,
            StrategyMode::Periodic => now.saturating_sub(index.last_rebalance_ts) >= s.period_secs as i64,
        };
        require!(triggered, VaultError::TriggerNotMet);
    }

    check_sandwich(&ctx.accounts.instructions.to_account_info(), &index_key, &executor, config)?;

    let out_e = index.assets[o];
    let in_e = index.assets[inn];
    vault::expect_vault_ata(&ctx.accounts.vault_out_ata, &index_key, &out_e)?;
    vault::expect_vault_ata(&ctx.accounts.vault_in_ata, &index_key, &in_e)?;
    vault::expect_user_token_account(&ctx.accounts.executor_out_ata, &executor, &out_e)?;
    let ata_in_before = vault::read_token_account(&ctx.accounts.vault_in_ata)?.amount;
    let value_out = vault::value_of(&out_e, amount_out, &rem[2 * o], &rem[2 * o + 1], config, now)?;

    let program = vault::token_program_for(
        &out_e.token_program,
        &ctx.accounts.token_program.to_account_info(),
        &ctx.accounts.token_2022_program.to_account_info(),
    )?;
    let index_ai = index.to_account_info();
    {
        let index_ro: &Index = index;
        with_index_signer!(index_ro, |seeds| {
            vault::transfer_checked(
                &program,
                &ctx.accounts.vault_out_ata,
                &rem[2 * o],
                &ctx.accounts.executor_out_ata,
                &index_ai,
                amount_out,
                out_e.decimals,
                seeds,
            )
        })?;
    }
    index.assets[o].balance -= amount_out;
    index.rebalance_ticket = Some(RebalanceTicket {
        executor,
        asset_out,
        amount_out,
        asset_in,
        min_amount_in,
        ata_in_before,
        drift_before_bps: drift_sum,
        value_out,
    });
    Ok(())
}

pub fn handle_end_rebalance<'info>(ctx: Context<'info, EndRebalance<'info>>) -> Result<()> {
    require_eq!(get_stack_height(), TRANSACTION_LEVEL_STACK_HEIGHT, VaultError::NotTopLevel);
    let now = Clock::get()?.unix_timestamp;
    let config = &ctx.accounts.config;
    let index_key = ctx.accounts.index.key();
    let rem = ctx.remaining_accounts;
    let index = &mut ctx.accounts.index;

    let t = index.rebalance_ticket.ok_or(VaultError::NoTicket)?;
    require_keys_eq!(ctx.accounts.executor.key(), t.executor, VaultError::Unauthorized);
    let inn = t.asset_in as usize;
    let in_e = index.assets[inn];
    vault::expect_vault_ata(&ctx.accounts.vault_in_ata, &index_key, &in_e)?;
    let ata_now = vault::read_token_account(&ctx.accounts.vault_in_ata)?.amount;
    let amount_in = ata_now.checked_sub(t.ata_in_before).ok_or(VaultError::SlippageExceeded)?;
    require!(amount_in >= t.min_amount_in && amount_in > 0, VaultError::SlippageExceeded);
    index.assets[inn].balance = index.assets[inn].balance.checked_add(amount_in).ok_or(VaultError::MathOverflow)?;

    require!(rem.len() == index.assets.len() * 2, VaultError::AccountOrderMismatch);
    let value_in = vault::value_of(&index.assets[inn], amount_in, &rem[2 * inn], &rem[2 * inn + 1], config, now)?;
    let floor = (t.value_out as u128)
        .checked_mul(10_000u128 - index.strategy.max_slippage_bps as u128)
        .ok_or(VaultError::MathOverflow)?
        / 10_000u128;
    require!(value_in as u128 >= floor, VaultError::SlippageExceeded);

    let values = vault::balance_values(index, rem, config, now)?;
    let (drift_after, _) = m::drift(&values, &vault::targets(index)).ok_or(VaultError::MathOverflow)?;
    require!(drift_after <= t.drift_before_bps, VaultError::WrongDirection);

    index.rebalance_ticket = None;
    index.last_rebalance_ts = now;
    emit!(RebalanceExecuted {
        index: index_key,
        executor: t.executor,
        mint_out: index.assets[t.asset_out as usize].mint,
        amount_out: t.amount_out,
        mint_in: in_e.mint,
        amount_in,
        value_out: t.value_out,
        value_in,
        drift_before_bps: t.drift_before_bps,
        drift_after_bps: drift_after,
    });
    Ok(())
}
