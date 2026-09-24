//! Shared helpers: account validation, CPIs, fee accrual and valuation.

use anchor_lang::prelude::*;
use anchor_spl::associated_token::{self, get_associated_token_address_with_program_id};
use anchor_spl::token_interface::{self, Mint, TokenAccount, TransferChecked};
use index_math as m;

use crate::{
    constants::*,
    error::VaultError,
    oracle,
    state::{AssetEntry, AssetInput, FeeConfig, GlobalConfig, Index, Strategy, StrategyMode},
};

/// Build the Index PDA signer seeds into `$out` (a `&[&[&[u8]]]`) for `$body`.
#[macro_export]
macro_rules! with_index_signer {
    ($index:expr, |$seeds:ident| $body:expr) => {{
        let __id = $index.index_id.to_le_bytes();
        let __bump = [$index.bump];
        let __creator = $index.creator;
        let __s: &[&[u8]] = &[$crate::constants::INDEX_SEED, __creator.as_ref(), &__id, &__bump];
        let $seeds: &[&[&[u8]]] = &[__s];
        $body
    }};
}

pub fn guard_no_ticket(index: &Index) -> Result<()> {
    require!(index.rebalance_ticket.is_none(), VaultError::RebalanceInProgress);
    Ok(())
}

pub fn is_token_program(key: &Pubkey) -> bool {
    *key == anchor_spl::token::ID || *key == anchor_spl::token_2022::ID
}

/// Pick the passed token program account that owns `mint_owner`.
pub fn token_program_for<'info>(
    program_id: &Pubkey,
    token_program: &AccountInfo<'info>,
    token_2022_program: &AccountInfo<'info>,
) -> Result<AccountInfo<'info>> {
    if *program_id == anchor_spl::token::ID && token_program.key() == anchor_spl::token::ID {
        Ok(token_program.clone())
    } else if *program_id == anchor_spl::token_2022::ID && token_2022_program.key() == anchor_spl::token_2022::ID {
        Ok(token_2022_program.clone())
    } else {
        err!(VaultError::AccountOrderMismatch)
    }
}

pub fn read_mint(ai: &AccountInfo) -> Result<Mint> {
    require!(is_token_program(ai.owner), VaultError::AccountOrderMismatch);
    let data = ai.try_borrow_data()?;
    Mint::try_deserialize(&mut &data[..]).map_err(|_| error!(VaultError::AccountOrderMismatch))
}

pub fn read_token_account(ai: &AccountInfo) -> Result<TokenAccount> {
    require!(is_token_program(ai.owner), VaultError::AccountOrderMismatch);
    let data = ai.try_borrow_data()?;
    TokenAccount::try_deserialize(&mut &data[..]).map_err(|_| error!(VaultError::AccountOrderMismatch))
}

pub fn ata(owner: &Pubkey, mint: &Pubkey, token_program: &Pubkey) -> Pubkey {
    get_associated_token_address_with_program_id(owner, mint, token_program)
}

/// Vault ATA of `index` for `entry` must be exactly the derived address.
pub fn expect_vault_ata(ai: &AccountInfo, index: &Pubkey, entry: &AssetEntry) -> Result<()> {
    require_keys_eq!(ai.key(), ata(index, &entry.mint, &entry.token_program), VaultError::AccountOrderMismatch);
    Ok(())
}

/// A user's token account for `entry.mint` owned by `owner`.
pub fn expect_user_token_account(ai: &AccountInfo, owner: &Pubkey, entry: &AssetEntry) -> Result<TokenAccount> {
    require_keys_eq!(*ai.owner, entry.token_program, VaultError::AccountOrderMismatch);
    let ta = read_token_account(ai)?;
    require_keys_eq!(ta.mint, entry.mint, VaultError::AccountOrderMismatch);
    require_keys_eq!(ta.owner, *owner, VaultError::AccountOrderMismatch);
    Ok(ta)
}

#[allow(clippy::too_many_arguments)]
pub fn transfer_checked<'info>(
    token_program: &AccountInfo<'info>,
    from: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    amount: u64,
    decimals: u8,
    signer: &[&[&[u8]]],
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            token_program.key(),
            TransferChecked {
                from: from.clone(),
                mint: mint.clone(),
                to: to.clone(),
                authority: authority.clone(),
            },
            signer,
        ),
        amount,
        decimals,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn create_vault_ata<'info>(
    payer: &AccountInfo<'info>,
    vault_ata: &AccountInfo<'info>,
    index: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    associated_token_program: &AccountInfo<'info>,
) -> Result<()> {
    associated_token::create_idempotent(CpiContext::new(
        associated_token_program.key(),
        associated_token::Create {
            payer: payer.clone(),
            associated_token: vault_ata.clone(),
            authority: index.clone(),
            mint: mint.clone(),
            system_program: system_program.clone(),
            token_program: token_program.clone(),
        },
    ))
}

/// Effective supply = share mint supply + unclaimed fee shares (PLAN §5).
pub fn effective_supply(share_supply: u64, index: &Index) -> Result<u64> {
    share_supply
        .checked_add(index.owed_total().ok_or(VaultError::MathOverflow)?)
        .ok_or_else(|| error!(VaultError::MathOverflow))
}

/// accrue_fees (PLAN §6.4): only increases owed_* and moves last_fee_ts.
pub fn accrue(index: &mut Index, config: &GlobalConfig, share_supply: u64, now: i64) -> Result<(u64, u64, u64)> {
    let supply = effective_supply(share_supply, index)?;
    let elapsed = now.saturating_sub(index.last_fee_ts);
    let (c, p, par) = m::accrue_fees(
        supply,
        elapsed,
        index.fees.mgmt_fee_bps,
        config.platform_fee_bps,
        config.clone_royalty_bps,
        index.parent.is_some(),
    )
    .ok_or(VaultError::MathOverflow)?;
    index.owed_creator_shares = index.owed_creator_shares.checked_add(c).ok_or(VaultError::MathOverflow)?;
    index.owed_platform_shares = index.owed_platform_shares.checked_add(p).ok_or(VaultError::MathOverflow)?;
    index.owed_parent_shares = index.owed_parent_shares.checked_add(par).ok_or(VaultError::MathOverflow)?;
    index.last_fee_ts = now;
    Ok((c, p, par))
}

/// Value (micro-USD) of `amount` of `entry` given its mint and oracle accounts.
pub fn value_of(
    entry: &AssetEntry,
    amount: u64,
    mint_ai: &AccountInfo,
    oracle_ai: &AccountInfo,
    config: &GlobalConfig,
    now: i64,
) -> Result<u64> {
    require_keys_eq!(mint_ai.key(), entry.mint, VaultError::AccountOrderMismatch);
    require_keys_eq!(oracle_ai.key(), entry.oracle, VaultError::AccountOrderMismatch);
    let price = oracle::read_price(oracle_ai, &entry.mint, &config.market_program, config.oracle_max_age_secs, now)?;
    let mult = mock_market::utils::mint_mult_fp(mint_ai, now)?;
    m::value_usd(amount, entry.decimals, mult, price).ok_or_else(|| error!(VaultError::MathOverflow))
}

/// Values of every asset's internal balance. `pairs` = [mint, oracle] per asset.
pub fn balance_values(index: &Index, pairs: &[AccountInfo], config: &GlobalConfig, now: i64) -> Result<Vec<u64>> {
    require!(pairs.len() == index.assets.len() * 2, VaultError::AccountOrderMismatch);
    let mut out = Vec::with_capacity(index.assets.len());
    for (i, e) in index.assets.iter().enumerate() {
        out.push(value_of(e, e.balance, &pairs[2 * i], &pairs[2 * i + 1], config, now)?);
    }
    Ok(out)
}

pub fn targets(index: &Index) -> Vec<u16> {
    index.assets.iter().map(|a| a.target_weight_bps).collect()
}

pub fn validate_metadata(name: &str, symbol: &str, uri: &str) -> Result<()> {
    require!(!name.is_empty() && name.len() <= MAX_NAME_LEN, VaultError::InvalidMetadata);
    require!(!symbol.is_empty() && symbol.len() <= MAX_SYMBOL_LEN, VaultError::InvalidMetadata);
    require!(uri.len() <= MAX_URI_LEN, VaultError::InvalidMetadata);
    Ok(())
}

pub fn validate_fees(fees: &FeeConfig) -> Result<()> {
    require!(fees.mgmt_fee_bps <= MAX_MGMT_FEE_BPS, VaultError::FeeTooHigh);
    require!(fees.entry_fee_bps <= MAX_ENTRY_FEE_BPS, VaultError::FeeTooHigh);
    require!(fees.exit_fee_bps <= MAX_EXIT_FEE_BPS, VaultError::FeeTooHigh);
    Ok(())
}

pub fn validate_strategy(s: &Strategy) -> Result<()> {
    require!(
        s.max_slippage_bps >= MIN_SLIPPAGE_BPS && s.max_slippage_bps <= MAX_SLIPPAGE_BPS,
        VaultError::InvalidSlippage
    );
    if s.mode == StrategyMode::Threshold {
        require!(s.drift_threshold_bps > 0 && s.drift_threshold_bps <= 10_000, VaultError::InvalidConfig);
    }
    if s.mode == StrategyMode::Periodic {
        require!(s.period_secs > 0, VaultError::InvalidConfig);
    }
    Ok(())
}

/// Weights sum to 100%, unique mints, 1..=MAX_ASSETS. `allow_zero` for updates.
pub fn validate_inputs(inputs: &[AssetInput], allow_zero: bool) -> Result<()> {
    require!(!inputs.is_empty(), VaultError::InvalidWeights);
    require!(inputs.len() <= MAX_ASSETS, VaultError::TooManyAssets);
    let mut total: u32 = 0;
    for (i, a) in inputs.iter().enumerate() {
        require!(allow_zero || a.target_weight_bps > 0, VaultError::InvalidWeights);
        total += a.target_weight_bps as u32;
        for b in inputs.iter().skip(i + 1) {
            require_keys_neq!(a.mint, b.mint, VaultError::DuplicateAsset);
        }
    }
    require!(total == TOTAL_WEIGHT_BPS as u32, VaultError::InvalidWeights);
    Ok(())
}

/// Build asset entries from inputs + remaining accounts laid out as
/// `[mint, oracle, ...extra]` with `stride` accounts per asset.
pub fn build_entries(
    inputs: &[AssetInput],
    accounts: &[AccountInfo],
    stride: usize,
    config: &GlobalConfig,
    existing: &[AssetEntry],
) -> Result<Vec<AssetEntry>> {
    require!(accounts.len() == inputs.len() * stride, VaultError::AccountOrderMismatch);
    let mut out = Vec::with_capacity(inputs.len());
    for (i, input) in inputs.iter().enumerate() {
        let mint_ai = &accounts[stride * i];
        let oracle_ai = &accounts[stride * i + 1];
        require_keys_eq!(mint_ai.key(), input.mint, VaultError::AccountOrderMismatch);
        let mint = read_mint(mint_ai)?;
        let feed = oracle::load_feed(oracle_ai, &input.mint, &config.market_program)?;
        let balance = existing.iter().find(|e| e.mint == input.mint).map(|e| e.balance).unwrap_or(0);
        out.push(AssetEntry {
            mint: input.mint,
            token_program: *mint_ai.owner,
            oracle: oracle_ai.key(),
            target_weight_bps: input.target_weight_bps,
            kind: oracle::feed_kind(&feed),
            decimals: mint.decimals,
            balance,
        });
    }
    Ok(out)
}

/// Replace `index.assets` with `next` following apply_update rules (PLAN §5.3):
/// funded assets must stay; unfunded zero-weight entries are dropped.
pub fn replace_assets(index: &mut Index, mut next: Vec<AssetEntry>) -> Result<()> {
    for cur in index.assets.iter() {
        if cur.balance > 0 {
            require!(next.iter().any(|n| n.mint == cur.mint), VaultError::AssetStillFunded);
        }
    }
    for n in next.iter_mut() {
        n.balance = index.assets.iter().find(|c| c.mint == n.mint).map(|c| c.balance).unwrap_or(0);
    }
    next.retain(|n| n.balance > 0 || n.target_weight_bps > 0);
    require!(!next.is_empty(), VaultError::InvalidWeights);
    require!(next.len() <= MAX_ASSETS, VaultError::TooManyAssets);
    index.assets = next;
    Ok(())
}
