# A03 — Token-2022 & Scaled UI Amount

## Pertanyaan
Dukungan anchor-spl untuk Token-2022, `transfer_checked` lintas program token, membuat mint ScaledUiAmount + update multiplier dari program, membaca multiplier efektif di program & Kit.

## Sumber yang dibaca
`research/R1-program.md` §2 (diuji di LiteSVM), `research/R2-client.md` §5, docs.rs `spl-token-2022-interface` 2.1.0, `@solana-program/token-2022` 0.19.0.

## Temuan
- anchor-spl 1.2 tidak punya helper ScaledUiAmount; `anchor_spl::token_2022::spl_token_2022` (re-export `spl-token-2022-interface` 2.1.0) menyediakan `scaled_ui_amount::instruction::{initialize, update_multiplier}` dan `ScaledUiAmountConfig`.
- Urutan pembuatan mint: `create_account` (PDA `["mint", symbol]` menandatangani) → `initialize` ScaledUiAmount (authority = PDA market, multiplier 1.0) → `initialize_mint2` (mint authority = PDA market).
- Multiplier efektif: `new_multiplier` bila `now ≥ new_multiplier_effective_timestamp`, selain itu `multiplier` (fungsi library privat → direplikasi di `mock_market::utils::mint_mult_fp`).
- `transfer_checked` lintas program: program token diambil dari `mint.owner` dan dicocokkan dengan akun `token_program`/`token_2022_program` yang dipasok (`vault::token_program_for`).
- Kit: `@solana-program/token-2022` 0.19 men-decode `ScaledUiAmountConfig`; konversi UI memakai float.

## Keputusan
- Float hanya di satu titik: `index_math::mult_fp_from_f64` (Rust) = `multFpFromF64` (SDK) → fixed point 1e12, pembulatan half-up, diuji dengan test vector paritas.
- Saham & IPO target: Token-2022 + ScaledUiAmount, 8 desimal. Pre-IPO: Token-2022 tanpa ekstensi, 8 desimal. USDC: SPL Token klasik 6 desimal. Share token index: SPL Token klasik 6 desimal.

## Dampak ke implementasi
- `mock_market.set_multiplier(multiplier: f64, effective_ts)` untuk simulasi split/dividen; valuasi vault & swap otomatis memakai multiplier efektif.
- SDK membaca multiplier dari akun mint (decode ekstensi) dan memakai fungsi fixed point yang sama.
