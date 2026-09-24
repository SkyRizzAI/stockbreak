#![allow(non_snake_case)]
//! P5: flash rebalance, IPO migration, follow sync (+ A14 security cases).

mod common;
use anchor_lang::{AccountSerialize, InstructionData};
use common::*;
use index_vault::state::*;

const PROBE: Pubkey = anchor_lang::prelude::pubkey!("8rHCnkxdvfLUUNJVhviXYiGwCx6hkyT4F1c1BYpqEkNp");

fn mag4(env: &Env) -> Vec<(Pubkey, u16)> {
    vec![(env.aapl.mint, 4000), (env.nvda.mint, 3000), (env.tsla.mint, 2000), (env.pre.mint, 1000)]
}

/// Index with a $100k first deposit; returns (index, creator).
fn funded_index(env: &mut Env, args: CreateArgs) -> (Pubkey, Keypair) {
    let creator = env.user(300_000_000_000);
    let index = create(env, &creator, &args);
    seed_deposit(env, &index, &creator, 100_000_000_000);
    (index, creator)
}

/// Push AAPLx up 30% → AAPL overweight (~46% vs 40% target, > 5% threshold).
fn shock_aapl(env: &mut Env) {
    let m = env.aapl.mint;
    let p = env.aapl.price * 13 / 10;
    env.set_price(&m, p);
}

fn drift_of(env: &Env, index: &Pubkey) -> u32 {
    let st = env.index(index);
    let vals: Vec<u64> = st
        .assets
        .iter()
        .map(|a| {
            let px = env.asset(&a.mint).price;
            index_math::value_usd(a.balance, a.decimals, index_math::MULT_FP, index_math::Price { price: px, expo: -8 }).unwrap()
        })
        .collect();
    let t: Vec<u16> = st.assets.iter().map(|a| a.target_weight_bps).collect();
    index_math::drift(&vals, &t).unwrap().0
}

// ---------------- rebalance ----------------

#[test]
fn rebalance__keeper_on_threshold_reduces_drift() {
    let mut env = setup();
    let (index, _creator) = { let __a = CreateArgs::new(1, mag4(&env)); funded_index(&mut env, __a) };
    let keeper = env.user(0);
    shock_aapl(&mut env);
    let before = drift_of(&env, &index);
    let st = env.index(&index);
    let k = keeper.pubkey();
    let ixs = rebalance_ixs(&env, &k, &index, 0, st.assets[0].balance / 10, 1, 1);
    send(&mut env.svm, &ixs, &[&keeper]).expect("keeper rebalance");
    let after = drift_of(&env, &index);
    assert!(after < before, "{after} < {before}");
    let st2 = env.index(&index);
    assert!(st2.rebalance_ticket.is_none());
    assert_eq!(st2.assets[0].balance, st.assets[0].balance - st.assets[0].balance / 10);
    assert!(st2.assets[1].balance > st.assets[1].balance);
}

#[test]
fn rebalance__keeper_rejected_when_trigger_not_met_manual_or_disallowed() {
    let mut env = setup();
    let (index, _c) = { let __a = CreateArgs::new(1, mag4(&env)); funded_index(&mut env, __a) };
    let keeper = env.user(0);
    let k = keeper.pubkey();
    let st = env.index(&index);
    // no shock → drift below threshold
    let ixs = rebalance_ixs(&env, &k, &index, 0, st.assets[0].balance / 100, 1, 1);
    let e = send(&mut env.svm, &ixs, &[&keeper]).unwrap_err();
    assert!(e.is("TriggerNotMet"), "{e:?}");

    // Manual mode: keeper never allowed
    let mut args = CreateArgs::new(2, mag4(&env));
    args.strategy.mode = StrategyMode::Manual;
    let (manual, _c2) = funded_index(&mut env, args);
    shock_aapl(&mut env);
    let st = env.index(&manual);
    let ixs = rebalance_ixs(&env, &k, &manual, 0, st.assets[0].balance / 10, 1, 1);
    let e = send(&mut env.svm, &ixs, &[&keeper]).unwrap_err();
    assert!(e.is("TriggerNotMet"), "{e:?}");

    // allow_keeper = false → Unauthorized
    let mut args = CreateArgs::new(3, mag4(&env));
    args.strategy.allow_keeper = false;
    let (closed, _c3) = funded_index(&mut env, args);
    let m = env.aapl.mint;
    let p = env.aapl.price * 13 / 10;
    env.set_price(&m, p);
    let st = env.index(&closed);
    let ixs = rebalance_ixs(&env, &k, &closed, 0, st.assets[0].balance / 10, 1, 1);
    let e = send(&mut env.svm, &ixs, &[&keeper]).unwrap_err();
    assert!(e.is("Unauthorized"), "{e:?}");

    // keeper may not touch PreIpo assets
    let st = env.index(&index);
    let ixs = rebalance_ixs(&env, &k, &index, 3, st.assets[3].balance / 10, 1, 1);
    let e = send(&mut env.svm, &ixs, &[&keeper]).unwrap_err();
    assert!(e.is("Unauthorized"), "{e:?}");
}

#[test]
fn rebalance__manager_any_time_and_wrong_direction() {
    let mut env = setup();
    let (index, creator) = { let __a = CreateArgs::new(1, mag4(&env)); funded_index(&mut env, __a) };
    let manager = env.user(0);
    let c = creator.pubkey();
    let m = manager.pubkey();
    tx!(env, [creator_only(&c, &index, index_vault::instruction::SetManagers { managers: vec![m] })], [&creator]).unwrap();
    shock_aapl(&mut env);
    let st = env.index(&index);
    // wrong way: sell underweight NVDA to buy overweight AAPL
    let ixs = rebalance_ixs(&env, &m, &index, 1, st.assets[1].balance / 10, 0, 1);
    let e = send(&mut env.svm, &ixs, &[&manager]).unwrap_err();
    assert!(e.is("WrongDirection"), "{e:?}");
    // right way works for the manager (also PreIpo allowed for managers)
    let ixs = rebalance_ixs(&env, &m, &index, 0, st.assets[0].balance / 10, 3, 1);
    send(&mut env.svm, &ixs, &[&manager]).expect("manager rebalance");
}

#[test]
fn rebalance__slippage_min_in_and_skimming_executor() {
    let mut env = setup();
    let (index, creator) = { let __a = CreateArgs::new(1, mag4(&env)); funded_index(&mut env, __a) };
    shock_aapl(&mut env);
    let c = creator.pubkey();
    let st = env.index(&index);
    let amt = st.assets[0].balance / 10;
    // min_amount_in impossible
    let ixs = rebalance_ixs(&env, &c, &index, 0, amt, 1, u64::MAX);
    let e = send(&mut env.svm, &ixs, &[&creator]).unwrap_err();
    assert!(e.is("SlippageExceeded"), "{e:?}");
    // executor forwards only half of the swap output → value check fails
    let mut ixs = rebalance_ixs(&env, &c, &index, 0, amt, 1, 1);
    let data = &mut ixs[2].data;
    let full = u64::from_le_bytes(data[1..9].try_into().unwrap());
    data[1..9].copy_from_slice(&(full / 2).to_le_bytes());
    let e = send(&mut env.svm, &ixs, &[&creator]).unwrap_err();
    assert!(e.is("SlippageExceeded"), "{e:?}");
}

#[test]
fn rebalance__cooldown_same_asset_and_stale_oracle() {
    let mut env = setup();
    let mut args = CreateArgs::new(1, mag4(&env));
    args.strategy.cooldown_secs = 3600;
    let (index, creator) = funded_index(&mut env, args);
    shock_aapl(&mut env);
    let c = creator.pubkey();
    let st = env.index(&index);
    let ixs = rebalance_ixs(&env, &c, &index, 0, st.assets[0].balance / 20, 1, 1);
    let e = send(&mut env.svm, &ixs, &[&creator]).unwrap_err();
    assert!(e.is("CooldownActive"), "{e:?}");
    env.warp(3601);
    let ixs = rebalance_ixs(&env, &c, &index, 0, st.assets[0].balance / 20, 1, 1);
    send(&mut env.svm, &ixs, &[&creator]).expect("after cooldown");
    let ixs = rebalance_ixs(&env, &c, &index, 0, st.assets[0].balance / 20, 1, 1);
    let e = send(&mut env.svm, &ixs, &[&creator]).unwrap_err();
    assert!(e.is("CooldownActive"), "{e:?}");

    env.warp(3601);
    let mut ixs = rebalance_ixs(&env, &c, &index, 0, 1000, 1, 1);
    ixs[0] = {
        let mut b = ixs[0].clone();
        let d = index_vault::instruction::BeginRebalance { asset_out: 0, amount_out: 1000, asset_in: 0, min_amount_in: 1 };
        b.data = d.data();
        b
    };
    let e = send(&mut env.svm, &ixs, &[&creator]).unwrap_err();
    assert!(e.is("SameAsset"), "{e:?}");

    // stale oracle (no refresh after 121s)
    warp(&mut env.svm, 121);
    let ixs = rebalance_ixs(&env, &c, &index, 0, 1000, 1, 1);
    let e = send(&mut env.svm, &ixs, &[&creator]).unwrap_err();
    assert!(e.is("OracleStale"), "{e:?}");
}

#[test]
fn rebalance__sandwich_introspection() {
    let mut env = setup();
    let (index, creator) = { let __a = CreateArgs::new(1, mag4(&env)); funded_index(&mut env, __a) };
    shock_aapl(&mut env);
    let c = creator.pubkey();
    let st = env.index(&index);
    let amt = st.assets[0].balance / 10;

    // begin without end
    let mut ixs = rebalance_ixs(&env, &c, &index, 0, amt, 1, 1);
    ixs.pop();
    let e = send(&mut env.svm, &ixs, &[&creator]).unwrap_err();
    assert!(e.is("MissingEndInstruction"), "{e:?}");

    // foreign index_vault instruction (redeem) between begin and end
    let mut ixs = rebalance_ixs(&env, &c, &index, 0, amt, 1, 1);
    ixs.insert(1, redeem_ix(&env, &index, &c, 1_000, vec![0; 4]));
    let e = send(&mut env.svm, &ixs, &[&creator]).unwrap_err();
    assert!(e.is("InvalidRebalanceTx"), "{e:?}");

    // a non-whitelisted program (System transfer) between begin and end
    let mut ixs = rebalance_ixs(&env, &c, &index, 0, amt, 1, 1);
    let mut data = vec![2, 0, 0, 0];
    data.extend_from_slice(&1u64.to_le_bytes());
    ixs.insert(1, Instruction { program_id: SYSTEM, accounts: vec![AccountMeta::new(c, true), AccountMeta::new(env.admin.pubkey(), false)], data });
    let e = send(&mut env.svm, &ixs, &[&creator]).unwrap_err();
    assert!(e.is("InvalidRebalanceTx"), "{e:?}");

    // begin via CPI (probe program) → NotTopLevel
    env.svm.add_program(PROBE, include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/cpi_probe.so"))).unwrap();
    let ixs = rebalance_ixs(&env, &c, &index, 0, amt, 1, 1);
    let begin = &ixs[0];
    let mut accounts = vec![AccountMeta::new_readonly(c, true), AccountMeta::new_readonly(VAULT, false)];
    accounts.extend(begin.accounts.iter().cloned());
    let fwd = Instruction {
        program_id: PROBE,
        accounts,
        data: {
            // anchor discriminator for "global:forward" + borsh Vec<u8>
            let mut d: Vec<u8> = vec![45, 165, 201, 116, 206, 225, 241, 18];
            d.extend_from_slice(&(begin.data.len() as u32).to_le_bytes());
            d.extend_from_slice(&begin.data);
            d
        },
    };
    let e = send(&mut env.svm, &[fwd, ixs[1].clone(), ixs[2].clone(), ixs[3].clone()], &[&creator]).unwrap_err();
    assert!(e.is("NotTopLevel"), "{e:?}");
}

#[test]
fn rebalance__active_ticket_blocks_other_instructions() {
    let mut env = setup();
    let (index, creator) = { let __a = CreateArgs::new(1, mag4(&env)); funded_index(&mut env, __a) };
    // Force a ticket into the account (cannot happen across txs; defence in depth).
    let mut st = env.index(&index);
    st.rebalance_ticket = Some(RebalanceTicket {
        executor: creator.pubkey(),
        asset_out: 0,
        amount_out: 1,
        asset_in: 1,
        min_amount_in: 1,
        ata_in_before: 0,
        drift_before_bps: 0,
        value_out: 0,
    });
    let mut acc = env.svm.get_account(&index).unwrap();
    let mut buf = Vec::new();
    st.try_serialize(&mut buf).unwrap();
    acc.data[..buf.len()].copy_from_slice(&buf);
    env.svm.set_account(index, acc).unwrap();
    let c = creator.pubkey();
    let e = tx!(env, [redeem_ix(&env, &index, &c, 1_000, vec![0; 4])], [&creator]).unwrap_err();
    assert!(e.is("RebalanceInProgress"), "{e:?}");
    let e = tx!(env, [creator_only(&c, &index, index_vault::instruction::SetPaused { paused: true })], [&creator]).unwrap_err();
    assert!(e.is("RebalanceInProgress"), "{e:?}");
    let e = tx!(env, [accrue_ix(&index)], [&creator]).unwrap_err();
    assert!(e.is("RebalanceInProgress"), "{e:?}");
    // end_rebalance by someone else → Unauthorized
    let other = env.user(0);
    let o = other.pubkey();
    let st = env.index(&index);
    let end = with_vault_in(end_ix(&index, &o, &st), ata(&index, &st.assets[1].mint, &st.assets[1].token_program));
    let e = tx!(env, [end], [&other]).unwrap_err();
    assert!(e.is("Unauthorized"), "{e:?}");
    // end with no ticket → NoTicket
    let (index2, creator2) = { let __a = CreateArgs::new(2, mag4(&env)); funded_index(&mut env, __a) };
    let c2 = creator2.pubkey();
    let st2 = env.index(&index2);
    let end = with_vault_in(end_ix(&index2, &c2, &st2), ata(&index2, &st2.assets[1].mint, &st2.assets[1].token_program));
    let e = tx!(env, [end], [&creator2]).unwrap_err();
    assert!(e.is("NoTicket"), "{e:?}");
}

// ---------------- IPO ----------------

fn ipo_setup(env: &mut Env, ratio: (u64, u64)) -> Asset {
    let a = env.admin.pubkey();
    let new = mint_pda("SPCXx");
    let ixs = vec![
        mk(
            MARKET,
            mock_market::instruction::CreateMockMint { symbol: "SPCXx".into(), decimals: 8, token_2022: true, scaled_ui: true },
            mock_market::accounts::CreateMockMint { authority: a, market: market_pda(), mint: new, token_program: TOKEN_2022, system_program: SYSTEM },
            vec![],
        ),
        mk(
            MARKET,
            mock_market::instruction::CreateFeed { kind: mock_market::state::AssetKind::Stock },
            mock_market::accounts::CreateFeed { authority: a, market: market_pda(), mint: new, feed: feed_pda(&new), system_program: SYSTEM },
            vec![],
        ),
        set_prices_ix(&a, &[(feed_pda(&new), 14_925_000_000)]),
        mk(
            MARKET,
            mock_market::instruction::RegisterIpo { ratio_num: ratio.0, ratio_den: ratio.1 },
            mock_market::accounts::RegisterIpo {
                authority: a,
                market: market_pda(),
                old_mint: env.pre.mint,
                new_mint: new,
                new_feed: feed_pda(&new),
                ipo: ipo_pda(&env.pre.mint),
                system_program: SYSTEM,
            },
            vec![],
        ),
    ];
    send(&mut env.svm, &ixs, &[&env.admin]).expect("ipo setup");
    Asset { mint: new, tp: TOKEN_2022, decimals: 8, price: 14_925_000_000 }
}

fn migrate_ix(env: &Env, payer: &Pubkey, index: &Pubkey, idx: u8, new_mint: &Pubkey, market_program: Pubkey) -> Instruction {
    let st = env.index(index);
    let old = st.assets[idx as usize];
    mk(
        VAULT,
        index_vault::instruction::MigrateIpoAsset { asset_idx: idx },
        index_vault::accounts::MigrateIpoAsset {
            payer: *payer,
            config: config_pda(),
            index: *index,
            market_program,
            market: market_pda(),
            ipo: ipo_pda(&old.mint),
            old_mint: old.mint,
            new_mint: *new_mint,
            new_feed: feed_pda(new_mint),
            vault_old_ata: ata(index, &old.mint, &old.token_program),
            vault_new_ata: ata(index, new_mint, &TOKEN_2022),
            token_program_old: old.token_program,
            token_program_new: TOKEN_2022,
            associated_token_program: ATA_PROGRAM,
            system_program: SYSTEM,
        },
        vec![],
    )
}

#[test]
fn ipo__migrates_pre_ipo_holding_and_rejects_bad_inputs() {
    let mut env = setup();
    let (index, creator) = { let __a = CreateArgs::new(1, mag4(&env)); funded_index(&mut env, __a) };
    let c = creator.pubkey();
    let new_mint = mint_pda("SPCXx");

    // before the IPO is registered
    let e = tx!(env, [migrate_ix(&env, &c, &index, 3, &new_mint, MARKET)], [&creator]).unwrap_err();
    assert!(e.is("NoIpoConversion") || e.is("InvalidOracle") || e.is("AccountOrderMismatch"), "{e:?}");

    let _new = ipo_setup(&mut env, (3, 2));
    let e = tx!(env, [migrate_ix(&env, &c, &index, 0, &new_mint, MARKET)], [&creator]).unwrap_err();
    assert!(e.is("NotPreIpo"), "{e:?}");
    // fake market program (Token program is executable but not config.market_program)
    let e = tx!(env, [migrate_ix(&env, &c, &index, 3, &new_mint, TOKEN)], [&creator]).unwrap_err();
    assert!(e.is("InvalidMarketProgram"), "{e:?}");

    let before = env.index(&index).assets[3];
    tx!(env, [migrate_ix(&env, &c, &index, 3, &new_mint, MARKET)], [&creator]).expect("migrate");
    let after = env.index(&index).assets[3];
    assert_eq!(after.mint, new_mint);
    assert_eq!(after.kind, AssetKind::Stock);
    assert_eq!(after.balance, before.balance * 3 / 2);
    assert_eq!(after.target_weight_bps, before.target_weight_bps);
    assert_eq!(after.oracle, feed_pda(&new_mint));
    assert_eq!(token_balance(&env.svm, &ata(&index, &new_mint, &TOKEN_2022)), after.balance);
    assert_eq!(token_balance(&env.svm, &ata(&index, &before.mint, &TOKEN_2022)), 0);
}

// ---------------- follow ----------------

fn sync_ix(env: &Env, payer: &Pubkey, index: &Pubkey, parent: &Pubkey) -> Instruction {
    let st = env.index(index);
    let p = env.index(parent);
    let mut result: Vec<AssetEntry> = p.assets.clone();
    for l in &st.assets {
        if l.balance > 0 && !result.iter().any(|r| r.mint == l.mint) {
            result.push(*l);
        }
    }
    let extra = result.iter().flat_map(|a| [ro(a.mint), rw(ata(index, &a.mint, &a.token_program))]).collect();
    mk(
        VAULT,
        index_vault::instruction::SyncTargetsFromParent {},
        index_vault::accounts::SyncTargetsFromParent {
            payer: *payer,
            config: config_pda(),
            index: *index,
            parent_index: *parent,
            token_program: TOKEN,
            token_2022_program: TOKEN_2022,
            associated_token_program: ATA_PROGRAM,
            system_program: SYSTEM,
        },
        extra,
    )
}

#[test]
fn follow__sync_copies_parent_weights_and_keeps_funded_assets() {
    let mut env = setup();
    let (parent, a) = { let __a = CreateArgs::new(1, mag4(&env)); funded_index(&mut env, __a) };
    let mut args = CreateArgs::new(1, mag4(&env));
    args.parent = Some(parent);
    args.follows = true;
    let (child, c) = funded_index(&mut env, args);
    let ap = a.pubkey();

    // parent drops TSLA (weight 0 but still funded), adds USDC
    let next = vec![
        AssetInput { mint: env.aapl.mint, target_weight_bps: 5000 },
        AssetInput { mint: env.nvda.mint, target_weight_bps: 2000 },
        AssetInput { mint: env.tsla.mint, target_weight_bps: 0 },
        AssetInput { mint: env.pre.mint, target_weight_bps: 1000 },
        AssetInput { mint: env.usdc.mint, target_weight_bps: 2000 },
    ];
    tx!(env, [propose_ix(&env, &ap, &parent, UpdateInput { assets: Some(next), fees: None, strategy: None })], [&a]).unwrap();
    tx!(env, [apply_ix(&env, &ap, &parent)], [&a]).expect("apply parent");

    let keeper = env.user(0);
    let k = keeper.pubkey();
    tx!(env, [sync_ix(&env, &k, &child, &parent)], [&keeper]).expect("sync");
    let cst = env.index(&child);
    let pst = env.index(&parent);
    assert_eq!(cst.assets.len(), pst.assets.len());
    for (x, y) in cst.assets.iter().zip(pst.assets.iter()) {
        assert_eq!(x.mint, y.mint);
        assert_eq!(x.target_weight_bps, y.target_weight_bps);
    }
    assert!(cst.assets[2].balance > 0, "funded TSLA kept at weight 0");
    assert_eq!(cst.assets[4].balance, 0);

    // not following / wrong parent
    let cp = c.pubkey();
    let e = tx!(env, [sync_ix(&env, &cp, &parent, &child)], [&c]).unwrap_err();
    assert!(e.is("NotFollowing"), "{e:?}");
    let (other, _o) = { let __a = CreateArgs::new(9, mag4(&env)); funded_index(&mut env, __a) };
    let e = tx!(env, [sync_ix(&env, &cp, &child, &other)], [&c]).unwrap_err();
    assert!(e.is("InvalidParent"), "{e:?}");
}
