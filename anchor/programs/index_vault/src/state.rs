use anchor_lang::prelude::*;

use crate::constants::*;

#[account]
#[derive(InitSpace)]
pub struct GlobalConfig {
    pub admin: Pubkey,
    pub platform_treasury: Pubkey,
    /// Per year of AUM.
    pub platform_fee_bps: u16,
    /// Share of a derived index's creator fee paid to the parent creator.
    pub clone_royalty_bps: u16,
    /// The only market program the vault trusts (oracles, swaps, IPO conversion).
    pub market_program: Pubkey,
    pub timelock_secs: u32,
    pub oracle_max_age_secs: u32,
    pub index_count: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum AssetKind {
    Stock,
    PreIpo,
    Stable,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct AssetEntry {
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub oracle: Pubkey,
    pub target_weight_bps: u16,
    pub kind: AssetKind,
    pub decimals: u8,
    /// Internal bookkeeping; direct transfers to the vault ATA are ignored.
    pub balance: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct FeeConfig {
    pub mgmt_fee_bps: u16,
    pub entry_fee_bps: u16,
    pub exit_fee_bps: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum StrategyMode {
    Manual,
    Threshold,
    Periodic,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct Strategy {
    pub mode: StrategyMode,
    pub drift_threshold_bps: u16,
    pub period_secs: u32,
    pub max_slippage_bps: u16,
    pub cooldown_secs: u32,
    pub allow_keeper: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug, InitSpace)]
pub struct PendingUpdate {
    #[max_len(MAX_ASSETS)]
    pub assets: Option<Vec<AssetEntry>>,
    pub fees: Option<FeeConfig>,
    pub strategy: Option<Strategy>,
    pub eta: i64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub struct RebalanceTicket {
    pub executor: Pubkey,
    pub asset_out: u8,
    pub amount_out: u64,
    pub asset_in: u8,
    pub min_amount_in: u64,
    pub ata_in_before: u64,
    pub drift_before_bps: u32,
    pub value_out: u64,
}

#[account]
#[derive(InitSpace)]
pub struct Index {
    pub creator: Pubkey,
    pub index_id: u64,
    pub share_mint: Pubkey,
    #[max_len(MAX_NAME_LEN)]
    pub name: String,
    #[max_len(MAX_SYMBOL_LEN)]
    pub symbol: String,
    #[max_len(MAX_URI_LEN)]
    pub uri: String,
    #[max_len(MAX_ASSETS)]
    pub assets: Vec<AssetEntry>,
    pub fees: FeeConfig,
    pub strategy: Strategy,
    pub managers: [Pubkey; MAX_MANAGERS],
    pub parent: Option<Pubkey>,
    pub follows_parent: bool,
    pub pending_update: Option<PendingUpdate>,
    /// Stops join & rebalance. Redeem is always allowed.
    pub paused: bool,
    pub owed_creator_shares: u64,
    pub owed_platform_shares: u64,
    pub owed_parent_shares: u64,
    pub last_fee_ts: i64,
    pub last_rebalance_ts: i64,
    pub rebalance_ticket: Option<RebalanceTicket>,
    pub created_at: i64,
    pub bump: u8,
    pub share_mint_bump: u8,
}

impl Index {
    pub fn owed_total(&self) -> Option<u64> {
        self.owed_creator_shares
            .checked_add(self.owed_platform_shares)?
            .checked_add(self.owed_parent_shares)
    }

    pub fn is_manager(&self, key: &Pubkey) -> bool {
        *key != Pubkey::default() && self.managers.iter().any(|m| m == key)
    }
}

/// Input for create_index / propose_update. Everything else about an asset
/// (kind, decimals, token program, oracle) is derived on-chain.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub struct AssetInput {
    pub mint: Pubkey,
    pub target_weight_bps: u16,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub struct UpdateInput {
    pub assets: Option<Vec<AssetInput>>,
    pub fees: Option<FeeConfig>,
    pub strategy: Option<Strategy>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub struct ConfigParams {
    pub platform_treasury: Pubkey,
    pub platform_fee_bps: u16,
    pub clone_royalty_bps: u16,
    pub market_program: Pubkey,
    pub timelock_secs: u32,
    pub oracle_max_age_secs: u32,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum FeeKind {
    Creator,
    Platform,
    Parent,
}
