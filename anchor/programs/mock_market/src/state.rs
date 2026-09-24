use anchor_lang::prelude::*;

/// Kind of a mock asset. Stored on its feed so vaults can trust it.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
pub enum AssetKind {
    Stock,
    PreIpo,
    Stable,
}

#[account]
#[derive(InitSpace)]
pub struct Market {
    pub authority: Pubkey,
    pub usdc_mint: Pubkey,
    pub spread_bps: u16,
    pub faucet_max: u64,
    pub oracle_max_age_secs: u32,
    pub bump: u8,
}

/// Pyth-shaped price per 1 UI unit of the token: `price * 10^expo` USD.
#[account]
#[derive(InitSpace)]
pub struct OracleFeed {
    pub mint: Pubkey,
    pub kind: AssetKind,
    pub price: i64,
    pub expo: i32,
    pub conf: u64,
    pub publish_time: i64,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct IpoConversion {
    pub old_mint: Pubkey,
    pub new_mint: Pubkey,
    pub ratio_num: u64,
    pub ratio_den: u64,
    pub active: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct PriceInput {
    pub price: i64,
    pub expo: i32,
    pub conf: u64,
}
