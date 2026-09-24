//! mock_market — simulated oracle, DEX, faucet and issuer (PLAN §5.4).
//! Every mock token's mint authority is the market PDA.

pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;
pub mod utils;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("9WK7engPUC9pegD4wfJN4tCDPcZGxERVifRNHxsehqX8");

#[program]
pub mod mock_market {
    use super::*;

    pub fn init_market(
        ctx: Context<InitMarket>,
        spread_bps: u16,
        faucet_max: u64,
        oracle_max_age_secs: u32,
    ) -> Result<()> {
        instructions::init_market::handle_init_market(ctx, spread_bps, faucet_max, oracle_max_age_secs)
    }

    pub fn create_mock_mint(
        ctx: Context<CreateMockMint>,
        symbol: String,
        decimals: u8,
        token_2022: bool,
        scaled_ui: bool,
    ) -> Result<()> {
        instructions::create_mock_mint::handle_create_mock_mint(ctx, symbol, decimals, token_2022, scaled_ui)
    }

    pub fn create_feed(ctx: Context<CreateFeed>, kind: AssetKind) -> Result<()> {
        instructions::create_feed::handle_create_feed(ctx, kind)
    }

    pub fn set_prices<'info>(ctx: Context<'info, SetPrices<'info>>, prices: Vec<PriceInput>) -> Result<()> {
        instructions::set_prices::handle_set_prices(ctx, prices)
    }

    pub fn set_multiplier(ctx: Context<SetMultiplier>, multiplier: f64, effective_ts: i64) -> Result<()> {
        instructions::set_multiplier::handle_set_multiplier(ctx, multiplier, effective_ts)
    }

    pub fn faucet(ctx: Context<Faucet>, amount: u64) -> Result<()> {
        instructions::faucet::handle_faucet(ctx, amount)
    }

    pub fn swap(ctx: Context<Swap>, amount_in: u64, min_out: u64) -> Result<()> {
        instructions::swap::handle_swap(ctx, amount_in, min_out)
    }

    pub fn register_ipo(ctx: Context<RegisterIpo>, ratio_num: u64, ratio_den: u64) -> Result<()> {
        instructions::register_ipo::handle_register_ipo(ctx, ratio_num, ratio_den)
    }

    pub fn convert(ctx: Context<Convert>, amount: u64) -> Result<()> {
        instructions::convert::handle_convert(ctx, amount)
    }
}
