//! Shared LiteSVM helpers for program tests (A12). Generic only: no program crates here.

pub use anchor_lang::prelude::Pubkey;
pub use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
pub use litesvm::LiteSVM;
pub use solana_keypair::Keypair;
pub use solana_signer::Signer;

use anchor_lang::prelude::Clock;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use solana_message::{Message, VersionedMessage};
use solana_transaction::versioned::VersionedTransaction;

pub const TOKEN: Pubkey = anchor_spl::token::ID;
pub const TOKEN_2022: Pubkey = anchor_spl::token_2022::ID;
pub const ATA_PROGRAM: Pubkey = anchor_spl::associated_token::ID;
pub const SYSTEM: Pubkey = anchor_lang::system_program::ID;
/// Realistic start time (LiteSVM starts at 0).
pub const T0: i64 = 1_758_000_000;

pub type TxResult = Result<Vec<String>, TxError>;

#[derive(Debug)]
pub struct TxError {
    pub err: String,
    pub logs: Vec<String>,
}

impl TxError {
    /// True when the failure is the Anchor error `name` (e.g. "SlippageExceeded").
    pub fn is(&self, name: &str) -> bool {
        self.logs.iter().any(|l| l.contains(&format!("Error Code: {name}.")))
            || self.err.contains(name)
    }
}

pub fn new_svm() -> LiteSVM {
    let mut svm = LiteSVM::new();
    set_time(&mut svm, T0);
    svm
}

pub fn now(svm: &LiteSVM) -> i64 {
    svm.get_sysvar::<Clock>().unix_timestamp
}

pub fn set_time(svm: &mut LiteSVM, ts: i64) {
    let mut c = svm.get_sysvar::<Clock>();
    c.unix_timestamp = ts;
    c.slot += 1;
    svm.set_sysvar(&c);
    svm.expire_blockhash();
}

pub fn warp(svm: &mut LiteSVM, secs: i64) {
    let t = now(svm) + secs;
    set_time(svm, t);
}

pub fn funded(svm: &mut LiteSVM) -> Keypair {
    let kp = Keypair::new();
    svm.airdrop(&kp.pubkey(), 100_000_000_000).unwrap();
    kp
}

/// Send a legacy transaction (fee payer = first signer). Expires the blockhash
/// afterwards so identical retries are accepted.
pub fn send(svm: &mut LiteSVM, ixs: &[Instruction], signers: &[&Keypair]) -> TxResult {
    let mut all = vec![Instruction {
        program_id: anchor_lang::prelude::pubkey!("ComputeBudget111111111111111111111111111111"),
        accounts: vec![],
        // SetComputeUnitLimit(1_400_000)
        data: {
            let mut d = vec![2u8];
            d.extend_from_slice(&1_400_000u32.to_le_bytes());
            d
        },
    }];
    all.extend_from_slice(ixs);
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&all, Some(&signers[0].pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    let res = svm.send_transaction(tx);
    svm.expire_blockhash();
    match res {
        Ok(m) => Ok(m.logs),
        Err(e) => Err(TxError { err: format!("{:?}", e.err), logs: e.meta.logs }),
    }
}

pub fn ata(owner: &Pubkey, mint: &Pubkey, token_program: &Pubkey) -> Pubkey {
    get_associated_token_address_with_program_id(owner, mint, token_program)
}

/// AssociatedTokenAccount CreateIdempotent.
pub fn create_ata_ix(payer: &Pubkey, owner: &Pubkey, mint: &Pubkey, token_program: &Pubkey) -> Instruction {
    Instruction {
        program_id: ATA_PROGRAM,
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(ata(owner, mint, token_program), false),
            AccountMeta::new_readonly(*owner, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(SYSTEM, false),
            AccountMeta::new_readonly(*token_program, false),
        ],
        data: vec![1],
    }
}

/// SPL TransferChecked (works for Token and Token-2022).
pub fn transfer_checked_ix(
    token_program: &Pubkey,
    from: &Pubkey,
    mint: &Pubkey,
    to: &Pubkey,
    authority: &Pubkey,
    amount: u64,
    decimals: u8,
) -> Instruction {
    let mut data = vec![12u8];
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(decimals);
    Instruction {
        program_id: *token_program,
        accounts: vec![
            AccountMeta::new(*from, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new(*to, false),
            AccountMeta::new_readonly(*authority, true),
        ],
        data,
    }
}

/// Token account amount (offset 64, same layout for Token and Token-2022).
pub fn token_balance(svm: &LiteSVM, account: &Pubkey) -> u64 {
    match svm.get_account(account) {
        Some(a) if a.data.len() >= 72 => u64::from_le_bytes(a.data[64..72].try_into().unwrap()),
        _ => 0,
    }
}

/// Mint supply (offset 36).
pub fn mint_supply(svm: &LiteSVM, mint: &Pubkey) -> u64 {
    let a = svm.get_account(mint).expect("mint");
    u64::from_le_bytes(a.data[36..44].try_into().unwrap())
}

pub fn account_data(svm: &LiteSVM, key: &Pubkey) -> Vec<u8> {
    svm.get_account(key).map(|a| a.data).unwrap_or_default()
}

pub fn pda(seeds: &[&[u8]], program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(seeds, program).0
}
