use anchor_lang::prelude::*;
use anchor_spl::token::Token;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{burn, Burn, Mint, TokenAccount};
use index_math as m;

use crate::{
    constants::*,
    error::VaultError,
    events::Redeemed,
    state::{GlobalConfig, Index},
    vault, with_index_signer,
};

/// remaining_accounts: per asset `[mint, vault_ata (w), user_ata (w)]`.
/// Never depends on creator/platform accounts: redeem cannot be blocked.
#[derive(Accounts)]
pub struct Redeem<'info> {
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
    pub token_program: Program<'info, Token>,
    pub token_2022_program: Program<'info, Token2022>,
}

pub fn handle_redeem<'info>(ctx: Context<'info, Redeem<'info>>, shares: u64, min_amounts: Vec<u64>) -> Result<()> {
    require!(shares > 0, VaultError::ZeroShares);
    let now = Clock::get()?.unix_timestamp;
    let index_key = ctx.accounts.index.key();
    let user_key = ctx.accounts.user.key();
    let config = &ctx.accounts.config;
    let share_supply = ctx.accounts.share_mint.supply;
    let rem = ctx.remaining_accounts;

    let index = &mut ctx.accounts.index;
    vault::guard_no_ticket(index)?;
    let n = index.assets.len();
    require!(min_amounts.len() == n, VaultError::AccountOrderMismatch);
    require!(rem.len() == 3 * n, VaultError::AccountOrderMismatch);

    vault::accrue(index, config, share_supply, now)?;
    let supply = vault::effective_supply(share_supply, index)?;
    let fee = m::bps_of(shares, index.fees.exit_fee_bps).ok_or(VaultError::MathOverflow)?;
    let net = shares.checked_sub(fee).ok_or(VaultError::MathOverflow)?;

    let mut amounts = Vec::with_capacity(n);
    for (i, e) in index.assets.iter().enumerate() {
        require_keys_eq!(rem[3 * i].key(), e.mint, VaultError::AccountOrderMismatch);
        vault::expect_vault_ata(&rem[3 * i + 1], &index_key, e)?;
        vault::expect_user_token_account(&rem[3 * i + 2], &user_key, e)?;
        let a = m::redeem_amount(net, e.balance, supply).ok_or(VaultError::MathOverflow)?;
        require!(a >= min_amounts[i], VaultError::SlippageExceeded);
        amounts.push(a);
    }

    burn(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            Burn {
                mint: ctx.accounts.share_mint.to_account_info(),
                from: ctx.accounts.user_share_ata.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        shares,
    )?;
    index.owed_creator_shares = index.owed_creator_shares.checked_add(fee).ok_or(VaultError::MathOverflow)?;

    let tp = ctx.accounts.token_program.to_account_info();
    let tp22 = ctx.accounts.token_2022_program.to_account_info();
    let index_ai = index.to_account_info();
    let snapshot: Vec<(Pubkey, u8)> = index.assets.iter().map(|e| (e.token_program, e.decimals)).collect();
    {
        let index_ro: &Index = index;
        with_index_signer!(index_ro, |seeds| {
            for (i, (program_id, decimals)) in snapshot.iter().enumerate() {
                let program = vault::token_program_for(program_id, &tp, &tp22)?;
                vault::transfer_checked(&program, &rem[3 * i + 1], &rem[3 * i], &rem[3 * i + 2], &index_ai, amounts[i], *decimals, seeds)?;
            }
            Ok::<(), Error>(())
        })?;
    }
    for (i, e) in index.assets.iter_mut().enumerate() {
        e.balance = e.balance.checked_sub(amounts[i]).ok_or(VaultError::MathOverflow)?;
    }

    emit!(Redeemed {
        index: index_key,
        user: user_key,
        shares,
        fee_shares: fee,
        amounts,
        supply_after: share_supply.checked_sub(shares).ok_or(VaultError::MathOverflow)?,
    });
    Ok(())
}
