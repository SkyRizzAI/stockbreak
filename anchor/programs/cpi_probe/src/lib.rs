//! Test-only program: forwards an instruction via CPI so tests can prove
//! index_vault rejects being called from another program (NotTopLevel).
//! Never deployed to localnet/devnet.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke;

declare_id!("8rHCnkxdvfLUUNJVhviXYiGwCx6hkyT4F1c1BYpqEkNp");

#[program]
pub mod cpi_probe {
    use super::*;

    /// remaining_accounts[0] = target program, rest = its accounts (flags preserved).
    pub fn forward<'info>(ctx: Context<'info, Forward<'info>>, data: Vec<u8>) -> Result<()> {
        let (program, accounts) = ctx.remaining_accounts.split_first().ok_or(ProgramError::NotEnoughAccountKeys)?;
        let metas = accounts
            .iter()
            .map(|a| AccountMeta { pubkey: a.key(), is_signer: a.is_signer, is_writable: a.is_writable })
            .collect();
        let ix = Instruction { program_id: program.key(), accounts: metas, data };
        invoke(&ix, ctx.remaining_accounts)?;
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Forward<'info> {
    pub caller: Signer<'info>,
}
