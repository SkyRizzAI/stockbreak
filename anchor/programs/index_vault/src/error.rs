use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("Target weights must sum to 100% and be non-zero")]
    InvalidWeights,
    #[msg("Fee exceeds the allowed maximum")]
    FeeTooHigh,
    #[msg("Max slippage is outside the allowed range")]
    InvalidSlippage,
    #[msg("Too many assets")]
    TooManyAssets,
    #[msg("Duplicate asset")]
    DuplicateAsset,
    #[msg("Index is paused")]
    Paused,
    #[msg("Result is worse than the minimum you accepted")]
    SlippageExceeded,
    #[msg("Zero shares")]
    ZeroShares,
    #[msg("First deposit is too small")]
    InitialValueTooSmall,
    #[msg("First deposit does not match the target weights")]
    InitialWeightMismatch,
    #[msg("Not allowed")]
    Unauthorized,
    #[msg("Rebalance cooldown is active")]
    CooldownActive,
    #[msg("Strategy trigger is not met")]
    TriggerNotMet,
    #[msg("A rebalance is in progress")]
    RebalanceInProgress,
    #[msg("No rebalance in progress")]
    NoTicket,
    #[msg("Assets in and out must differ")]
    SameAsset,
    #[msg("Rebalance is missing its end instruction")]
    MissingEndInstruction,
    #[msg("Rebalance transaction contains a disallowed instruction")]
    InvalidRebalanceTx,
    #[msg("Must be called directly, not via CPI")]
    NotTopLevel,
    #[msg("Oracle price is stale")]
    OracleStale,
    #[msg("Oracle confidence is too wide")]
    OracleConfidence,
    #[msg("Invalid oracle price")]
    InvalidPrice,
    #[msg("Invalid oracle account")]
    InvalidOracle,
    #[msg("Invalid market program")]
    InvalidMarketProgram,
    #[msg("Rebalance must reduce drift")]
    WrongDirection,
    #[msg("Update is still timelocked")]
    TimelockActive,
    #[msg("No pending update")]
    NoPendingUpdate,
    #[msg("Asset still holds a balance and cannot be removed")]
    AssetStillFunded,
    #[msg("Asset is not pre-IPO")]
    NotPreIpo,
    #[msg("No active IPO conversion for this asset")]
    NoIpoConversion,
    #[msg("IPO conversion returned an unexpected amount")]
    ConversionMismatch,
    #[msg("Index does not follow a parent")]
    NotFollowing,
    #[msg("Invalid parent index")]
    InvalidParent,
    #[msg("Accounts do not match the index asset list")]
    AccountOrderMismatch,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Name, symbol or URI is invalid")]
    InvalidMetadata,
    #[msg("Invalid asset index")]
    InvalidAssetIndex,
    #[msg("Amount exceeds the vault balance")]
    InsufficientBalance,
    #[msg("Invalid manager list")]
    InvalidManagers,
    #[msg("Invalid config value")]
    InvalidConfig,
}
