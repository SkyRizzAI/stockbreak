# P02 — Kontrak & codegen

## Tujuan
Membekukan kontrak: akun, instruksi, event, error kedua program; client Codama; skema DB; paket config.

## Referensi
PLAN §5, §6, §7.1–§7.3 · A03 · A04 · A05 · A14 (desain).

## Scope
Masuk: seluruh signature + implementasi awal instruksi (logika ditulis sekaligus agar kontrak teruji di P3–P5), crate `index_math` + test vector, Codama, Drizzle + migrasi, `packages/config`. Tidak masuk: test program (P3–P5), SDK tingkat tinggi (P6).

## Desain singkat
- Crate `anchor/crates/index_math` (no_std, integer) dipakai kedua program; vektor paritas `vectors/math.json`.
- `mock_market::utils::mint_mult_fp` dipakai juga oleh vault (satu pembaca multiplier).
- Codama → `packages/sdk/src/generated/{index-vault,mock-market}`.

## Tugas
- [x] mock_market: state, error, 9 instruksi
- [x] index_vault: state, error, 14 event, 16 instruksi, `oracle.rs`, `vault.rs`
- [x] `index_math` + test vector (cargo test hijau)
- [x] `bun run codegen` (anchor build + Codama)
- [x] Drizzle schema + migrasi awal (app & app_test)
- [x] `packages/config` (env zod, cluster, registri aset, deployments)
- [x] A03, A04, A05, A14 (desain), PLAN §5.5, D023–D025

## Gate / kriteria selesai
- [x] `anchor build` · [x] `bun run codegen` · [x] `bun run typecheck` · [x] `bun run lint` · [x] migrasi berjalan. **Kontrak beku.**

## Risiko & fallback
Bug logika ditemukan saat test P3–P5 → perbaikan body instruksi bukan perubahan kontrak; perubahan signature/akun/event/error mengikuti Contract change.

## Catatan untuk fase berikutnya
- Nama TS: `fetchIndexAccount`, `findIndexAccountPda` (D024).
- Tx di atas ~5 aset butuh ALT (A05).
