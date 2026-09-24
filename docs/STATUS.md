# STATUS

Legenda: `[ ]` belum · `[~]` berjalan · `[x]` selesai · `BLOCKED(eksternal): alasan`.

## Lingkungan (dicek 2026-09-24)
| Item | Nilai |
|---|---|
| OS | macOS 26.4.1 arm64 |
| Solana CLI (Agave) | 4.2.2 · platform-tools v1.54 |
| Anchor / AVM | 1.2.0 |
| Surfpool | 1.6.0 |
| Rust | 1.98.1 |
| Bun / Node | 1.4.2 / 24.14.1 |
| Docker | OrbStack 29.4, Compose v5.1.2 |
| Keypair project | `.keys/admin.json` 9e1LHfXQpD8DbzbCpoAvrRbnhWA9cKsVJzQ35nCYhECh · `.keys/keeper.json` · `.keys/agent.json` |
| Config CLI project | `.keys/solana-cli.yml` |
| Saldo SOL devnet admin | 15 SOL (2026-09-24, tx 2cdH7dtt…NKpvB finalized) |

## Fase
- [x] P0 — Persiapan (A01, A12, VERSIONS, STATUS, DECISIONS)
- [x] P1 — Scaffold monorepo (A02)
- [x] P2 — Kontrak & codegen (A03, A04, A05, A14 desain) — kontrak beku 2026-09-24
- [x] P3 — `mock_market`
- [x] P4 — `index_vault` inti
- [x] P5 — Rebalance, IPO, Follow (A14 verifikasi)
- [x] P6 — SDK (A06, A07)
- [x] P7 — DB & worker
- [x] P8 — Web (A08, A09, A11)
- [x] P9 — MCP (A10)
- [x] P10 — E2E, review visual, dokumentasi
- [x] P11 — Devnet (A13) + `dev:devnet` + faucet SOL devnet
- [x] P12 — Verifikasi akhir

## Definition of Done (PLAN §11)
### 11.1 Skenario otomatis (localnet)
- [x] 1 setup + dev tanpa langkah manual
- [x] 2 User A create index (3 saham + 1 pre-IPO, Threshold 5%, keeper, fee 5%) + zap ≥ $100k
- [x] 3 User B join $1,000 via zap; posisi, NAV, chart tampil
- [x] 4 User C clone (bobot diubah, setor ≥ $100k); index D follow A
- [x] 5 Manager agent: MCP get_leaderboard → simulate_rebalance → agent_rebalance; pelanggaran mandate ditolak dengan pesan manusiawi
- [x] 6 price +30%/+40% (D026) → keeper rebalance otomatis → activity
- [x] 7 A propose → apply → D tersinkron
- [x] 8 IPO → A, C, D bermigrasi → timeline & badge ipo_survivor
- [x] 9 warp 30 hari → claim Creator/Parent/Platform
- [x] 10 B redeem zap out → USDC bertambah → posisi hilang
- [x] 11 Leaderboard, profil, XP, badge konsisten
- [x] 12 Blink tx valid; OG image ter-render
### 11.2 Kualitas
- [x] `bun run verify` hijau
- [x] Tiap instruksi: test sukses + gagal per error relevan (38 test LiteSVM)
- [x] Tidak ada TODO/NotImplemented di jalur utama
- [x] Review visual §8.8 selesai
- [x] README ≤ 5 perintah
- [x] STATUS semua centang
### 11.4 Siap uji manual user (Phantom, devnet)
- [x] Program ter-deploy di devnet; `deployments/devnet.json` ada (commit oleh user)
- [x] `bun run dev:devnet` menyalakan worker + web + MCP lokal menunjuk devnet
- [x] Faucet SOL (dari admin) & USDC berfungsi di devnet
- [x] Transaksi tiap alur lolos simulasi RPC devnet (v0 + ALT)
- [x] `docs/DEMO.md` panduan uji manual Phantom lengkap untuk alur §1.2 no. 1–12

## Log
- 2026-09-24: toolchain dicek & diperbarui; keypair + config CLI lokal dibuat; keputusan D001–D009.
- 2026-09-24: P0 selesai — A01, A12, VERSIONS; riset R1–R4 + snippet teruji di `docs/analysis/research/`; D010–D018.
- 2026-09-24: admin didanai 15 SOL devnet oleh user (tx 2cdH7dttqhw9fMWZM3juciyJX4F3EpvgMJL16TY3WfPJgY7i9uXvbMGFup6cbRPqD59TP8wptrhcQaGTdbNKpvB).
- 2026-09-24: P1 selesai — gate hijau: setup, lint, typecheck, build, anchor build + cargo test. D021–D022.
- 2026-09-24: P2 selesai — contract: kontrak beku (PLAN §5.5, D023–D025); codegen, typecheck, lint, migrasi hijau.
- 2026-09-24: P3 selesai — 12 test mock_market hijau; dev --chain-only (Surfpool + deploy + bootstrap 13 mint) & price hijau.
- 2026-09-24: P4 selesai — 15 test core index_vault hijau.
- 2026-09-24: P5 selesai — 9 test advanced hijau; total 38 test program; A14 terverifikasi.
- 2026-09-24: P6 selesai — SDK lengkap; bun test sdk 56 test hijau (paritas math, errors, 9 flow e2e di Surfpool). D026.
- 2026-09-24: P7 selesai — worker 8 loop, seed 7 index, gate-worker PASS (keeper +30%, IPO 4 holder), warp OK. D027.
- 2026-09-24: P8 selesai — web 11 halaman + API + Blink + OG; e2e Playwright 49 test hijau (pages, flows dev wallet, blinks); next build hijau. Fix: bobot wizard, overflow grid, hydration wizard, price tick feed IPO.
- 2026-09-24: P9 selesai — MCP 18 tool + docs://guide, stdio & HTTP; 10 test MCP + 2 e2e MCP→/sign hijau. Fix: harness SDK kini mematikan validator test; update parsial agent (Zod 4 default). D028–D029.
- 2026-09-24: P10 berjalan — e2e `dod.spec.ts` (§11.1 no. 2–11) semua langkah pernah hijau; `e2e.ts`, `verify.ts`, `claim-platform.ts`; README, ARCHITECTURE, DEMO (localnet + Phantom devnet + agent); A15 putaran 1 (13 temuan diperbaiki). Fix penting: jam program dibaca dari sysvar Clock (`chainClock`) — keeper/warp/MCP sebelumnya memakai block time yang tertinggal setelah warp; zap memeriksa kesegaran oracle sebelum mengirim (`assertFreshPrices`); bootstrap tidak lagi membawa IPO dari chain lama; hydration wallet.
- 2026-09-24: P11 berjalan — `mock_market` ter-deploy di devnet (9WK7…qX8); upload `index_vault` pertama gagal (rate limit RPC), buffer ditutup (SOL kembali), deploy dibuat resumable (buffer persisten + retry). D030–D032.
- 2026-09-24: P11 selesai — devnet: index_vault 4XaB…c6me + mock_market 9WK7…qX8, bootstrap, seed ringan (MAG4, MEGA, ATLS); `verify:devnet` PASS 10/10. Fix: retry 429, konfirmasi tanpa websocket, margin CU, oracle-freshness sebelum zap. Saldo admin devnet ±1,25 SOL (lihat P11 & DEMO).
- 2026-09-24: P12 selesai — `bun run verify` ALL GREEN pada localnet bersih: lint, typecheck, 38 test program, test TS (SDK 56, MCP 10), build, e2e 63 test (termasuk DoD §11.1 no. 2–11 dalam satu run). `verify:devnet` PASS 10/10. A15 putaran 2 tanpa temuan baru. Fix terakhir: swap zap mengulang dengan harga segar bila oracle sesaat stale (`retryOnStale`), konfirmasi transaksi tanpa websocket.

## Ringkasan akhir (2026-09-24)
**Yang jadi**: dua program Anchor (`index_vault`, `mock_market`) + 38 test LiteSVM; SDK kit/Codama (zap, rebalance sandwich, ALT, IPO, humanisasi error, paritas math); worker (harga live Jupiter/Finnhub → oracle, indexer, snapshot, keeper, fee, follow, gamifikasi); web Next.js (explore, index, create/clone/follow wizard, manage, portfolio, leaderboard, profil, faucet, agents, sign, Blink, OG); MCP server (18 tool, stdio + HTTP); e2e Playwright (DoD §11.1 otomatis); deploy devnet.

**Cara menjalankan**: `bun install && bun run setup && bun run dev` lalu `bun run seed` (localnet, Dev Wallet). Devnet + Phantom: `bun run dev:devnet`, ikuti `docs/DEMO.md` bagian B. Verifikasi: `bun run verify`, `bun run verify:devnet`.

**Keterbatasan**:
- Semua aset/harga simulasi.
- `warp` hanya di localnet (Surfpool), sehingga akrual fee di devnet kecil.
- Blink di X/dial.to butuh URL publik.
- RPC devnet Helius gratis rate-limited; sudah ditangani dengan retry + interval hemat.
- Key RPC ikut dalam bundle web lokal (D031).
- **Saldo admin devnet ±1,25 SOL**: faucet SOL in-app terbatas; isi ulang admin atau pakai faucet.solana.com untuk Phantom.
- `deployments/devnet.json` & perubahan kode belum di-commit (git dikelola user).
- 2026-09-24: contract: feed sosial (D033) — tabel `auth_sessions`, `posts`, `post_likes`, `post_comments` (migrasi drizzle 0001, diterapkan ke app/app_test/app_devnet; `bun run dev` kini menjalankan migrasi otomatis). Halaman `/feed` (Following/All), Discussion di halaman index, Posts di profil, like, komentar, hapus. Anti-spam: sesi sign-in 24 jam (cookie httpOnly, cek Origin), wajib aktivitas on-chain, batas laju & jeda, batas panjang/link, deteksi duplikat & karakter berulang. Seed menambah konten sosial demo (`seed -- --social-only`). e2e `social.spec.ts` 4/4, pages + feed hijau.
- 2026-09-24: fix wizard (laporan user): slider Base UI mengirim angka tunggal pada input mouse sehingga bobot jatuh ke 0 dan macet; slider strategi/fee diam-diam kembali ke default. Kini `sliderValue` menerima angka/array untuk 8 slider; mengubah bobot meredistribusi aset tak terkunci agar total tetap 100% (kunci dihormati); input bobot/target (wizard & Manage) memakai `DecimalInput` (bisa mengetik "12." / kosong). Test regresi `e2e/tests/wizard.spec.ts`; `bun run verify` ALL GREEN (72 e2e).
- 2026-09-24: redesign UI mengikuti `refs/Stocklana.html` (D034): token hijau (dark default + light), Manrope/IBM Plex Mono, mint hanya untuk aksi utama/logo/return positif, glass di top bar + panel Join/Redeem, index mark 4 hijau, strip ticker bersambung, segmented control, underline tabs, tabel hairline, kartu Top 3 & chart ala referensi, OG image hijau.
- 2026-09-24: contract: kartu index untuk feed (D035) — kolom `posts.card_variant` (migrasi 0002), `/api/benchmark`, komponen `IndexCard` dengan 3 gaya (Mark/Tokens/Chart) berisi koleksi token, return 30d, TVL, drawdown vs SPYx; menu Share → "Post to feed as a card" dengan pemilih gaya + preview; kartu Top creators di Home; seed menampilkan ketiga gaya. Gaya gradien/ilustrasi 3D dari contoh client sengaja tidak ditiru (§8.2, D034). e2e social 6/6.
- 2026-09-24: QA skenario A16 (D036), berdasarkan permintaan user "buat banyak scenario ... biar tahu kecacatan flow".
  - Tiga audit alur menghasilkan 70 temuan, dan probe API 58 kasus tepi menemukan 11 jawaban salah. Hampir semuanya diperbaiki (lihat `docs/analysis/A16-qa-scenarios.md`).
  - Yang terpenting:
    - pemulihan join/redeem parsial (Finish join / Swap to USDC / Loose assets);
    - create+deposit tidak lagi membuat index ganda;
    - setoran pertama minimal $1,10;
    - pengecekan paused/rebalance sebelum swap;
    - error mock_market tidak lagi salah label;
    - ALT index besar tersimpan;
    - /sign bisa dilanjutkan dengan progres di server dan status yang tidak bisa dipalsukan;
    - state Blink ditandatangani;
    - indexer tidak kehilangan tx atau menggandakan cost basis;
    - pagination feed keyset;
    - sesi sosial berakhir saat disconnect;
    - validasi Manage (fee/slippage, replace pending, banner perubahan terjadwal).
  - `contract:` MCP `get_intent_status` menambah `result.index` (aditif); `/api/feed` & `/api/posts` memakai `cursor`. Skema DB dan program tidak berubah.
  - Tes baru: `e2e/tests/scenarios-api.spec.ts` (8), `e2e/tests/scenarios-ui.spec.ts` (7), `apps/worker/test/positions.test.ts`, +3 test error SDK (SDK 59 hijau).
  - Belum: C8 (butuh perubahan program).
- 2026-09-24: QA A16 selesai. Putaran eksekusi e2e menemukan 5 cacat UX tambahan (E1–E5), semuanya diperbaiki:
  - feed All dibanjiri event otomatis → event dibatasi per halaman + dilipat;
  - label "Keeper" keliru;
  - Blink 500 untuk alamat bukan index;
  - Retry yang tak berguna;
  - Following kosong tanpa jalan ke All.

  `bun run verify` ALL GREEN: 38 test program, SDK 59, MCP 10, worker 7, **89 e2e**.
