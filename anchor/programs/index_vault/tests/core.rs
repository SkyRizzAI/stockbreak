#![allow(non_snake_case)]
//! index_vault core instructions (P4): success + failure per relevant error.

mod common;
use common::*;
use index_vault::constants::*;
use index_vault::state::*;

fn mag4(env: &Env) -> Vec<(Pubkey, u16)> {
    vec![(env.aapl.mint, 4000), (env.nvda.mint, 3000), (env.tsla.mint, 2000), (env.pre.mint, 1000)]
}

// ---------------- config ----------------

#[test]
fn ix_init_config__ok_and_fee_too_high() {
    let env = setup();
    let c = env.config();
    assert_eq!(c.admin, env.admin.pubkey());
    assert_eq!(c.market_program, MARKET);
    assert_eq!(c.platform_fee_bps, 100);

    let mut svm = new_svm();
    svm.add_program(VAULT, include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/index_vault.so"))).unwrap();
    let a = funded(&mut svm);
    let mut p = config_params(MARKET, a.pubkey(), 0);
    p.platform_fee_bps = 201;
    let e = send(&mut svm, &[init_config_ix(&a.pubkey(), p)], &[&a]).unwrap_err();
    assert!(e.is("FeeTooHigh"), "{e:?}");
}

#[test]
fn ix_set_config__ok_and_unauthorized() {
    let mut env = setup();
    let a = env.admin.pubkey();
    let mut p = config_params(MARKET, a, 60);
    p.platform_fee_bps = 150;
    let ix = mk(VAULT, index_vault::instruction::SetConfig { params: p, new_admin: None }, index_vault::accounts::SetConfig { admin: a, config: config_pda() }, vec![]);
    tx!(env, [ix], [&env.admin]).expect("set");
    assert_eq!(env.config().platform_fee_bps, 150);
    assert_eq!(env.config().timelock_secs, 60);

    let other = funded(&mut env.svm);
    let ix = mk(VAULT, index_vault::instruction::SetConfig { params: p, new_admin: None }, index_vault::accounts::SetConfig { admin: other.pubkey(), config: config_pda() }, vec![]);
    let e = tx!(env, [ix], [&other]).unwrap_err();
    assert!(e.is("Unauthorized"), "{e:?}");
}

// ---------------- create_index ----------------

#[test]
fn ix_create_index__ok() {
    let mut env = setup();
    let creator = env.user(0);
    let args = CreateArgs::new(1, mag4(&env));
    let index = create(&mut env, &creator, &args);
    let st = env.index(&index);
    assert_eq!(st.creator, creator.pubkey());
    assert_eq!(st.assets.len(), 4);
    assert_eq!(st.assets[0].kind, AssetKind::Stock);
    assert_eq!(st.assets[3].kind, AssetKind::PreIpo);
    assert_eq!(st.assets[0].token_program, TOKEN_2022);
    assert_eq!(st.assets[0].decimals, 8);
    assert_eq!(st.share_mint, share_pda(&index));
    assert_eq!(env.config().index_count, 1);
    for a in &st.assets {
        assert!(env.svm.get_account(&ata(&index, &a.mint, &a.token_program)).is_some(), "vault ata");
    }
}

#[test]
fn ix_create_index__validation_errors() {
    let mut env = setup();
    let creator = env.user(0);
    let c = creator.pubkey();
    let cases: Vec<(CreateArgs, &str)> = vec![
        (CreateArgs::new(1, vec![(env.aapl.mint, 5000), (env.nvda.mint, 4000)]), "InvalidWeights"),
        (CreateArgs::new(2, vec![(env.aapl.mint, 5000), (env.aapl.mint, 5000)]), "DuplicateAsset"),
        ({
            let mut a = CreateArgs::new(3, mag4(&env));
            a.fees = fees(501, 0, 0);
            a
        }, "FeeTooHigh"),
        ({
            let mut a = CreateArgs::new(4, mag4(&env));
            a.fees = fees(0, 101, 0);
            a
        }, "FeeTooHigh"),
        ({
            let mut a = CreateArgs::new(5, mag4(&env));
            a.strategy.max_slippage_bps = 49;
            a
        }, "InvalidSlippage"),
        ({
            let mut a = CreateArgs::new(6, mag4(&env));
            a.name = "x".repeat(33);
            a
        }, "InvalidMetadata"),
        ({
            let mut a = CreateArgs::new(7, mag4(&env));
            a.follows = true;
            a
        }, "InvalidParent"),
        (CreateArgs::new(8, vec![(env.aapl.mint, 5000), (env.nvda.mint, 0), (env.tsla.mint, 5000)]), "InvalidWeights"),
    ];
    for (args, err) in cases {
        let ix = create_ix(&env, &c, &args);
        let e = tx!(env, [ix], [&creator]).unwrap_err();
        assert!(e.is(err), "{err}: {e:?}");
    }
    // Too many assets: 11 entries (duplicates would trip first, so check the length guard).
    let many: Vec<(Pubkey, u16)> = (0..11).map(|_| (Pubkey::new_unique(), 909)).collect();
    let mut args = CreateArgs::new(9, many);
    args.assets[0].1 = 10_000 - 909 * 10;
    let ix = create_ix(&env, &c, &args);
    let e = tx!(env, [ix], [&creator]).unwrap_err();
    assert!(e.is("TooManyAssets") || e.err.contains("TooManyAccountLocks") || e.err.contains("Sanitize"), "{e:?}");
}

#[test]
fn ix_create_index__account_order_and_oracle_checks() {
    let mut env = setup();
    let creator = env.user(0);
    let c = creator.pubkey();
    let args = CreateArgs::new(1, mag4(&env));
    // swap two remaining-account triples → mismatch
    let mut ix = create_ix(&env, &c, &args);
    let n = ix.accounts.len();
    ix.accounts.swap(n - 12, n - 9);
    let e = tx!(env, [ix], [&creator]).unwrap_err();
    assert!(e.is("AccountOrderMismatch"), "{e:?}");
    // wrong oracle (feed of another mint)
    let mut ix = create_ix(&env, &c, &args);
    let n = ix.accounts.len();
    ix.accounts[n - 11].pubkey = feed_pda(&env.usdc.mint);
    let e = tx!(env, [ix], [&creator]).unwrap_err();
    assert!(e.is("InvalidOracle"), "{e:?}");
}

// ---------------- join ----------------

#[test]
fn ix_join__initial_mints_value_and_locks_shares() {
    let mut env = setup();
    let creator = env.user(200_000_000_000);
    let index = { let __a = CreateArgs::new(1, mag4(&env)); create(&mut env, &creator, &__a) };
    let amounts = seed_deposit(&mut env, &index, &creator, 100_000_000_000);
    let st = env.index(&index);
    for (i, a) in st.assets.iter().enumerate() {
        assert_eq!(a.balance, amounts[i]);
        assert_eq!(token_balance(&env.svm, &ata(&index, &a.mint, &a.token_program)), amounts[i]);
    }
    assert_eq!(env.share_balance(&index, &index), LOCKED_SHARES);
    let user_shares = env.share_balance(&index, &creator.pubkey());
    // ≈ $100k minus spread (0.3%) minus locked shares; 1 share ≈ $1
    assert!(user_shares > 99_600_000_000 && user_shares < 100_000_000_000, "{user_shares}");
}

#[test]
fn ix_join__initial_errors() {
    let mut env = setup();
    let creator = env.user(200_000_000_000);
    let index = { let __a = CreateArgs::new(1, mag4(&env)); create(&mut env, &creator, &__a) };
    let st = env.index(&index);
    for a in &st.assets {
        env.buy(&creator, &a.mint, 1_000_000_000);
    }
    let bal: Vec<u64> = st.assets.iter().map(|a| env.balance(&creator.pubkey(), &a.mint)).collect();
    // too small ($0.40 total)
    let tiny: Vec<u64> = st.assets.iter().map(|a| env.raw_for(&a.mint, 100_000)).collect();
    let e = join(&mut env, &index, &creator, tiny, 0).unwrap_err();
    assert!(e.is("InitialValueTooSmall"), "{e:?}");
    // equal amounts violate 40/30/20/10 targets
    let equal: Vec<u64> = st.assets.iter().map(|a| env.raw_for(&a.mint, 250_000_000)).collect();
    let e = join(&mut env, &index, &creator, equal, 0).unwrap_err();
    assert!(e.is("InitialWeightMismatch"), "{e:?}");
    // min_shares too high
    let ok: Vec<u64> = st.assets.iter().map(|a| env.raw_for(&a.mint, 1_000_000_000 * a.target_weight_bps as u64 / 10_000)).collect();
    let e = join(&mut env, &index, &creator, ok.clone(), u64::MAX).unwrap_err();
    assert!(e.is("SlippageExceeded"), "{e:?}");
    // missing oracle segment on first deposit
    let mut ix = join_ix(&env, &index, &creator.pubkey(), ok, 0);
    for _ in 0..4 {
        ix.accounts.pop();
    }
    let cp = creator.pubkey();
    let e = tx!(env, [share_ata_ix(&cp, &cp, &index), ix], [&creator]).unwrap_err();
    assert!(e.is("AccountOrderMismatch"), "{e:?}");
    let _ = bal;
}

#[test]
fn ix_join__proportional_fee_and_paused() {
    let mut env = setup();
    let creator = env.user(200_000_000_000);
    let mut args = CreateArgs::new(1, mag4(&env));
    args.fees = fees(0, 100, 0); // 1% entry fee
    let index = create(&mut env, &creator, &args);
    seed_deposit(&mut env, &index, &creator, 10_000_000_000);
    let supply0 = mint_supply(&env.svm, &share_pda(&index)) + env.index(&index).owed_total().unwrap();

    let b = env.user(20_000_000_000);
    let st = env.index(&index);
    // B buys 10% of vault holdings of each asset
    let want: Vec<u64> = st.assets.iter().map(|a| a.balance / 10).collect();
    for (i, a) in st.assets.iter().enumerate() {
        let usd = index_math::value_usd(want[i], a.decimals, index_math::MULT_FP, index_math::Price { price: env.asset(&a.mint).price, expo: -8 }).unwrap();
        env.buy(&b, &a.mint, usd * 102 / 100);
    }
    join(&mut env, &index, &b, want.clone(), 1).expect("join B");
    let st2 = env.index(&index);
    for i in 0..4 {
        let paid = st2.assets[i].balance - st.assets[i].balance;
        assert!(paid <= want[i] && paid + 1 >= want[i], "asset {i}: {paid} vs {}", want[i]);
    }
    let b_shares = env.share_balance(&index, &b.pubkey());
    let gross = supply0 / 10;
    let exp = gross * 99 / 100;
    assert!(b_shares.abs_diff(exp) <= exp / 10_000, "{b_shares} vs {exp}");
    assert!(st2.owed_creator_shares >= gross / 100 - 1);

    // paused → join rejected
    let c = creator.pubkey();
    tx!(env, [creator_only(&c, &index, index_vault::instruction::SetPaused { paused: true })], [&creator]).unwrap();
    let e = join(&mut env, &index, &b, want, 0).unwrap_err();
    assert!(e.is("Paused"), "{e:?}");
}

#[test]
fn ix_join__donation_to_vault_is_ignored() {
    let mut env = setup();
    let creator = env.user(200_000_000_000);
    let index = { let __a = CreateArgs::new(1, mag4(&env)); create(&mut env, &creator, &__a) };
    seed_deposit(&mut env, &index, &creator, 10_000_000_000);
    let before = env.index(&index);
    // attacker donates AAPLx directly to the vault ATA
    let attacker = env.user(5_000_000_000);
    let am = env.aapl.mint;
    env.buy(&attacker, &am, 4_000_000_000);
    let amt = env.balance(&attacker.pubkey(), &env.aapl.mint);
    let tp = env.aapl.tp;
    let ix = transfer_checked_ix(&tp, &ata(&attacker.pubkey(), &am, &tp), &am, &ata(&index, &am, &tp), &attacker.pubkey(), amt, 8);
    tx!(env, [ix], [&attacker]).unwrap();
    let after = env.index(&index);
    assert_eq!(before.assets[0].balance, after.assets[0].balance, "internal balance unchanged");
    // redeem pays out from internal balances only
    let shares = env.share_balance(&index, &creator.pubkey());
    let c = creator.pubkey();
    let ix = redeem_ix(&env, &index, &c, shares, vec![0; 4]);
    tx!(env, [ix], [&creator]).unwrap();
    let vault_aapl = token_balance(&env.svm, &ata(&index, &env.aapl.mint, &tp));
    assert!(vault_aapl >= amt, "donation stays in the vault ATA, untouched");
}

#[test]
fn ix_join__scaled_multiplier_changes_valuation() {
    let mut env = setup();
    let creator = env.user(200_000_000_000);
    let index = { let __a = CreateArgs::new(1, vec![(env.aapl.mint, 5000), (env.usdc.mint, 5000)]); create(&mut env, &creator, &__a) };
    // AAPLx split 2:1 → multiplier 2.0 and half price; first deposit must use UI value
    let a = env.admin.pubkey();
    let set = mk(
        MARKET,
        mock_market::instruction::SetMultiplier { multiplier: 2.0, effective_ts: 0 },
        mock_market::accounts::SetMultiplier { authority: a, market: market_pda(), mint: env.aapl.mint, token_program: TOKEN_2022 },
        vec![],
    );
    tx!(env, [set], [&env.admin]).unwrap();
    let aapl = env.aapl.mint;
    env.set_price(&aapl, 16_852_500_000);
    env.buy(&creator, &aapl, 5_000_000_000);
    let raw = env.balance(&creator.pubkey(), &aapl);
    // value(raw) with multiplier 2 ≈ $4985 → pair with ~$4985 USDC
    let v = index_math::value_usd(raw, 8, 2 * index_math::MULT_FP, index_math::Price { price: 16_852_500_000, expo: -8 }).unwrap();
    join(&mut env, &index, &creator, vec![raw, v], 1).expect("join with multiplier");
    let shares = env.share_balance(&index, &creator.pubkey());
    assert!(shares + LOCKED_SHARES >= 2 * v - 2 && shares + LOCKED_SHARES <= 2 * v + 2, "{shares} vs {}", 2 * v);
}

// ---------------- redeem ----------------

#[test]
fn ix_redeem__proportional_exit_fee_and_errors() {
    let mut env = setup();
    let creator = env.user(200_000_000_000);
    let mut args = CreateArgs::new(1, mag4(&env));
    args.fees = fees(0, 0, 100); // 1% exit fee
    let index = create(&mut env, &creator, &args);
    seed_deposit(&mut env, &index, &creator, 10_000_000_000);
    let c = creator.pubkey();
    let st = env.index(&index);
    let shares = env.share_balance(&index, &c) / 2;
    let supply = mint_supply(&env.svm, &share_pda(&index));

    let e = tx!(env, [redeem_ix(&env, &index, &c, 0, vec![0; 4])], [&creator]).unwrap_err();
    assert!(e.is("ZeroShares"), "{e:?}");
    let e = tx!(env, [redeem_ix(&env, &index, &c, shares, vec![u64::MAX, 0, 0, 0])], [&creator]).unwrap_err();
    assert!(e.is("SlippageExceeded"), "{e:?}");

    let before: Vec<u64> = st.assets.iter().map(|a| env.balance(&c, &a.mint)).collect();
    tx!(env, [redeem_ix(&env, &index, &c, shares, vec![0; 4])], [&creator]).expect("redeem");
    let net = shares - shares / 100;
    for (i, a) in st.assets.iter().enumerate() {
        let got = env.balance(&c, &a.mint) - before[i];
        assert_eq!(got, (net as u128 * a.balance as u128 / supply as u128) as u64);
    }
    assert!(env.index(&index).owed_creator_shares >= shares / 100);
}

#[test]
fn ix_redeem__allowed_when_paused_and_without_creator_accounts() {
    let mut env = setup();
    let creator = env.user(200_000_000_000);
    let index = { let __a = CreateArgs::new(1, mag4(&env)); create(&mut env, &creator, &__a) };
    seed_deposit(&mut env, &index, &creator, 10_000_000_000);
    let b = env.user(20_000_000_000);
    let st = env.index(&index);
    let want: Vec<u64> = st.assets.iter().map(|a| a.balance / 20).collect();
    for a in &st.assets {
        env.buy(&b, &a.mint, 1_000_000_000);
    }
    join(&mut env, &index, &b, want, 1).expect("join");
    let c = creator.pubkey();
    tx!(env, [creator_only(&c, &index, index_vault::instruction::SetPaused { paused: true })], [&creator]).unwrap();
    // creator has no share ATA for fees; redeem never touches creator accounts
    let bs = env.share_balance(&index, &b.pubkey());
    let bp = b.pubkey();
    tx!(env, [redeem_ix(&env, &index, &bp, bs, vec![0; 4])], [&b]).expect("redeem while paused");
    assert_eq!(env.share_balance(&index, &bp), 0);
}

// ---------------- fees ----------------

#[test]
fn ix_accrue_and_claim_fees__creator_platform_parent() {
    let mut env = setup();
    let a = env.user(300_000_000_000);
    let index = { let __a = CreateArgs::new(1, mag4(&env)); create(&mut env, &a, &__a) }; // 5% mgmt
    seed_deposit(&mut env, &index, &a, 100_000_000_000);
    let c = env.user(300_000_000_000);
    let mut child = CreateArgs::new(1, mag4(&env));
    child.parent = Some(index);
    let child_index = create(&mut env, &c, &child);
    seed_deposit(&mut env, &child_index, &c, 100_000_000_000);

    env.warp(30 * 86_400);
    tx!(env, [accrue_ix(&index), accrue_ix(&child_index)], [&a]).expect("accrue");
    let st = env.index(&index);
    let supply = mint_supply(&env.svm, &share_pda(&index));
    // 6%/yr for 30 days ≈ 0.49% dilution
    let total = st.owed_creator_shares + st.owed_platform_shares;
    assert!(total > supply / 250 && total < supply / 150, "{total} of {supply}");
    assert_eq!(st.owed_parent_shares, 0);
    let cst = env.index(&child_index);
    assert!(cst.owed_parent_shares > 0, "royalty accrues to parent");

    // creator claims
    let ap = a.pubkey();
    tx!(env, [share_ata_ix(&ap, &ap, &index), claim_ix(&ap, &index, FeeKind::Creator, None)], [&a]).expect("claim creator");
    assert!(env.share_balance(&index, &ap) > 0);
    assert_eq!(env.index(&index).owed_creator_shares, 0);
    // wrong claimer
    let cp = c.pubkey();
    tx!(env, [share_ata_ix(&cp, &cp, &index)], [&c]).unwrap();
    let e = tx!(env, [claim_ix(&cp, &index, FeeKind::Creator, None)], [&c]).unwrap_err();
    assert!(e.is("Unauthorized"), "{e:?}");
    // platform treasury (admin)
    let adm = env.admin.pubkey();
    tx!(env, [share_ata_ix(&adm, &adm, &index), claim_ix(&adm, &index, FeeKind::Platform, None)], [&env.admin]).expect("claim platform");
    assert!(env.share_balance(&index, &adm) > 0);
    // parent creator claims royalty on the child index
    tx!(env, [share_ata_ix(&ap, &ap, &child_index), claim_ix(&ap, &child_index, FeeKind::Parent, Some(index))], [&a]).expect("claim parent");
    assert!(env.share_balance(&child_index, &ap) > 0);
    // parent claim without the parent account
    let e = tx!(env, [claim_ix(&ap, &child_index, FeeKind::Parent, None)], [&a]).unwrap_err();
    assert!(e.is("InvalidParent"), "{e:?}");
}

// ---------------- updates ----------------

#[test]
fn ix_propose_apply_cancel__timelock_rules() {
    let mut env = setup_with(3600);
    let creator = env.user(200_000_000_000);
    let index = { let __a = CreateArgs::new(1, mag4(&env)); create(&mut env, &creator, &__a) };
    seed_deposit(&mut env, &index, &creator, 10_000_000_000);
    let c = creator.pubkey();

    // fee decrease applies immediately
    let lower = UpdateInput { assets: None, fees: Some(fees(200, 0, 0)), strategy: None };
    tx!(env, [propose_ix(&env, &c, &index, lower)], [&creator]).expect("lower fee");
    let st = env.index(&index);
    assert_eq!(st.fees.mgmt_fee_bps, 200);
    assert!(st.pending_update.is_none());

    // new weights + new asset → timelocked
    let next = vec![
        AssetInput { mint: env.aapl.mint, target_weight_bps: 3000 },
        AssetInput { mint: env.nvda.mint, target_weight_bps: 3000 },
        AssetInput { mint: env.tsla.mint, target_weight_bps: 2000 },
        AssetInput { mint: env.pre.mint, target_weight_bps: 1000 },
        AssetInput { mint: env.usdc.mint, target_weight_bps: 1000 },
    ];
    let up = UpdateInput { assets: Some(next), fees: None, strategy: None };
    tx!(env, [propose_ix(&env, &c, &index, up)], [&creator]).expect("propose");
    let e = tx!(env, [apply_ix(&env, &c, &index)], [&creator]).unwrap_err();
    assert!(e.is("TimelockActive"), "{e:?}");
    env.warp(3601);
    tx!(env, [apply_ix(&env, &c, &index)], [&creator]).expect("apply");
    let st = env.index(&index);
    assert_eq!(st.assets.len(), 5);
    assert_eq!(st.assets[4].balance, 0);
    assert!(env.svm.get_account(&ata(&index, &env.usdc.mint, &TOKEN)).is_some(), "new vault ATA");

    // no pending → errors
    let e = tx!(env, [apply_ix(&env, &c, &index)], [&creator]).unwrap_err();
    assert!(e.is("NoPendingUpdate"), "{e:?}");
    let e = tx!(env, [creator_only(&c, &index, index_vault::instruction::CancelUpdate {})], [&creator]).unwrap_err();
    assert!(e.is("NoPendingUpdate"), "{e:?}");

    // removing a funded asset is rejected at apply
    let drop_pre = vec![
        AssetInput { mint: env.aapl.mint, target_weight_bps: 5000 },
        AssetInput { mint: env.nvda.mint, target_weight_bps: 5000 },
    ];
    tx!(env, [propose_ix(&env, &c, &index, UpdateInput { assets: Some(drop_pre), fees: None, strategy: None })], [&creator]).unwrap();
    env.warp(3601);
    let e = tx!(env, [apply_ix(&env, &c, &index)], [&creator]).unwrap_err();
    assert!(e.is("AssetStillFunded"), "{e:?}");
    // cancel works
    tx!(env, [creator_only(&c, &index, index_vault::instruction::CancelUpdate {})], [&creator]).expect("cancel");
    assert!(env.index(&index).pending_update.is_none());

    // non-creator cannot propose
    let other = env.user(0);
    let o = other.pubkey();
    let e = tx!(env, [propose_ix(&env, &o, &index, UpdateInput { assets: None, fees: Some(fees(0, 0, 0)), strategy: None })], [&other]).unwrap_err();
    assert!(e.is("Unauthorized"), "{e:?}");
    // fee increase above the cap
    let e = tx!(env, [propose_ix(&env, &c, &index, UpdateInput { assets: None, fees: Some(fees(600, 0, 0)), strategy: None })], [&creator]).unwrap_err();
    assert!(e.is("FeeTooHigh"), "{e:?}");
}

// ---------------- managers / pause ----------------

#[test]
fn ix_set_managers_and_paused() {
    let mut env = setup();
    let creator = env.user(0);
    let index = { let __a = CreateArgs::new(1, mag4(&env)); create(&mut env, &creator, &__a) };
    let c = creator.pubkey();
    let m1 = Pubkey::new_unique();
    tx!(env, [creator_only(&c, &index, index_vault::instruction::SetManagers { managers: vec![m1] })], [&creator]).expect("managers");
    assert_eq!(env.index(&index).managers[0], m1);
    let e = tx!(env, [creator_only(&c, &index, index_vault::instruction::SetManagers { managers: vec![m1; 4] })], [&creator]).unwrap_err();
    assert!(e.is("InvalidManagers"), "{e:?}");
    let e = tx!(env, [creator_only(&c, &index, index_vault::instruction::SetManagers { managers: vec![m1, m1] })], [&creator]).unwrap_err();
    assert!(e.is("InvalidManagers"), "{e:?}");
    let other = env.user(0);
    let o = other.pubkey();
    let e = tx!(env, [creator_only(&o, &index, index_vault::instruction::SetPaused { paused: true })], [&other]).unwrap_err();
    assert!(e.is("Unauthorized"), "{e:?}");
    tx!(env, [creator_only(&c, &index, index_vault::instruction::SetPaused { paused: true })], [&creator]).expect("pause");
    assert!(env.index(&index).paused);
}
