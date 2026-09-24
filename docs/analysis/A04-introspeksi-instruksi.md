# A04 — Introspeksi instruksi (flash rebalance)

## Pertanyaan
API instructions sysvar di Anchor 1.2; memverifikasi instruksi antara `begin_rebalance` dan `end_rebalance`; memastikan top-level; pola keamanan.

## Sumber yang dibaca
`research/R1-program.md` §6 (diuji), crate `solana-instructions-sysvar` 3.0.1.

## Temuan
- `anchor_lang` tidak me-re-export fungsi load → dependensi langsung `solana-instructions-sysvar = "3"`: `load_current_index_checked`, `load_instruction_at_checked`.
- Sysvar hanya memuat instruksi top-level; CPI tidak terlihat → `get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT` wajib di begin & end (`NotTopLevel`).

## Keputusan (implementasi `rebalance.rs::check_sandwich`)
1. Mulai dari `current_index + 1`, iterasi sampai instruksi habis (`MissingEndInstruction`).
2. Instruksi milik `index_vault` pertama yang ditemui wajib `end_rebalance` (8 byte diskriminator) dengan akun ke-0 = executor yang sama dan akun ke-2 = index yang sama; selain itu `InvalidRebalanceTx`.
3. Instruksi lain di antaranya hanya boleh dari: `config.market_program`, SPL Token, Token-2022, Associated Token, Compute Budget; selain itu `InvalidRebalanceTx`.
4. Selama ticket aktif, semua instruksi index lain (join, redeem, update, dll.) gagal `RebalanceInProgress` (guard di setiap handler).
5. `end_rebalance` mengukur `amount_in` dari delta saldo ATA vault (bukan input executor), lalu menegakkan `min_amount_in`, slippage berbasis oracle, dan arah drift.

## Dampak ke implementasi
- Test P5: begin tanpa end, instruksi asing (join) di antaranya, begin via CPI (program penguji kecil tidak diperlukan: dicakup oleh `get_stack_height` — diuji dengan memanggil via program lain bila memungkinkan, jika tidak dicatat), executor berbeda di end, ticket aktif memblokir instruksi lain.
