# P04 — index_vault inti

## Tujuan
Semua instruksi inti index_vault teruji (sukses + gagal per error relevan).

## Referensi
PLAN §5.1–§5.3, §6.1, §6.2, §6.4 · A05 · A14.

## Scope
init_config, set_config, create_index, join, redeem, accrue_fees, claim_fees, propose/apply/cancel_update, set_managers, set_paused. Bootstrap `init_config` + airdrop admin/keeper/agent sudah di P3.

## Desain singkat
Harness `tests/common/mod.rs`: kedua program, market + 5 aset (USDC klasik, 3 saham Token-2022 scaled, 1 pre-IPO), config, user bermodal; builder instruksi dengan layout remaining_accounts A05; macro `tx!`.

## Tugas / bukti (tests/core.rs, 15 test)
- [x] config: ok, FeeTooHigh, Unauthorized
- [x] create_index: ok (kind/decimals/token program diturunkan, vault ATA dibuat), InvalidWeights (jumlah & bobot 0), DuplicateAsset, FeeTooHigh (mgmt & entry), InvalidSlippage, InvalidMetadata, InvalidParent, TooManyAssets, AccountOrderMismatch, InvalidOracle
- [x] join: deposit pertama (LOCKED_SHARES, share ≈ nilai USD), InitialValueTooSmall, InitialWeightMismatch, SlippageExceeded, AccountOrderMismatch (tanpa oracle), proporsional + entry fee, Paused, donasi ke ATA vault diabaikan, multiplier Scaled UI 2.0
- [x] redeem: proporsional + exit fee, ZeroShares, SlippageExceeded, tetap bisa saat paused & tanpa akun kreator
- [x] fees: akrual 30 hari, claim Creator/Platform/Parent, Unauthorized, InvalidParent
- [x] update: penurunan fee langsung, TimelockActive, apply menambah aset + vault ATA, NoPendingUpdate, AssetStillFunded, cancel, Unauthorized, FeeTooHigh
- [x] managers/pause: ok, InvalidManagers (terlalu banyak, duplikat), Unauthorized

## Gate
- [x] `cargo test -p index_vault --test core` hijau (15/15)
