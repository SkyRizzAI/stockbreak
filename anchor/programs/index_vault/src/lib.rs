//! index_vault — tokenized stock index vaults (PLAN §5.1–§6).

pub mod constants;
pub mod error;
pub mod events;
pub mod instructions;
pub mod oracle;
pub mod state;
pub mod vault;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("4XaBXM6jZKj3mrQcezjA74ydDEBwiq1amzDtY7ZMc6me");

#[program]
pub mod index_vault {
    use super::*;

    pub fn init_config(ctx: Context<InitConfig>, params: ConfigParams) -> Result<()> {
        instructions::config::handle_init_config(ctx, params)
    }

    pub fn set_config(ctx: Context<SetConfig>, params: ConfigParams, new_admin: Option<Pubkey>) -> Result<()> {
        instructions::config::handle_set_config(ctx, params, new_admin)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_index<'info>(
        ctx: Context<'info, CreateIndex<'info>>,
        index_id: u64,
        name: String,
        symbol: String,
        uri: String,
        assets: Vec<AssetInput>,
        fees: FeeConfig,
        strategy: Strategy,
        follows_parent: bool,
    ) -> Result<()> {
        instructions::create_index::handle_create_index(
            ctx, index_id, name, symbol, uri, assets, fees, strategy, follows_parent,
        )
    }

    pub fn join<'info>(ctx: Context<'info, Join<'info>>, max_amounts: Vec<u64>, min_shares: u64) -> Result<()> {
        instructions::join::handle_join(ctx, max_amounts, min_shares)
    }

    pub fn redeem<'info>(ctx: Context<'info, Redeem<'info>>, shares: u64, min_amounts: Vec<u64>) -> Result<()> {
        instructions::redeem::handle_redeem(ctx, shares, min_amounts)
    }

    pub fn accrue_fees(ctx: Context<AccrueFees>) -> Result<()> {
        instructions::fees::handle_accrue_fees(ctx)
    }

    pub fn claim_fees(ctx: Context<ClaimFees>, kind: FeeKind) -> Result<()> {
        instructions::fees::handle_claim_fees(ctx, kind)
    }

    pub fn propose_update<'info>(ctx: Context<'info, ProposeUpdate<'info>>, update: UpdateInput) -> Result<()> {
        instructions::manage::handle_propose_update(ctx, update)
    }

    pub fn apply_update<'info>(ctx: Context<'info, ApplyUpdate<'info>>) -> Result<()> {
        instructions::manage::handle_apply_update(ctx)
    }

    pub fn cancel_update(ctx: Context<CreatorOnly>) -> Result<()> {
        instructions::manage::handle_cancel_update(ctx)
    }

    pub fn set_managers(ctx: Context<CreatorOnly>, managers: Vec<Pubkey>) -> Result<()> {
        instructions::manage::handle_set_managers(ctx, managers)
    }

    pub fn set_paused(ctx: Context<CreatorOnly>, paused: bool) -> Result<()> {
        instructions::manage::handle_set_paused(ctx, paused)
    }

    pub fn begin_rebalance<'info>(
        ctx: Context<'info, BeginRebalance<'info>>,
        asset_out: u8,
        amount_out: u64,
        asset_in: u8,
        min_amount_in: u64,
    ) -> Result<()> {
        instructions::rebalance::handle_begin_rebalance(ctx, asset_out, amount_out, asset_in, min_amount_in)
    }

    pub fn end_rebalance<'info>(ctx: Context<'info, EndRebalance<'info>>) -> Result<()> {
        instructions::rebalance::handle_end_rebalance(ctx)
    }

    pub fn migrate_ipo_asset(ctx: Context<MigrateIpoAsset>, asset_idx: u8) -> Result<()> {
        instructions::ipo::handle_migrate_ipo_asset(ctx, asset_idx)
    }

    pub fn sync_targets_from_parent<'info>(ctx: Context<'info, SyncTargetsFromParent<'info>>) -> Result<()> {
        instructions::follow::handle_sync_targets_from_parent(ctx)
    }
}
