use anchor_lang::prelude::*;

#[error_code]
pub enum MarketError {
    #[msg("Signer is not the market authority")]
    Unauthorized,
    #[msg("Symbol must be 1-16 characters")]
    InvalidSymbol,
    #[msg("Decimals must be between 0 and 9")]
    InvalidDecimals,
    #[msg("Spread exceeds the maximum")]
    InvalidSpread,
    #[msg("Price must be positive")]
    InvalidPrice,
    #[msg("Oracle price is stale")]
    OracleStale,
    #[msg("Faucet amount exceeds the per-call maximum")]
    FaucetLimitExceeded,
    #[msg("Input and output mint must differ")]
    SameMint,
    #[msg("Output is below the minimum")]
    SlippageExceeded,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Mint is not issued by this market")]
    NotMarketMint,
    #[msg("Token program does not match the mint")]
    InvalidTokenProgram,
    #[msg("IPO conversion is not active")]
    IpoInactive,
    #[msg("Invalid conversion ratio")]
    InvalidRatio,
    #[msg("Feed does not match the mint")]
    FeedMismatch,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Multiplier must be a positive finite number")]
    InvalidMultiplier,
    #[msg("Too many prices in one transaction")]
    TooManyPrices,
}
