use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::VaultError,
    events::ConfigUpdated,
    state::{ConfigParams, GlobalConfig},
};

fn validate(params: &ConfigParams) -> Result<()> {
    require!(params.platform_fee_bps <= MAX_PLATFORM_FEE_BPS, VaultError::FeeTooHigh);
    require!(params.clone_royalty_bps <= MAX_CLONE_ROYALTY_BPS, VaultError::FeeTooHigh);
    require!(params.market_program != Pubkey::default(), VaultError::InvalidMarketProgram);
    require!(params.oracle_max_age_secs > 0, VaultError::InvalidConfig);
    Ok(())
}

fn apply(config: &mut GlobalConfig, p: &ConfigParams) {
    config.platform_treasury = p.platform_treasury;
    config.platform_fee_bps = p.platform_fee_bps;
    config.clone_royalty_bps = p.clone_royalty_bps;
    config.market_program = p.market_program;
    config.timelock_secs = p.timelock_secs;
    config.oracle_max_age_secs = p.oracle_max_age_secs;
}

#[derive(Accounts)]
pub struct InitConfig<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(init, payer = admin, space = 8 + GlobalConfig::INIT_SPACE, seeds = [CONFIG_SEED], bump)]
    pub config: Account<'info, GlobalConfig>,
    pub system_program: Program<'info, System>,
}

pub fn handle_init_config(ctx: Context<InitConfig>, params: ConfigParams) -> Result<()> {
    validate(&params)?;
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    apply(config, &params);
    config.index_count = 0;
    config.bump = ctx.bumps.config;
    emit!(ConfigUpdated {
        admin: config.admin,
        platform_fee_bps: config.platform_fee_bps,
        clone_royalty_bps: config.clone_royalty_bps,
    });
    Ok(())
}

#[derive(Accounts)]
pub struct SetConfig<'info> {
    pub admin: Signer<'info>,
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump, has_one = admin @ VaultError::Unauthorized)]
    pub config: Account<'info, GlobalConfig>,
}

pub fn handle_set_config(ctx: Context<SetConfig>, params: ConfigParams, new_admin: Option<Pubkey>) -> Result<()> {
    validate(&params)?;
    let config = &mut ctx.accounts.config;
    apply(config, &params);
    if let Some(a) = new_admin {
        config.admin = a;
    }
    emit!(ConfigUpdated {
        admin: config.admin,
        platform_fee_bps: config.platform_fee_bps,
        clone_royalty_bps: config.clone_royalty_bps,
    });
    Ok(())
}
