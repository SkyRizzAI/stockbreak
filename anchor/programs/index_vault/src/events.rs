use anchor_lang::prelude::*;

use crate::state::FeeKind;

#[event]
pub struct IndexCreated {
    pub index: Pubkey,
    pub creator: Pubkey,
    pub index_id: u64,
    pub parent: Option<Pubkey>,
    pub follows_parent: bool,
    pub name: String,
    pub symbol: String,
}

#[event]
pub struct Joined {
    pub index: Pubkey,
    pub user: Pubkey,
    pub shares: u64,
    pub fee_shares: u64,
    pub amounts: Vec<u64>,
    pub supply_after: u64,
}

#[event]
pub struct Redeemed {
    pub index: Pubkey,
    pub user: Pubkey,
    pub shares: u64,
    pub fee_shares: u64,
    pub amounts: Vec<u64>,
    pub supply_after: u64,
}

#[event]
pub struct FeesAccrued {
    pub index: Pubkey,
    pub creator_shares: u64,
    pub platform_shares: u64,
    pub parent_shares: u64,
    pub ts: i64,
}

#[event]
pub struct FeesClaimed {
    pub index: Pubkey,
    pub kind: FeeKind,
    pub recipient: Pubkey,
    pub shares: u64,
}

#[event]
pub struct IndexUpdateProposed {
    pub index: Pubkey,
    pub eta: i64,
    pub assets_changed: bool,
    pub fees_changed: bool,
    pub strategy_changed: bool,
}

#[event]
pub struct IndexUpdated {
    pub index: Pubkey,
    pub assets_changed: bool,
    pub fees_changed: bool,
    pub strategy_changed: bool,
}

#[event]
pub struct IndexUpdateCancelled {
    pub index: Pubkey,
}

#[event]
pub struct RebalanceExecuted {
    pub index: Pubkey,
    pub executor: Pubkey,
    pub mint_out: Pubkey,
    pub amount_out: u64,
    pub mint_in: Pubkey,
    pub amount_in: u64,
    pub value_out: u64,
    pub value_in: u64,
    pub drift_before_bps: u32,
    pub drift_after_bps: u32,
}

#[event]
pub struct IpoMigrated {
    pub index: Pubkey,
    pub old_mint: Pubkey,
    pub new_mint: Pubkey,
    pub old_amount: u64,
    pub new_amount: u64,
}

#[event]
pub struct ManagersSet {
    pub index: Pubkey,
    pub managers: Vec<Pubkey>,
}

#[event]
pub struct PausedSet {
    pub index: Pubkey,
    pub paused: bool,
}

#[event]
pub struct TargetsSynced {
    pub index: Pubkey,
    pub parent: Pubkey,
}

#[event]
pub struct ConfigUpdated {
    pub admin: Pubkey,
    pub platform_fee_bps: u16,
    pub clone_royalty_bps: u16,
}
