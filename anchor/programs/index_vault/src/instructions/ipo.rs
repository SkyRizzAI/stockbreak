use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::TokenInterface;
use index_math as m;
use mock_market::state::IpoConversion;

use crate::{
    constants::*,
    error::VaultError,
    events::IpoMigrated,
    oracle,
    state::{AssetKind, GlobalConfig, Index},
    vault, with_index_signer,
};

/// migrate_ipo_asset (PLAN §6.5). Permissionless; trusts only config.market_program.
#[derive(Accounts)]
pub struct MigrateIpoAsset<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(mut)]
    pub index: Box<Account<'info, Index>>,
    /// CHECK: must equal config.market_program.
    pub market_program: UncheckedAccount<'info>,
    /// CHECK: market PDA, validated by the market program during CPI.
    pub market: UncheckedAccount<'info>,
    /// CHECK: IpoConversion PDA of the market program, validated manually.
    pub ipo: UncheckedAccount<'info>,
    /// CHECK: must equal the asset's mint; validated by the market during CPI.
    #[account(mut)]
    pub old_mint: UncheckedAccount<'info>,
    /// CHECK: must equal ipo.new_mint.
    #[account(mut)]
    pub new_mint: UncheckedAccount<'info>,
    /// CHECK: feed PDA of new_mint, validated manually.
    pub new_feed: UncheckedAccount<'info>,
    /// CHECK: index ATA of old_mint, validated manually.
    #[account(mut)]
    pub vault_old_ata: UncheckedAccount<'info>,
    /// CHECK: index ATA of new_mint (created idempotently).
    #[account(mut)]
    pub vault_new_ata: UncheckedAccount<'info>,
    pub token_program_old: Interface<'info, TokenInterface>,
    pub token_program_new: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn handle_migrate_ipo_asset(ctx: Context<MigrateIpoAsset>, asset_idx: u8) -> Result<()> {
    let config = &ctx.accounts.config;
    let index_key = ctx.accounts.index.key();
    let a = &ctx.accounts;
    let i = asset_idx as usize;
    {
        let index = &a.index;
        vault::guard_no_ticket(index)?;
        require!(i < index.assets.len(), VaultError::InvalidAssetIndex);
    }
    let entry = a.index.assets[i];
    require!(entry.kind == AssetKind::PreIpo, VaultError::NotPreIpo);

    let market_program = config.market_program;
    require_keys_eq!(a.market_program.key(), market_program, VaultError::InvalidMarketProgram);
    require!(a.market_program.executable, VaultError::InvalidMarketProgram);

    // IPO conversion record.
    require_keys_eq!(*a.ipo.owner, market_program, VaultError::NoIpoConversion);
    let (ipo_pda, _) = Pubkey::find_program_address(&[mock_market::constants::IPO_SEED, entry.mint.as_ref()], &market_program);
    require_keys_eq!(a.ipo.key(), ipo_pda, VaultError::NoIpoConversion);
    let ipo = {
        let data = a.ipo.try_borrow_data()?;
        IpoConversion::try_deserialize(&mut &data[..]).map_err(|_| error!(VaultError::NoIpoConversion))?
    };
    require!(ipo.active, VaultError::NoIpoConversion);
    require_keys_eq!(ipo.old_mint, entry.mint, VaultError::NoIpoConversion);
    require_keys_eq!(ipo.new_mint, a.new_mint.key(), VaultError::NoIpoConversion);
    require_keys_eq!(a.old_mint.key(), entry.mint, VaultError::AccountOrderMismatch);
    require!(!a.index.assets.iter().any(|e| e.mint == ipo.new_mint), VaultError::DuplicateAsset);

    // New asset metadata.
    let new_feed = oracle::load_feed(&a.new_feed, &ipo.new_mint, &market_program)?;
    let new_mint_state = vault::read_mint(&a.new_mint)?;
    let new_tp = *a.new_mint.owner;
    require_keys_eq!(a.token_program_new.key(), new_tp, VaultError::AccountOrderMismatch);
    require_keys_eq!(a.token_program_old.key(), entry.token_program, VaultError::AccountOrderMismatch);
    vault::expect_vault_ata(&a.vault_old_ata, &index_key, &entry)?;
    require_keys_eq!(a.vault_new_ata.key(), vault::ata(&index_key, &ipo.new_mint, &new_tp), VaultError::AccountOrderMismatch);

    vault::create_vault_ata(
        &a.payer.to_account_info(),
        &a.vault_new_ata.to_account_info(),
        &a.index.to_account_info(),
        &a.new_mint.to_account_info(),
        &a.system_program.to_account_info(),
        &a.token_program_new.to_account_info(),
        &a.associated_token_program.to_account_info(),
    )?;
    let before = vault::read_token_account(&a.vault_new_ata)?.amount;
    let expected = m::convert_amount(entry.balance, ipo.ratio_num, ipo.ratio_den).ok_or(VaultError::MathOverflow)?;

    if entry.balance > 0 {
        let index_ai = a.index.to_account_info();
        let index_ro: &Index = &a.index;
        with_index_signer!(index_ro, |seeds| {
            mock_market::cpi::convert(
                CpiContext::new_with_signer(
                    market_program,
                    mock_market::cpi::accounts::Convert {
                        owner: index_ai.clone(),
                        market: a.market.to_account_info(),
                        ipo: a.ipo.to_account_info(),
                        old_mint: a.old_mint.to_account_info(),
                        new_mint: a.new_mint.to_account_info(),
                        owner_old_ata: a.vault_old_ata.to_account_info(),
                        owner_new_ata: a.vault_new_ata.to_account_info(),
                        token_program_old: a.token_program_old.to_account_info(),
                        token_program_new: a.token_program_new.to_account_info(),
                    },
                    seeds,
                ),
                entry.balance,
            )
        })?;
    }
    let after = vault::read_token_account(&a.vault_new_ata)?.amount;
    require!(after.checked_sub(before) == Some(expected), VaultError::ConversionMismatch);

    let index = &mut ctx.accounts.index;
    let e = &mut index.assets[i];
    e.mint = ipo.new_mint;
    e.token_program = new_tp;
    e.oracle = ctx.accounts.new_feed.key();
    e.decimals = new_mint_state.decimals;
    e.kind = oracle::feed_kind(&new_feed);
    e.balance = expected;
    emit!(IpoMigrated {
        index: index_key,
        old_mint: entry.mint,
        new_mint: ipo.new_mint,
        old_amount: entry.balance,
        new_amount: expected,
    });
    Ok(())
}
