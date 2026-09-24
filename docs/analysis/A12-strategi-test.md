# A12 — Strategi test

## Pertanyaan
Bagaimana setiap lapisan dites otomatis (program, SDK, worker/DB, web, MCP, e2e), bagaimana `bun run verify` menyatukannya, dan bagaimana kesiapan uji manual Phantom di devnet (§11.4) diverifikasi tanpa manusia.

## Sumber yang dibaca
- LiteSVM 0.16 (docs.rs/litesvm) + uji coba di `research/R1-program.md` §3 (load `.so`, Token-2022, `set_sysvar::<Clock>`, `warp_to_slot`, `expire_blockhash`).
- Surfpool 1.6 `surfnet_*` cheatcodes (`research/R1-program.md` §4).
- `bun test` (https://bun.sh/docs/cli/test), Playwright (https://playwright.dev/docs/test-configuration, `webServer`), MCP SDK v2 client in-process (`research/R3-web-infra.md` §7).

## Temuan
1. **Program (Rust, LiteSVM)**: cepat & deterministik, tanpa validator. Mendukung Token-2022 bawaan, clock warp, CPI antar dua program (muat kedua `.so`). Tidak menjalankan RPC → tidak menguji codec Codama.
2. **SDK (bun test)** perlu validator nyata (Surfpool offline) untuk paritas math terhadap state on-chain, zap multi-tx, ALT, dan decode event. Surfpool bisa dinyalakan per suite di port terpisah (mis. 18899/18900) agar tidak bentrok dengan `bun run dev`.
3. **Time travel** tersedia di Surfpool (`surfnet_timeTravel`, ms, maju saja) → test akrual fee & cooldown di level SDK/worker; di LiteSVM pakai `set_sysvar::<Clock>`.
4. **Worker/DB**: Postgres docker (5434) dengan database test terpisah (`app_test`), migrasi dijalankan di setup, tabel di-truncate antar test.
5. **Web**: Playwright + Dev Wallet (Wallet Standard in-page) → tanpa ekstensi. Phantom tidak bisa diotomasi secara wajar (ekstensi + onboarding) → kesiapan Phantom diverifikasi secara tidak langsung (poin 8).
6. **MCP**: client in-process (`handler.fetch` sebagai transport fetch) + client stdio untuk satu smoke test.
7. **Math paritas**: satu set test vector JSON (`packages/sdk/test/vectors/*.json`, dibuat di P2 dari `docs/specs/S04-math.md`) dibaca oleh test Rust (via `include_str!` + serde) dan `bun test` → hasil harus identik bit-per-bit (u64/u128 sebagai string).
8. **Kesiapan Phantom (devnet)**: syarat Phantom = transaksi v0, ukuran ≤ 1232 byte, fee payer = wallet user, lolos simulasi. Diverifikasi otomatis: builder SDK untuk setiap alur §1.2 menghasilkan tx yang (a) `version === 0`, (b) ukuran serialisasi ≤ 1232, (c) `simulateTransaction` di devnet `err === null` dengan `sigVerify: false, replaceRecentBlockhash: true` memakai wallet uji ber-SOL. Plus satu smoke Playwright terhadap `dev:devnet` dengan Dev Wallet (chain `solana:devnet`).

## Opsi
- Test program di TS terhadap validator saja (lambat, flaky) vs LiteSVM Rust (cepat) + subset integrasi di SDK → dipilih kombinasi.
- E2E dengan Phantom sungguhan (Playwright `launchPersistentContext --load-extension`) → rapuh, butuh seed phrase; ditolak. Diganti poin 8.

## Keputusan
| Lapisan | Alat | Lokasi | Perintah | Kapan |
|---|---|---|---|---|
| Program | LiteSVM 0.16 (Rust) | `anchor/programs/*/tests/*.rs` | `bun run test:program` → `cd anchor && anchor build && cargo test` | P3–P5 |
| Paritas math | test vector JSON | `packages/sdk/test/vectors/` + test Rust | bagian dari `test:program` & `test:ts` | P2 (vektor), P4, P6 |
| SDK | `bun test` + Surfpool offline port 18899 | `packages/sdk/test/**` | `bun run test:ts` (turbo `test`) | P6 |
| DB & worker | `bun test` + Postgres `app_test` + Surfpool | `packages/db/test/**`, `apps/worker/test/**` | `bun run test:ts` | P7 |
| MCP | `bun test` + client SDK v2 in-process | `apps/mcp/test/**` | `bun run test:ts` | P9 |
| Web smoke & e2e | Playwright + Dev Wallet | `e2e/**` | `bun run e2e` (menyalakan stack via `scripts/dev.ts --ci` bila belum jalan) | P8, P10 |
| Visual review | Playwright screenshot light/dark × 375/1280 | `e2e/visual/**` → `e2e/.artifacts/` (gitignore) | `bun run e2e:visual` | P10 |
| Kesiapan Phantom devnet | SDK builder + `simulateTransaction` devnet + Playwright Dev Wallet devnet | `scripts/verify-devnet.ts`, `e2e/devnet.spec.ts` | `bun run verify:devnet` | P11, P12 |

Aturan test program: setiap instruksi punya minimal 1 test sukses + 1 test gagal per error relevan (PLAN §11.2); nama test `ix_<instruksi>__<skenario>`; helper bersama di `anchor/programs/<p>/tests/common/mod.rs`.

Alur `bun run verify` (urut, gagal cepat):
1. `bun run lint` (Biome) · `bun run typecheck` (turbo)
2. `bun run test:program`
3. `docker compose up -d --wait` → migrasi `app_test`
4. `bun run test:ts`
5. `bun run build`
6. `scripts/dev.ts --ci` (Surfpool + deploy + bootstrap + worker + web + MCP, health check) → `bun run seed` → `bun run e2e` → shutdown bersih (juga saat gagal)

`bun run verify:devnet` (terpisah, butuh jaringan & SOL): cek saldo admin → cek program devnet ter-deploy & cocok dengan `anchor/keys` → simulasi tx setiap alur (poin 8) → Playwright smoke devnet.

## Dampak ke implementasi
- P1: script root `test:program`, `test:ts`, `e2e`, `e2e:visual`, `verify`, `verify:devnet` (stub dulu); `.gitignore` tambah `e2e/.artifacts`, `test-ledger`, `.surfpool`.
- P2: `docs/specs/S04-math.md` + test vector JSON dibuat bersama kontrak.
- Port test terpisah dari dev: Surfpool test 18899/18900, DB `app_test` → test boleh jalan saat `bun run dev` hidup.
- Semua test yang butuh validator/DB menyalakan dan mematikan sendiri dependensinya (tidak mengandalkan proses yang sudah jalan).
