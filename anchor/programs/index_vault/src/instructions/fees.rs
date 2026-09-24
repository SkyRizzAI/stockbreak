use anchor_lang::prelude::*;
use anchor_spl::token::Token;
use anchor_spl::token_interface::{mint_to, Mint, MintTo, TokenAccount};

use crate::{
    constants::*,
    error::VaultError,
    events::{FeesAccrued, FeesClaimed},
    state::{FeeKind, GlobalConfig, Index},
    vault, with_index_signer,
};

#[derive(Accounts)]
pub struct AccrueFees<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(mut, has_one = share_mint @ VaultError::AccountOrderMismatch)]
    pub index: Box<Account<'info, Index>>,
    pub share_mint: Box<InterfaceAccount<'info, Mint>>,
}

pub fn handle_accrue_fees(ctx: Context<AccrueFees>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let supply = ctx.accounts.share_mint.supply;
    let key = ctx.accounts.index.key();
    let index = &mut ctx.accounts.index;
    vault::guard_no_ticket(index)?;
    let (c, p, par) = vault::accrue(index, &ctx.accounts.config, supply, now)?;
    emit!(FeesAccrued { index: key, creator_shares: c, platform_shares: p, parent_shares: par, ts: now });
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimFees<'info> {
    #[account(mut)]
    pub claimer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(mut, has_one = share_mint @ VaultError::AccountOrderMismatch)]
    pub index: Box<Account<'info, Index>>,
    #[account(mut)]
    pub share_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(mut, token::mint = share_mint, token::authority = claimer, token::token_program = token_program)]
    pub recipient_share_ata: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Required for `FeeKind::Parent`.
    pub parent_index: Option<Box<Account<'info, Index>>>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_claim_fees(ctx: Context<ClaimFees>, kind: FeeKind) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let supply = ctx.accounts.share_mint.supply;
    let key = ctx.accounts.index.key();
    let claimer = ctx.accounts.claimer.key();
    let config = &ctx.accounts.config;
    let parent_creator = ctx.accounts.parent_index.as_ref().map(|p| (p.key(), p.creator));
    let index = &mut ctx.accounts.index;
    vault::guard_no_ticket(index)?;
    vault::accrue(index, config, supply, now)?;

    let amount = match kind {
        FeeKind::Creator => {
            require_keys_eq!(claimer, index.creator, VaultError::Unauthorized);
            std::mem::take(&mut index.owed_creator_shares)
        }
        FeeKind::Platform => {
            require_keys_eq!(claimer, config.platform_treasury, VaultError::Unauthorized);
            std::mem::take(&mut index.owed_platform_shares)
        }
        FeeKind::Parent => {
            let (pk, pc) = parent_creator.ok_or(VaultError::InvalidParent)?;
            require!(index.parent == Some(pk), VaultError::InvalidParent);
            require_keys_eq!(claimer, pc, VaultError::Unauthorized);
            std::mem::take(&mut index.owed_parent_shares)
        }
    };

    if amount > 0 {
        let index_ai = index.to_account_info();
        let index_ro: &Index = index;
        with_index_signer!(index_ro, |seeds| {
            mint_to(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.key(),
                    MintTo {
                        mint: ctx.accounts.share_mint.to_account_info(),
                        to: ctx.accounts.recipient_share_ata.to_account_info(),
                        authority: index_ai.clone(),
                    },
                    seeds,
                ),
                amount,
            )
        })?;
    }
    emit!(FeesClaimed { index: key, kind, recipient: claimer, shares: amount });
    Ok(())
}
