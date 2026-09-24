//! index_vault test harness: both programs, a bootstrapped market, config and funded users.
#![allow(dead_code)]

use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use index_math::{raw_for_value, Price, MULT_FP};
use index_vault::state::*;
pub use test_utils::*;

pub const VAULT: Pubkey = index_vault::ID;
pub const MARKET: Pubkey = mock_market::ID;
pub const IX_SYSVAR: Pubkey = anchor_lang::prelude::pubkey!("Sysvar1nstructions1111111111111111111111111");

pub struct Asset {
    pub mint: Pubkey,
    pub tp: Pubkey,
    pub decimals: u8,
    pub price: i64,
}

pub struct Env {
    pub svm: LiteSVM,
    pub admin: Keypair,
    pub usdc: Asset,
    pub aapl: Asset,
    pub nvda: Asset,
    pub tsla: Asset,
    pub pre: Asset,
}

pub fn market_pda() -> Pubkey {
    pda(&[mock_market::constants::MARKET_SEED], &MARKET)
}
pub fn mint_pda(symbol: &str) -> Pubkey {
    pda(&[mock_market::constants::MINT_SEED, symbol.as_bytes()], &MARKET)
}
pub fn feed_pda(mint: &Pubkey) -> Pubkey {
    pda(&[mock_market::constants::FEED_SEED, mint.as_ref()], &MARKET)
}
pub fn ipo_pda(mint: &Pubkey) -> Pubkey {
    pda(&[mock_market::constants::IPO_SEED, mint.as_ref()], &MARKET)
}
pub fn config_pda() -> Pubkey {
    pda(&[index_vault::constants::CONFIG_SEED], &VAULT)
}
pub fn index_pda(creator: &Pubkey, id: u64) -> Pubkey {
    pda(&[index_vault::constants::INDEX_SEED, creator.as_ref(), &id.to_le_bytes()], &VAULT)
}
pub fn share_pda(index: &Pubkey) -> Pubkey {
    pda(&[index_vault::constants::SHARE_SEED, index.as_ref()], &VAULT)
}

pub fn mk<D: InstructionData, A: ToAccountMetas>(program: Pubkey, data: D, accounts: A, extra: Vec<AccountMeta>) -> Instruction {
    let mut metas = accounts.to_account_metas(None);
    metas.extend(extra);
    Instruction { program_id: program, accounts: metas, data: data.data() }
}

pub fn ro(k: Pubkey) -> AccountMeta {
    AccountMeta::new_readonly(k, false)
}
pub fn rw(k: Pubkey) -> AccountMeta {
    AccountMeta::new(k, false)
}

// ---------------- market ----------------

pub fn set_prices_ix(admin: &Pubkey, feeds: &[(Pubkey, i64)]) -> Instruction {
    mk(
        MARKET,
        mock_market::instruction::SetPrices {
            prices: feeds.iter().map(|(_, p)| mock_market::state::PriceInput { price: *p, expo: -8, conf: 0 }).collect(),
        },
        mock_market::accounts::SetPrices { authority: *admin, market: market_pda() },
        feeds.iter().map(|(f, _)| rw(*f)).collect(),
    )
}

fn create_asset(svm: &mut LiteSVM, admin: &Keypair, symbol: &str, decimals: u8, t22: bool, scaled: bool, kind: mock_market::state::AssetKind, price: i64) -> Asset {
    let a = admin.pubkey();
    let mint = mint_pda(symbol);
    let tp = if t22 { TOKEN_2022 } else { TOKEN };
    let mut ixs = vec![];
    if symbol != "USDC" {
        ixs.push(mk(
            MARKET,
            mock_market::instruction::CreateMockMint { symbol: symbol.into(), decimals, token_2022: t22, scaled_ui: scaled },
            mock_market::accounts::CreateMockMint { authority: a, market: market_pda(), mint, token_program: tp, system_program: SYSTEM },
            vec![],
        ));
    }
    ixs.push(mk(
        MARKET,
        mock_market::instruction::CreateFeed { kind },
        mock_market::accounts::CreateFeed { authority: a, market: market_pda(), mint, feed: feed_pda(&mint), system_program: SYSTEM },
        vec![],
    ));
    send(svm, &ixs, &[admin]).expect("create asset");
    Asset { mint, tp, decimals, price }
}

impl Env {
    pub fn assets(&self) -> [&Asset; 5] {
        [&self.usdc, &self.aapl, &self.nvda, &self.tsla, &self.pre]
    }

    pub fn asset(&self, mint: &Pubkey) -> &Asset {
        self.assets().into_iter().find(|a| a.mint == *mint).expect("asset")
    }

    /// Re-publish every price (oracles go stale after 120s).
    pub fn refresh_prices(&mut self) {
        let feeds: Vec<(Pubkey, i64)> = self.assets().iter().map(|a| (feed_pda(&a.mint), a.price)).collect();
        let admin = self.admin.pubkey();
        send(&mut self.svm, &[set_prices_ix(&admin, &feeds)], &[&self.admin]).expect("prices");
    }

    pub fn set_price(&mut self, mint: &Pubkey, price: i64) {
        for a in [&mut self.usdc, &mut self.aapl, &mut self.nvda, &mut self.tsla, &mut self.pre] {
            if a.mint == *mint {
                a.price = price;
            }
        }
        self.refresh_prices();
    }

    pub fn warp(&mut self, secs: i64) {
        warp(&mut self.svm, secs);
        self.refresh_prices();
    }

    /// Funded user with ATAs for every asset and `usdc` micro-USDC.
    pub fn user(&mut self, usdc: u64) -> Keypair {
        let u = funded(&mut self.svm);
        let mut ixs: Vec<Instruction> = self.assets().iter().map(|a| create_ata_ix(&u.pubkey(), &u.pubkey(), &a.mint, &a.tp)).collect();
        if usdc > 0 { ixs.push(mk(
            MARKET,
            mock_market::instruction::Faucet { amount: usdc },
            mock_market::accounts::Faucet {
                user: u.pubkey(),
                market: market_pda(),
                usdc_mint: self.usdc.mint,
                user_ata: ata(&u.pubkey(), &self.usdc.mint, &TOKEN),
                token_program: TOKEN,
            },
            vec![],
        )); }
        send(&mut self.svm, &ixs, &[&u]).expect("user");
        u
    }

    pub fn swap_ix(&self, user: &Pubkey, from: &Asset, to: &Asset, amount: u64) -> Instruction {
        mk(
            MARKET,
            mock_market::instruction::Swap { amount_in: amount, min_out: 0 },
            mock_market::accounts::Swap {
                user: *user,
                market: market_pda(),
                mint_in: from.mint,
                mint_out: to.mint,
                feed_in: feed_pda(&from.mint),
                feed_out: feed_pda(&to.mint),
                user_ata_in: ata(user, &from.mint, &from.tp),
                user_ata_out: ata(user, &to.mint, &to.tp),
                token_program_in: from.tp,
                token_program_out: to.tp,
            },
            vec![],
        )
    }

    /// Buy `usdc` worth of `mint` for `user` (USDC → asset swap).
    pub fn buy(&mut self, user: &Keypair, mint: &Pubkey, usdc: u64) {
        if *mint == self.usdc.mint {
            return;
        }
        let ix = self.swap_ix(&user.pubkey(), &self.usdc, self.asset(mint), usdc);
        send(&mut self.svm, &[ix], &[user]).expect("buy");
    }

    pub fn balance(&self, owner: &Pubkey, mint: &Pubkey) -> u64 {
        token_balance(&self.svm, &ata(owner, mint, &self.asset(mint).tp))
    }

    pub fn index(&self, index: &Pubkey) -> Index {
        Index::try_deserialize(&mut &account_data(&self.svm, index)[..]).expect("index")
    }

    pub fn config(&self) -> GlobalConfig {
        GlobalConfig::try_deserialize(&mut &account_data(&self.svm, &config_pda())[..]).expect("config")
    }

    pub fn share_balance(&self, index: &Pubkey, owner: &Pubkey) -> u64 {
        token_balance(&self.svm, &ata(owner, &share_pda(index), &TOKEN))
    }

    /// Raw amount of `mint` worth `usd_micro` at current price (multiplier 1).
    pub fn raw_for(&self, mint: &Pubkey, usd_micro: u64) -> u64 {
        let a = self.asset(mint);
        raw_for_value(usd_micro, a.decimals, MULT_FP, Price { price: a.price, expo: -8 }).unwrap()
    }
}

pub fn config_params(market_program: Pubkey, treasury: Pubkey, timelock: u32) -> ConfigParams {
    ConfigParams {
        platform_treasury: treasury,
        platform_fee_bps: 100,
        clone_royalty_bps: 1000,
        market_program,
        timelock_secs: timelock,
        oracle_max_age_secs: 120,
    }
}

pub fn init_config_ix(admin: &Pubkey, params: ConfigParams) -> Instruction {
    mk(
        VAULT,
        index_vault::instruction::InitConfig { params },
        index_vault::accounts::InitConfig { admin: *admin, config: config_pda(), system_program: SYSTEM },
        vec![],
    )
}

pub fn setup_with(timelock: u32) -> Env {
    let mut svm = new_svm();
    svm.add_program(MARKET, include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/mock_market.so"))).unwrap();
    svm.add_program(VAULT, include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/index_vault.so"))).unwrap();
    let admin = funded(&mut svm);
    let a = admin.pubkey();
    let init = mk(
        MARKET,
        mock_market::instruction::InitMarket { spread_bps: 30, faucet_max: 10_000_000_000_000, oracle_max_age_secs: 120 },
        mock_market::accounts::InitMarket { authority: a, market: market_pda(), usdc_mint: mint_pda("USDC"), token_program: TOKEN, system_program: SYSTEM },
        vec![],
    );
    send(&mut svm, &[init], &[&admin]).expect("market");
    use mock_market::state::AssetKind as K;
    let usdc = create_asset(&mut svm, &admin, "USDC", 6, false, false, K::Stable, 100_000_000);
    let aapl = create_asset(&mut svm, &admin, "AAPLx", 8, true, true, K::Stock, 33_705_000_000);
    let nvda = create_asset(&mut svm, &admin, "NVDAx", 8, true, true, K::Stock, 22_545_000_000);
    let tsla = create_asset(&mut svm, &admin, "TSLAx", 8, true, true, K::Stock, 38_023_000_000);
    let pre = create_asset(&mut svm, &admin, "SPACEX-pre", 8, true, false, K::PreIpo, 11_523_000_000);
    send(&mut svm, &[init_config_ix(&a, config_params(MARKET, a, timelock))], &[&admin]).expect("config");
    let mut env = Env { svm, admin, usdc, aapl, nvda, tsla, pre };
    env.refresh_prices();
    env
}

pub fn setup() -> Env {
    setup_with(0)
}

// ---------------- index_vault builders ----------------

pub fn fees(m: u16, e: u16, x: u16) -> FeeConfig {
    FeeConfig { mgmt_fee_bps: m, entry_fee_bps: e, exit_fee_bps: x }
}

pub fn strategy() -> Strategy {
    Strategy {
        mode: StrategyMode::Threshold,
        drift_threshold_bps: 500,
        period_secs: 0,
        max_slippage_bps: 100,
        cooldown_secs: 0,
        allow_keeper: true,
    }
}

pub struct CreateArgs {
    pub id: u64,
    pub assets: Vec<(Pubkey, u16)>,
    pub fees: FeeConfig,
    pub strategy: Strategy,
    pub parent: Option<Pubkey>,
    pub follows: bool,
    pub name: String,
    pub symbol: String,
}

impl CreateArgs {
    pub fn new(id: u64, assets: Vec<(Pubkey, u16)>) -> Self {
        Self { id, assets, fees: fees(500, 0, 0), strategy: strategy(), parent: None, follows: false, name: "Mag Four".into(), symbol: "MAG4".into() }
    }
}

pub fn create_ix(env: &Env, creator: &Pubkey, args: &CreateArgs) -> Instruction {
    let index = index_pda(creator, args.id);
    let share = share_pda(&index);
    let mut extra = vec![];
    for (mint, _) in &args.assets {
        let tp = env.svm.get_account(mint).map(|a| a.owner).unwrap_or(TOKEN_2022);
        extra.push(ro(*mint));
        extra.push(ro(feed_pda(mint)));
        extra.push(rw(ata(&index, mint, &tp)));
    }
    mk(
        VAULT,
        index_vault::instruction::CreateIndex {
            index_id: args.id,
            name: args.name.clone(),
            symbol: args.symbol.clone(),
            uri: "http://localhost:3000/api/meta/x".into(),
            assets: args.assets.iter().map(|(m, w)| AssetInput { mint: *m, target_weight_bps: *w }).collect(),
            fees: args.fees,
            strategy: args.strategy,
            follows_parent: args.follows,
        },
        index_vault::accounts::CreateIndex {
            creator: *creator,
            config: config_pda(),
            index,
            share_mint: share,
            index_share_ata: ata(&index, &share, &TOKEN),
            parent_index: args.parent,
            token_program: TOKEN,
            token_2022_program: TOKEN_2022,
            associated_token_program: ATA_PROGRAM,
            system_program: SYSTEM,
        },
        extra,
    )
}

pub fn create(env: &mut Env, creator: &Keypair, args: &CreateArgs) -> Pubkey {
    let ix = create_ix(env, &creator.pubkey(), args);
    send(&mut env.svm, &[ix], &[creator]).expect("create index");
    index_pda(&creator.pubkey(), args.id)
}

pub fn share_ata_ix(payer: &Pubkey, owner: &Pubkey, index: &Pubkey) -> Instruction {
    create_ata_ix(payer, owner, &share_pda(index), &TOKEN)
}

pub fn join_ix(env: &Env, index: &Pubkey, user: &Pubkey, max_amounts: Vec<u64>, min_shares: u64) -> Instruction {
    let st = env.index(index);
    let share = share_pda(index);
    let supply = mint_supply(&env.svm, &share) + st.owed_total().unwrap();
    let mut extra = vec![];
    for a in &st.assets {
        extra.push(ro(a.mint));
        extra.push(rw(ata(index, &a.mint, &a.token_program)));
        extra.push(rw(ata(user, &a.mint, &a.token_program)));
    }
    if supply == 0 {
        for a in &st.assets {
            extra.push(ro(a.oracle));
        }
    }
    mk(
        VAULT,
        index_vault::instruction::Join { max_amounts, min_shares },
        index_vault::accounts::Join {
            user: *user,
            config: config_pda(),
            index: *index,
            share_mint: share,
            user_share_ata: ata(user, &share, &TOKEN),
            index_share_ata: ata(index, &share, &TOKEN),
            token_program: TOKEN,
            token_2022_program: TOKEN_2022,
        },
        extra,
    )
}

pub fn join(env: &mut Env, index: &Pubkey, user: &Keypair, max_amounts: Vec<u64>, min_shares: u64) -> TxResult {
    let u = user.pubkey();
    let ixs = vec![share_ata_ix(&u, &u, index), join_ix(env, index, &u, max_amounts, min_shares)];
    send(&mut env.svm, &ixs, &[user])
}

/// First deposit: buy each asset for `usd * weight` and join with exactly that.
pub fn seed_deposit(env: &mut Env, index: &Pubkey, user: &Keypair, usd_micro: u64) -> Vec<u64> {
    let st = env.index(index);
    let mut amounts = vec![];
    for a in &st.assets {
        let usd = usd_micro * a.target_weight_bps as u64 / 10_000;
        let before = env.balance(&user.pubkey(), &a.mint);
        if a.mint == env.usdc.mint {
            amounts.push(usd);
        } else {
            env.buy(user, &a.mint, usd);
            amounts.push(env.balance(&user.pubkey(), &a.mint) - before);
        }
    }
    join(env, index, user, amounts.clone(), 1).expect("seed join");
    amounts
}

pub fn redeem_ix(env: &Env, index: &Pubkey, user: &Pubkey, shares: u64, min_amounts: Vec<u64>) -> Instruction {
    let st = env.index(index);
    let share = share_pda(index);
    let mut extra = vec![];
    for a in &st.assets {
        extra.push(ro(a.mint));
        extra.push(rw(ata(index, &a.mint, &a.token_program)));
        extra.push(rw(ata(user, &a.mint, &a.token_program)));
    }
    mk(
        VAULT,
        index_vault::instruction::Redeem { shares, min_amounts },
        index_vault::accounts::Redeem {
            user: *user,
            config: config_pda(),
            index: *index,
            share_mint: share,
            user_share_ata: ata(user, &share, &TOKEN),
            token_program: TOKEN,
            token_2022_program: TOKEN_2022,
        },
        extra,
    )
}

pub fn creator_only<D: InstructionData>(creator: &Pubkey, index: &Pubkey, data: D) -> Instruction {
    mk(VAULT, data, index_vault::accounts::CreatorOnly { creator: *creator, index: *index }, vec![])
}

pub fn accrue_ix(index: &Pubkey) -> Instruction {
    mk(
        VAULT,
        index_vault::instruction::AccrueFees {},
        index_vault::accounts::AccrueFees { config: config_pda(), index: *index, share_mint: share_pda(index) },
        vec![],
    )
}

pub fn claim_ix(claimer: &Pubkey, index: &Pubkey, kind: FeeKind, parent: Option<Pubkey>) -> Instruction {
    let share = share_pda(index);
    mk(
        VAULT,
        index_vault::instruction::ClaimFees { kind },
        index_vault::accounts::ClaimFees {
            claimer: *claimer,
            config: config_pda(),
            index: *index,
            share_mint: share,
            recipient_share_ata: ata(claimer, &share, &TOKEN),
            parent_index: parent,
            token_program: TOKEN,
        },
        vec![],
    )
}

pub fn propose_ix(env: &Env, creator: &Pubkey, index: &Pubkey, update: UpdateInput) -> Instruction {
    let mut extra = vec![];
    if let Some(assets) = &update.assets {
        for a in assets {
            extra.push(ro(a.mint));
            extra.push(ro(feed_pda(&a.mint)));
        }
    }
    let _ = env;
    mk(
        VAULT,
        index_vault::instruction::ProposeUpdate { update },
        index_vault::accounts::ProposeUpdate { creator: *creator, config: config_pda(), index: *index, share_mint: share_pda(index) },
        extra,
    )
}

/// Resulting asset list after apply (mirrors vault::replace_assets).
pub fn apply_ix(env: &Env, payer: &Pubkey, index: &Pubkey) -> Instruction {
    let st = env.index(index);
    let mut extra = vec![];
    if let Some(p) = &st.pending_update {
        if let Some(next) = &p.assets {
            for n in next {
                let bal = st.assets.iter().find(|c| c.mint == n.mint).map(|c| c.balance).unwrap_or(0);
                if bal > 0 || n.target_weight_bps > 0 {
                    extra.push(ro(n.mint));
                    extra.push(rw(ata(index, &n.mint, &n.token_program)));
                }
            }
        }
    }
    mk(
        VAULT,
        index_vault::instruction::ApplyUpdate {},
        index_vault::accounts::ApplyUpdate {
            payer: *payer,
            config: config_pda(),
            index: *index,
            share_mint: share_pda(index),
            token_program: TOKEN,
            token_2022_program: TOKEN_2022,
            associated_token_program: ATA_PROGRAM,
            system_program: SYSTEM,
        },
        extra,
    )
}

pub fn pairs(st: &Index) -> Vec<AccountMeta> {
    st.assets.iter().flat_map(|a| [ro(a.mint), ro(a.oracle)]).collect()
}

/// Four-instruction rebalance sandwich: begin → swap → transfer → end.
pub fn rebalance_ixs(env: &Env, executor: &Pubkey, index: &Pubkey, out: u8, amount_out: u64, inn: u8, min_in: u64) -> Vec<Instruction> {
    let st = env.index(index);
    let o = st.assets[out as usize];
    let i = st.assets[inn as usize];
    let out_asset = env.asset(&o.mint);
    let in_asset = env.asset(&i.mint);
    let begin = mk(
        VAULT,
        index_vault::instruction::BeginRebalance { asset_out: out, amount_out, asset_in: inn, min_amount_in: min_in },
        index_vault::accounts::BeginRebalance {
            executor: *executor,
            config: config_pda(),
            index: *index,
            vault_out_ata: ata(index, &o.mint, &o.token_program),
            executor_out_ata: ata(executor, &o.mint, &o.token_program),
            vault_in_ata: ata(index, &i.mint, &i.token_program),
            instructions: IX_SYSVAR,
            token_program: TOKEN,
            token_2022_program: TOKEN_2022,
        },
        pairs(&st),
    );
    let swap = env.swap_ix(executor, out_asset, in_asset, amount_out);
    // Expected swap output at current prices (what the executor forwards).
    let expected = index_math::swap_out(
        amount_out,
        out_asset.decimals,
        MULT_FP,
        Price { price: out_asset.price, expo: -8 },
        in_asset.decimals,
        MULT_FP,
        Price { price: in_asset.price, expo: -8 },
        30,
    )
    .unwrap();
    let transfer = transfer_checked_ix(
        &i.token_program,
        &ata(executor, &i.mint, &i.token_program),
        &i.mint,
        &ata(index, &i.mint, &i.token_program),
        executor,
        expected,
        i.decimals,
    );
    let end = with_vault_in(end_ix(index, executor, &st), ata(index, &i.mint, &i.token_program));
    vec![begin, swap, transfer, end]
}

pub fn end_ix(index: &Pubkey, executor: &Pubkey, st: &Index) -> Instruction {
    let t = st.rebalance_ticket.map(|t| t.asset_in as usize);
    let _ = t;
    mk(
        VAULT,
        index_vault::instruction::EndRebalance {},
        index_vault::accounts::EndRebalance {
            executor: *executor,
            config: config_pda(),
            index: *index,
            vault_in_ata: Pubkey::default(),
        },
        pairs(st),
    )
}

/// Fix the vault_in_ata of an end instruction built before the ticket existed.
pub fn with_vault_in(mut end: Instruction, vault_in: Pubkey) -> Instruction {
    end.accounts[3].pubkey = vault_in;
    end
}

/// Build the instructions first (borrowing `env`), then send them.
#[macro_export]
macro_rules! tx {
    ($env:expr, [$($ix:expr),* $(,)?], [$($s:expr),* $(,)?]) => {{
        let __ixs: Vec<Instruction> = vec![$($ix),*];
        send(&mut $env.svm, &__ixs, &[$($s),*])
    }};
}
