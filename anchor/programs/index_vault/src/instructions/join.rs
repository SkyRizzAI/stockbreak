use anchor_lang::prelude::*;
use anchor_spl::token::Token;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{mint_to, Mint, MintTo, TokenAccount};
use index_math as m;

use crate::{
    constants::*,
    error::VaultError,
    events::Joined,
    state::{GlobalConfig, Index},
    vault, with_index_signer,
};

/// remaining_accounts: per asset `[mint, vault_ata (w), user_ata (w)]`, then —
/// only for the first deposit (effective supply 0) — one `oracle` per asset.
#[derive(Accounts)]
pub struct Join<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(mut, has_one = share_mint @ VaultError::AccountOrderMismatch)]
    pub index: Box<Account<'info, Index>>,
    #[account(mut)]
    pub share_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = share_mint, token::authority = user, token::token_program = token_program)]
    pub user_share_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        associated_token::mint = share_mint,
        associated_token::authority = index,
        associated_token::token_program = token_program,
    )]
    pub index_share_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    pub token_program: Program<'info, Token>,
    pub token_2022_program: Program<'info, Token2022>,
}

pub fn handle_join<'info>(
    ctx: Context<'info, Join<'info>>,
    max_amounts: Vec<u64>,
    min_shares: u64,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let index_key = ctx.accounts.index.key();
    let user_key = ctx.accounts.user.key();
    let config = &ctx.accounts.config;
    let share_supply = ctx.accounts.share_mint.supply;
    let rem = ctx.remaining_accounts;

    let index = &mut ctx.accounts.index;
    vault::guard_no_ticket(index)?;
    require!(!index.paused, VaultError::Paused);
    let n = index.assets.len();
    require!(max_amounts.len() == n, VaultError::AccountOrderMismatch);
    require!(rem.len() == 3 * n || rem.len() == 4 * n, VaultError::AccountOrderMismatch);

    vault::accrue(index, config, share_supply, now)?;
    let supply = vault::effective_supply(share_supply, index)?;

    for (i, e) in index.assets.iter().enumerate() {
        require_keys_eq!(rem[3 * i].key(), e.mint, VaultError::AccountOrderMismatch);
        vault::expect_vault_ata(&rem[3 * i + 1], &index_key, e)?;
        vault::expect_user_token_account(&rem[3 * i + 2], &user_key, e)?;
    }

    let initial = supply == 0;
    let (gross, amounts): (u64, Vec<u64>) = if initial {
        require!(rem.len() == 4 * n, VaultError::AccountOrderMismatch);
        let mut values = Vec::with_capacity(n);
        let mut total: u64 = 0;
        for (i, e) in index.assets.iter().enumerate() {
            if e.target_weight_bps == 0 {
                require!(max_amounts[i] == 0, VaultError::InitialWeightMismatch);
            }
            let v = vault::value_of(e, max_amounts[i], &rem[3 * i], &rem[3 * n + i], config, now)?;
            total = total.checked_add(v).ok_or(VaultError::MathOverflow)?;
            values.push(v);
        }
        require!(total >= MIN_INITIAL_VALUE, VaultError::InitialValueTooSmall);
        let ok = m::initial_weights_ok(&values, &vault::targets(index), INITIAL_WEIGHT_TOLERANCE_BPS as u32)
            .ok_or(VaultError::MathOverflow)?;
        require!(ok, VaultError::InitialWeightMismatch);
        require!(total > LOCKED_SHARES, VaultError::InitialValueTooSmall);
        (total - LOCKED_SHARES, max_amounts.clone())
    } else {
        let balances: Vec<u64> = index.assets.iter().map(|a| a.balance).collect();
        let (shares_total, arr, _) =
            m::join_proportional(&max_amounts, &balances, supply).ok_or(VaultError::ZeroShares)?;
        (shares_total, arr[..n].to_vec())
    };

    let fee = m::bps_of(gross, index.fees.entry_fee_bps).ok_or(VaultError::MathOverflow)?;
    let user_shares = gross.checked_sub(fee).ok_or(VaultError::MathOverflow)?;
    require!(user_shares > 0, VaultError::ZeroShares);
    require!(user_shares >= min_shares, VaultError::SlippageExceeded);
    index.owed_creator_shares = index.owed_creator_shares.checked_add(fee).ok_or(VaultError::MathOverflow)?;

    let user_ai = ctx.accounts.user.to_account_info();
    let tp = ctx.accounts.token_program.to_account_info();
    let tp22 = ctx.accounts.token_2022_program.to_account_info();
    for (i, e) in index.assets.iter_mut().enumerate() {
        let program = vault::token_program_for(&e.token_program, &tp, &tp22)?;
        vault::transfer_checked(&program, &rem[3 * i + 2], &rem[3 * i], &rem[3 * i + 1], &user_ai, amounts[i], e.decimals, &[])?;
        e.balance = e.balance.checked_add(amounts[i]).ok_or(VaultError::MathOverflow)?;
    }

    let index_ai = index.to_account_info();
    let index_ro: &Index = index;
    with_index_signer!(index_ro, |seeds| {
        if initial {
            mint_to(
                CpiContext::new_with_signer(
                    tp.key(),
                    MintTo {
                        mint: ctx.accounts.share_mint.to_account_info(),
                        to: ctx.accounts.index_share_ata.to_account_info(),
                        authority: index_ai.clone(),
                    },
                    seeds,
                ),
                LOCKED_SHARES,
            )?;
        }
        mint_to(
            CpiContext::new_with_signer(
                tp.key(),
                MintTo {
                    mint: ctx.accounts.share_mint.to_account_info(),
                    to: ctx.accounts.user_share_ata.to_account_info(),
                    authority: index_ai.clone(),
                },
                seeds,
            ),
            user_shares,
        )?;
        Ok::<(), Error>(())
    })?;

    let minted = user_shares + if initial { LOCKED_SHARES } else { 0 };
    emit!(Joined {
        index: index_key,
        user: user_key,
        shares: user_shares,
        fee_shares: fee,
        amounts,
        supply_after: share_supply.checked_add(minted).ok_or(VaultError::MathOverflow)?,
    });
    Ok(())
}
