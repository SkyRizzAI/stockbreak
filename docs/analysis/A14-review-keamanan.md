# A14 — Review keamanan program

Status: **terverifikasi (P5, 2026-09-24)** — kode di `anchor/programs/*` + test LiteSVM (38 test hijau). Kolom "Bukti" menunjuk test.

| # | Risiko | Mitigasi di desain/kode | Bukti (P5) |
|---|---|---|---|
| 1 | Akun palsu di `remaining_accounts` | Setiap mint/oracle/ATA dicocokkan dengan `AssetEntry` dan alamat turunan (ATA, PDA feed); owner program token dicek || core `ix_create_index__account_order_and_oracle_checks`, `ix_join__initial_errors` (AccountOrderMismatch) |
| 2 | Oracle palsu | `oracle::load_feed`: owner = `config.market_program`, alamat = PDA `["feed", mint]`, diskriminator `OracleFeed`, mint cocok || core `…account_order_and_oracle_checks` (InvalidOracle: feed mint lain) |
| 3 | Oracle basi / conf lebar | `read_price`: `now - publish_time ≤ oracle_max_age_secs`, `conf/price ≤ 2%`, `price > 0` || advanced `rebalance__cooldown_same_asset_and_stale_oracle` (OracleStale); conf dicek di `oracle::read_price` |
| 4 | CPI ke program palsu | Satu-satunya CPI keluar ke program non-SPL: `convert` pada `config.market_program` (akun diverifikasi sama & executable) || advanced `ipo__migrates_pre_ipo_holding_and_rejects_bad_inputs` (InvalidMarketProgram) |
| 5 | Signer / otorisasi | creator (`has_one`), manager (array), keeper (hanya bila `allow_keeper` + pemicu on-chain + bukan PreIpo), platform treasury, parent creator || core `ix_set_config__…`, `ix_accrue_and_claim_fees__…` (Unauthorized), advanced `rebalance__keeper_rejected_…` |
| 6 | PDA seeds | index `["index", creator, id]`, share `["share", index]`, config `["config"]`, semua via constraint Anchor || constraint seeds Anchor; semua test memakai PDA turunan |
| 7 | Overflow | `index_math` checked/u128, `None` → `MathOverflow`; profil release `overflow-checks = true` || `index_math` checked + vektor paritas; `overflow-checks = true` |
| 8 | Pembulatan | join: `ceil` pada setoran, `floor` pada share; redeem: `floor` pada aset; fee `floor`; swap mock `floor` || core `ix_join__proportional_fee_and_paused`, `ix_redeem__proportional_exit_fee_and_errors` |
| 9 | Inflation / donation attack | `LOCKED_SHARES` ke ATA index saat join pertama; `MIN_INITIAL_VALUE`; saldo internal (`AssetEntry.balance`) mengabaikan donasi ke ATA vault || core `ix_join__initial_mints_value_and_locks_shares`, `ix_join__donation_to_vault_is_ignored` |
| 10 | Redeem diblokir kreator | redeem tidak memakai akun kreator/platform; fee jadi `owed_*`; tidak bergantung `paused` || core `ix_redeem__allowed_when_paused_and_without_creator_accounts` |
| 11 | Reentrancy rebalance | ticket + guard di semua instruksi kecuali end; begin/end top-level; whitelist program di antaranya; tepat satu end untuk index & executor sama || advanced `rebalance__sandwich_introspection` (MissingEnd, InvalidRebalanceTx ×2, NotTopLevel via CPI), `rebalance__active_ticket_blocks_other_instructions` |
| 12 | Rebalance merugikan | `min_amount_in`, `value_in ≥ value_out × (1 − max_slippage)`, `drift_after ≤ drift_before`, cooldown || advanced `rebalance__slippage_min_in_and_skimming_executor`, `…wrong_direction`, `…cooldown…` |
| 13 | Ekstensi Token-2022 berbahaya (transfer hook, pausable, fee) | Hanya mint yang dibuat `mock_market` (mint authority = PDA market) yang punya feed; feed hanya dibuat authority market → aset index dibatasi ke mint mock tanpa hook/fee || market `ix_create_feed__ok_and_not_market_mint`; feed hanya dibuat authority market |
| 14 | Dup mutable accounts | Anchor 1.x menolak duplikat mutable secara default || market `ix_swap__errors` (ConstraintDuplicateMutableAccount) |
| 15 | DoS lewat daftar aset | `MAX_ASSETS`, aset bersaldo tidak bisa dihapus (`AssetStillFunded`), sync follow `TooManyAssets` || core `ix_propose_apply_cancel__timelock_rules` (AssetStillFunded), `ix_create_index__validation_errors` (TooManyAssets) |
| 16 | Timelock dilewati | perubahan aset/strategi/fee naik lewat `pending_update` + `eta`; hanya penurunan fee yang langsung || core `ix_propose_apply_cancel__timelock_rules` (TimelockActive, penurunan fee langsung) |
| 17 | IPO konversi curang | `IpoConversion` owner/PDA dicek, `active`, `old/new_mint` cocok, delta ATA baru = `floor(balance × num / den)` || advanced `ipo__migrates_pre_ipo_holding_and_rejects_bad_inputs` (rasio 3:2, delta ATA) |
