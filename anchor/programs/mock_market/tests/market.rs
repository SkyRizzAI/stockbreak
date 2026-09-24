#![allow(non_snake_case)]
//! mock_market: success + failure test per relevant error (PLAN §11.2).

use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use index_math::{swap_out, Price, MULT_FP};
use mock_market::{constants::*, state::*};
use test_utils::*;

const PID: Pubkey = mock_market::ID;

struct Ctx {
    svm: LiteSVM,
    admin: Keypair,
    market: Pubkey,
    usdc: Pubkey,
}

fn market_pda() -> Pubkey {
    pda(&[MARKET_SEED], &PID)
}
fn mint_pda(symbol: &str) -> Pubkey {
    pda(&[MINT_SEED, symbol.as_bytes()], &PID)
}
fn feed_pda(mint: &Pubkey) -> Pubkey {
    pda(&[FEED_SEED, mint.as_ref()], &PID)
}
fn ipo_pda(mint: &Pubkey) -> Pubkey {
    pda(&[IPO_SEED, mint.as_ref()], &PID)
}

fn ix<D: InstructionData, A: ToAccountMetas>(data: D, accounts: A, extra: Vec<AccountMeta>) -> Instruction {
    let mut metas = accounts.to_account_metas(None);
    metas.extend(extra);
    Instruction { program_id: PID, accounts: metas, data: data.data() }
}

fn init_market_ix(admin: &Pubkey, spread: u16) -> Instruction {
    ix(
        mock_market::instruction::InitMarket { spread_bps: spread, faucet_max: 1_000_000_000_000, oracle_max_age_secs: 120 },
        mock_market::accounts::InitMarket {
            authority: *admin,
            market: market_pda(),
            usdc_mint: mint_pda(USDC_SYMBOL),
            token_program: TOKEN,
            system_program: SYSTEM,
        },
        vec![],
    )
}

fn create_mint_ix(admin: &Pubkey, symbol: &str, decimals: u8, t22: bool, scaled: bool) -> Instruction {
    ix(
        mock_market::instruction::CreateMockMint { symbol: symbol.to_string(), decimals, token_2022: t22, scaled_ui: scaled },
        mock_market::accounts::CreateMockMint {
            authority: *admin,
            market: market_pda(),
            mint: mint_pda(symbol),
            token_program: if t22 { TOKEN_2022 } else { TOKEN },
            system_program: SYSTEM,
        },
        vec![],
    )
}

fn create_feed_ix(admin: &Pubkey, mint: &Pubkey, kind: AssetKind) -> Instruction {
    ix(
        mock_market::instruction::CreateFeed { kind },
        mock_market::accounts::CreateFeed { authority: *admin, market: market_pda(), mint: *mint, feed: feed_pda(mint), system_program: SYSTEM },
        vec![],
    )
}

fn set_prices_ix(admin: &Pubkey, feeds: &[(Pubkey, i64)]) -> Instruction {
    ix(
        mock_market::instruction::SetPrices {
            prices: feeds.iter().map(|(_, p)| PriceInput { price: *p, expo: -8, conf: 0 }).collect(),
        },
        mock_market::accounts::SetPrices { authority: *admin, market: market_pda() },
        feeds.iter().map(|(f, _)| AccountMeta::new(*f, false)).collect(),
    )
}

fn faucet_ix(user: &Pubkey, usdc: &Pubkey, amount: u64) -> Instruction {
    ix(
        mock_market::instruction::Faucet { amount },
        mock_market::accounts::Faucet {
            user: *user,
            market: market_pda(),
            usdc_mint: *usdc,
            user_ata: ata(user, usdc, &TOKEN),
            token_program: TOKEN,
        },
        vec![],
    )
}

fn swap_ix(user: &Pubkey, mint_in: (&Pubkey, &Pubkey), mint_out: (&Pubkey, &Pubkey), amount: u64, min_out: u64) -> Instruction {
    ix(
        mock_market::instruction::Swap { amount_in: amount, min_out },
        mock_market::accounts::Swap {
            user: *user,
            market: market_pda(),
            mint_in: *mint_in.0,
            mint_out: *mint_out.0,
            feed_in: feed_pda(mint_in.0),
            feed_out: feed_pda(mint_out.0),
            user_ata_in: ata(user, mint_in.0, mint_in.1),
            user_ata_out: ata(user, mint_out.0, mint_out.1),
            token_program_in: *mint_in.1,
            token_program_out: *mint_out.1,
        },
        vec![],
    )
}

fn setup() -> Ctx {
    let mut svm = new_svm();
    svm.add_program(PID, include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/mock_market.so"))).unwrap();
    let admin = funded(&mut svm);
    send(&mut svm, &[init_market_ix(&admin.pubkey(), 30)], &[&admin]).expect("init market");
    let usdc = mint_pda(USDC_SYMBOL);
    send(&mut svm, &[create_feed_ix(&admin.pubkey(), &usdc, AssetKind::Stable)], &[&admin]).expect("usdc feed");
    Ctx { svm, admin, market: market_pda(), usdc }
}

/// Create a Token-2022 scaled stock with a feed at `price` (expo -8).
fn stock(c: &mut Ctx, symbol: &str, price: i64) -> Pubkey {
    let a = c.admin.pubkey();
    let mint = mint_pda(symbol);
    send(&mut c.svm, &[create_mint_ix(&a, symbol, 8, true, true), create_feed_ix(&a, &mint, AssetKind::Stock)], &[&c.admin]).expect("stock");
    send(&mut c.svm, &[set_prices_ix(&a, &[(feed_pda(&mint), price), (feed_pda(&c.usdc), 100_000_000)])], &[&c.admin]).expect("price");
    mint
}

fn user_with_usdc(c: &mut Ctx, amount: u64) -> Keypair {
    let u = funded(&mut c.svm);
    let usdc = c.usdc;
    send(&mut c.svm, &[create_ata_ix(&u.pubkey(), &u.pubkey(), &usdc, &TOKEN), faucet_ix(&u.pubkey(), &usdc, amount)], &[&u]).expect("faucet");
    u
}

fn feed(c: &Ctx, mint: &Pubkey) -> OracleFeed {
    OracleFeed::try_deserialize(&mut &account_data(&c.svm, &feed_pda(mint))[..]).unwrap()
}

// ---------- init_market ----------

#[test]
fn ix_init_market__ok_and_usdc_mint() {
    let c = setup();
    let m = Market::try_deserialize(&mut &account_data(&c.svm, &c.market)[..]).unwrap();
    assert_eq!(m.authority, c.admin.pubkey());
    assert_eq!(m.usdc_mint, c.usdc);
    assert_eq!(m.spread_bps, 30);
    assert_eq!(mint_supply(&c.svm, &c.usdc), 0);
}

#[test]
fn ix_init_market__invalid_spread() {
    let mut svm = new_svm();
    svm.add_program(PID, include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/mock_market.so"))).unwrap();
    let admin = funded(&mut svm);
    let e = send(&mut svm, &[init_market_ix(&admin.pubkey(), 501)], &[&admin]).unwrap_err();
    assert!(e.is("InvalidSpread"), "{e:?}");
}

// ---------- create_mock_mint ----------

#[test]
fn ix_create_mock_mint__classic_and_scaled() {
    let mut c = setup();
    let a = c.admin.pubkey();
    send(&mut c.svm, &[create_mint_ix(&a, "PRE", 8, true, false), create_mint_ix(&a, "AAPLx", 8, true, true), create_mint_ix(&a, "CLS", 6, false, false)], &[&c.admin]).expect("mints");
    assert_eq!(c.svm.get_account(&mint_pda("AAPLx")).unwrap().owner, TOKEN_2022);
    assert_eq!(c.svm.get_account(&mint_pda("CLS")).unwrap().owner, TOKEN);
}

#[test]
fn ix_create_mock_mint__errors() {
    let mut c = setup();
    let a = c.admin.pubkey();
    let e = send(&mut c.svm, &[create_mint_ix(&a, "ABCDEFGHIJKLMNOPQ", 8, true, true)], &[&c.admin]).unwrap_err();
    assert!(e.is("InvalidSymbol") || e.err.contains("MaxSeedLength"), "{e:?}");
    let e = send(&mut c.svm, &[create_mint_ix(&a, "X", 10, true, true)], &[&c.admin]).unwrap_err();
    assert!(e.is("InvalidDecimals"), "{e:?}");
    let mut bad = create_mint_ix(&a, "Y", 8, true, true);
    bad.accounts[3].pubkey = TOKEN; // declares token_2022 but passes classic program
    let e = send(&mut c.svm, &[bad], &[&c.admin]).unwrap_err();
    assert!(e.is("InvalidTokenProgram"), "{e:?}");
    let other = funded(&mut c.svm);
    let e = send(&mut c.svm, &[create_mint_ix(&other.pubkey(), "Z", 8, true, true)], &[&other]).unwrap_err();
    assert!(e.is("Unauthorized"), "{e:?}");
}

// ---------- create_feed / set_prices ----------

#[test]
fn ix_create_feed__ok_and_not_market_mint() {
    let mut c = setup();
    let m = stock(&mut c, "AAPLx", 33_705_000_000);
    let f = feed(&c, &m);
    assert_eq!(f.kind, AssetKind::Stock);
    assert_eq!(f.price, 33_705_000_000);
    // A mint not issued by the market (USDC mint authority is market, so craft one via a second market-less mint):
    // use the share of a foreign program: the SPL Token program id itself is not a mint → constraint fails.
    let a = c.admin.pubkey();
    let foreign = Keypair::new();
    let e = send(&mut c.svm, &[create_feed_ix(&a, &foreign.pubkey(), AssetKind::Stock)], &[&c.admin]).unwrap_err();
    assert!(e.err.contains("AccountNotInitialized") || e.is("AccountNotInitialized") || e.is("NotMarketMint"), "{e:?}");
}

#[test]
fn ix_set_prices__ok_and_errors() {
    let mut c = setup();
    let m = stock(&mut c, "NVDAx", 22_545_000_000);
    let a = c.admin.pubkey();
    warp(&mut c.svm, 10);
    send(&mut c.svm, &[set_prices_ix(&a, &[(feed_pda(&m), 23_000_000_000)])], &[&c.admin]).expect("set");
    let f = feed(&c, &m);
    assert_eq!(f.price, 23_000_000_000);
    assert_eq!(f.publish_time, now(&c.svm));

    let e = send(&mut c.svm, &[set_prices_ix(&a, &[(feed_pda(&m), 0)])], &[&c.admin]).unwrap_err();
    assert!(e.is("InvalidPrice"), "{e:?}");
    let mut mismatch = set_prices_ix(&a, &[(feed_pda(&m), 1)]);
    mismatch.accounts.pop();
    let e = send(&mut c.svm, &[mismatch], &[&c.admin]).unwrap_err();
    assert!(e.is("FeedMismatch"), "{e:?}");
    let other = funded(&mut c.svm);
    let e = send(&mut c.svm, &[set_prices_ix(&other.pubkey(), &[(feed_pda(&m), 1)])], &[&other]).unwrap_err();
    assert!(e.is("Unauthorized"), "{e:?}");
    let many: Vec<(Pubkey, i64)> = (0..25).map(|_| (feed_pda(&m), 1)).collect();
    let e = send(&mut c.svm, &[set_prices_ix(&a, &many)], &[&c.admin]).unwrap_err();
    assert!(e.is("TooManyPrices") || e.err.contains("TooLarge") || e.err.contains("Sanitize"), "{e:?}");
}

// ---------- faucet ----------

#[test]
fn ix_faucet__ok_and_errors() {
    let mut c = setup();
    let u = user_with_usdc(&mut c, 5_000_000);
    assert_eq!(token_balance(&c.svm, &ata(&u.pubkey(), &c.usdc, &TOKEN)), 5_000_000);
    let usdc = c.usdc;
    let e = send(&mut c.svm, &[faucet_ix(&u.pubkey(), &usdc, 1_000_000_000_001)], &[&u]).unwrap_err();
    assert!(e.is("FaucetLimitExceeded"), "{e:?}");
    let e = send(&mut c.svm, &[faucet_ix(&u.pubkey(), &usdc, 0)], &[&u]).unwrap_err();
    assert!(e.is("ZeroAmount"), "{e:?}");
}

// ---------- swap ----------

#[test]
fn ix_swap__usdc_to_stock_matches_math() {
    let mut c = setup();
    let aapl = stock(&mut c, "AAPLx", 33_705_000_000);
    let u = user_with_usdc(&mut c, 10_000_000_000);
    let usdc = c.usdc;
    send(&mut c.svm, &[create_ata_ix(&u.pubkey(), &u.pubkey(), &aapl, &TOKEN_2022)], &[&u]).unwrap();
    let expected = swap_out(1_000_000_000, 6, MULT_FP, Price { price: 100_000_000, expo: -8 }, 8, MULT_FP, Price { price: 33_705_000_000, expo: -8 }, 30).unwrap();
    send(&mut c.svm, &[swap_ix(&u.pubkey(), (&usdc, &TOKEN), (&aapl, &TOKEN_2022), 1_000_000_000, expected)], &[&u]).expect("swap");
    assert_eq!(token_balance(&c.svm, &ata(&u.pubkey(), &aapl, &TOKEN_2022)), expected);
    assert_eq!(token_balance(&c.svm, &ata(&u.pubkey(), &usdc, &TOKEN)), 9_000_000_000);
    // ~ $997 / $337.05 ≈ 2.958 shares
    assert!(expected > 295_000_000 && expected < 296_000_000, "{expected}");
}

#[test]
fn ix_swap__errors() {
    let mut c = setup();
    let aapl = stock(&mut c, "AAPLx", 33_705_000_000);
    let u = user_with_usdc(&mut c, 10_000_000_000);
    let usdc = c.usdc;
    send(&mut c.svm, &[create_ata_ix(&u.pubkey(), &u.pubkey(), &aapl, &TOKEN_2022)], &[&u]).unwrap();
    let e = send(&mut c.svm, &[swap_ix(&u.pubkey(), (&usdc, &TOKEN), (&aapl, &TOKEN_2022), 1_000_000, u64::MAX)], &[&u]).unwrap_err();
    assert!(e.is("SlippageExceeded"), "{e:?}");
    let e = send(&mut c.svm, &[swap_ix(&u.pubkey(), (&usdc, &TOKEN), (&aapl, &TOKEN_2022), 0, 0)], &[&u]).unwrap_err();
    assert!(e.is("ZeroAmount"), "{e:?}");
    let e = send(&mut c.svm, &[swap_ix(&u.pubkey(), (&usdc, &TOKEN), (&usdc, &TOKEN), 1_000_000, 0)], &[&u]).unwrap_err();
    assert!(e.is("SameMint") || e.is("ConstraintDuplicateMutableAccount"), "{e:?}");
    warp(&mut c.svm, 121);
    let e = send(&mut c.svm, &[swap_ix(&u.pubkey(), (&usdc, &TOKEN), (&aapl, &TOKEN_2022), 1_000_000, 0)], &[&u]).unwrap_err();
    assert!(e.is("OracleStale"), "{e:?}");
}

// ---------- set_multiplier ----------

#[test]
fn ix_set_multiplier__doubles_swap_value() {
    let mut c = setup();
    let aapl = stock(&mut c, "AAPLx", 33_705_000_000);
    let u = user_with_usdc(&mut c, 10_000_000_000);
    let usdc = c.usdc;
    send(&mut c.svm, &[create_ata_ix(&u.pubkey(), &u.pubkey(), &aapl, &TOKEN_2022)], &[&u]).unwrap();
    send(&mut c.svm, &[swap_ix(&u.pubkey(), (&usdc, &TOKEN), (&aapl, &TOKEN_2022), 1_000_000_000, 0)], &[&u]).unwrap();
    let held = token_balance(&c.svm, &ata(&u.pubkey(), &aapl, &TOKEN_2022));

    let a = c.admin.pubkey();
    let set = ix(
        mock_market::instruction::SetMultiplier { multiplier: 2.0, effective_ts: 0 },
        mock_market::accounts::SetMultiplier { authority: a, market: market_pda(), mint: aapl, token_program: TOKEN_2022 },
        vec![],
    );
    send(&mut c.svm, &[set, set_prices_ix(&a, &[(feed_pda(&aapl), 33_705_000_000), (feed_pda(&usdc), 100_000_000)])], &[&c.admin]).expect("mult");
    // Selling everything back now yields ~2x the USDC (minus 2 spreads).
    let before = token_balance(&c.svm, &ata(&u.pubkey(), &usdc, &TOKEN));
    send(&mut c.svm, &[swap_ix(&u.pubkey(), (&aapl, &TOKEN_2022), (&usdc, &TOKEN), held, 0)], &[&u]).unwrap();
    let got = token_balance(&c.svm, &ata(&u.pubkey(), &usdc, &TOKEN)) - before;
    assert!(got > 1_985_000_000 && got < 2_000_000_000, "{got}");

    let bad = ix(
        mock_market::instruction::SetMultiplier { multiplier: -1.0, effective_ts: 0 },
        mock_market::accounts::SetMultiplier { authority: a, market: market_pda(), mint: aapl, token_program: TOKEN_2022 },
        vec![],
    );
    let e = send(&mut c.svm, &[bad], &[&c.admin]).unwrap_err();
    assert!(e.is("InvalidMultiplier"), "{e:?}");
}

// ---------- register_ipo / convert ----------

fn register_ix(a: &Pubkey, old: &Pubkey, new: &Pubkey, num: u64, den: u64) -> Instruction {
    ix(
        mock_market::instruction::RegisterIpo { ratio_num: num, ratio_den: den },
        mock_market::accounts::RegisterIpo {
            authority: *a,
            market: market_pda(),
            old_mint: *old,
            new_mint: *new,
            new_feed: feed_pda(new),
            ipo: ipo_pda(old),
            system_program: SYSTEM,
        },
        vec![],
    )
}

fn convert_ix(owner: &Pubkey, old: &Pubkey, new: &Pubkey, amount: u64) -> Instruction {
    ix(
        mock_market::instruction::Convert { amount },
        mock_market::accounts::Convert {
            owner: *owner,
            market: market_pda(),
            ipo: ipo_pda(old),
            old_mint: *old,
            new_mint: *new,
            owner_old_ata: ata(owner, old, &TOKEN_2022),
            owner_new_ata: ata(owner, new, &TOKEN_2022),
            token_program_old: TOKEN_2022,
            token_program_new: TOKEN_2022,
        },
        vec![],
    )
}

#[test]
fn ix_register_ipo_and_convert__ok() {
    let mut c = setup();
    let a = c.admin.pubkey();
    let pre = mint_pda("SPACEX-pre");
    send(&mut c.svm, &[create_mint_ix(&a, "SPACEX-pre", 8, true, false), create_feed_ix(&a, &pre, AssetKind::PreIpo)], &[&c.admin]).unwrap();
    send(&mut c.svm, &[set_prices_ix(&a, &[(feed_pda(&pre), 11_523_000_000), (feed_pda(&c.usdc), 100_000_000)])], &[&c.admin]).unwrap();
    let u = user_with_usdc(&mut c, 10_000_000_000);
    let usdc = c.usdc;
    send(&mut c.svm, &[create_ata_ix(&u.pubkey(), &u.pubkey(), &pre, &TOKEN_2022), swap_ix(&u.pubkey(), (&usdc, &TOKEN), (&pre, &TOKEN_2022), 1_000_000_000, 0)], &[&u]).unwrap();
    let held = token_balance(&c.svm, &ata(&u.pubkey(), &pre, &TOKEN_2022));

    let new = stock(&mut c, "SPCXx", 14_925_000_000);
    send(&mut c.svm, &[register_ix(&a, &pre, &new, 3, 2)], &[&c.admin]).expect("register");
    send(&mut c.svm, &[create_ata_ix(&u.pubkey(), &u.pubkey(), &new, &TOKEN_2022), convert_ix(&u.pubkey(), &pre, &new, held)], &[&u]).expect("convert");
    assert_eq!(token_balance(&c.svm, &ata(&u.pubkey(), &pre, &TOKEN_2022)), 0);
    assert_eq!(token_balance(&c.svm, &ata(&u.pubkey(), &new, &TOKEN_2022)), held * 3 / 2);
}

#[test]
fn ix_register_ipo__errors() {
    let mut c = setup();
    let a = c.admin.pubkey();
    let pre = mint_pda("OPENAI-pre");
    send(&mut c.svm, &[create_mint_ix(&a, "OPENAI-pre", 8, true, false), create_feed_ix(&a, &pre, AssetKind::PreIpo)], &[&c.admin]).unwrap();
    let new = stock(&mut c, "OPENAIx", 1_000_000_000);
    let e = send(&mut c.svm, &[register_ix(&a, &pre, &new, 0, 1)], &[&c.admin]).unwrap_err();
    assert!(e.is("InvalidRatio"), "{e:?}");
    let other = funded(&mut c.svm);
    let e = send(&mut c.svm, &[register_ix(&other.pubkey(), &pre, &new, 1, 1)], &[&other]).unwrap_err();
    assert!(e.is("Unauthorized"), "{e:?}");
    // convert without a registered IPO fails (account missing)
    let u = funded(&mut c.svm);
    let e = send(&mut c.svm, &[convert_ix(&u.pubkey(), &pre, &new, 1)], &[&u]).unwrap_err();
    assert!(e.err.contains("AccountNotInitialized") || e.is("AccountNotInitialized"), "{e:?}");
}
