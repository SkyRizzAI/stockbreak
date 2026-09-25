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
- 2026-09-25: Integrasi PreStocks (D037) — worker: API PreStocks sumber utama harga pre-IPO (fallback Jupiter → random walk); `/api/prestocks` (cache 60 detik); tag PreStocks + panel mark/premium/implied valuation + catatan migrasi IPO ala SpaceX di web; `list_assets` MCP diperkaya; DEMO diperbarui. Gate: lint, typecheck, test:ts hijau.
- 2026-09-25: landing page baru di `/` (refs/Stockbreak.html Landing 1+2: hero, market strip, problem, how it works, index = token, mandate, pre-IPO, creators, AI agents, social, who it's for, comparison, why Solana, trust, tests, try it, FAQ, CTA, footer); Markets pindah ke `/home` via route group `(app)`/`(landing)` (D049). Brand top bar + tab Home mobile → `/home`, "Launch app" → `/home`. Animasi: judul hero per kata, chart hero digambar + titik live, harga hero ber-tick (simulasi), parallax kartu hero mengikuti pointer, count-up angka, tab How it works auto-play dengan progress bar, garis alir diagram vault, simulasi transaksi atomik commit/revert, timeline IPO, chat agent bertahap + typing, filter Human vs AI dengan pill geser, accordion FAQ halus, scroll-spy nav + progress bar, reveal on scroll; semua hormat `prefers-reduced-motion`. e2e yang membuka `/` untuk Markets/dev wallet diarahkan ke `/home`; `pages.spec`/`visual.spec` + entri `landing`. Gate: biome & `check-types` web hijau, `next build` hijau; dicek manual 1440/1280/375 px, dark & light (tanpa overflow horizontal di 375). e2e belum dijalankan.
- 2026-09-25: deploy Cloudflare (D050) — `apps/web` via OpenNext (`wrangler.jsonc`, `open-next.config.ts`, `cf:build`/`cf:deploy`), `apps/worker/src/cf.ts` (Cron Trigger) + `wrangler.jsonc`; `@repo/db` klien per request di Workers (Hyperdrive), `devnet.json` di-bundle, `KEEPER_KEYPAIR_JSON`, MCP → web via service binding. Gate: typecheck config/db/sdk/worker/mcp, biome, OpenNext build (3,7 MiB gzip) + wrangler dry-run worker; `wrangler dev` lokal: halaman/API/OG/Blink/MCP 200, satu window cron (price + indexer) OK. Panduan: docs/DEPLOY.md Opsi C.
- 2026-09-26: QA putaran 3 (POV user, fitur AI + UX): `bun run verify` localnet penuh (104 e2e) + rerun spec yang diperbaiki; `verify:devnet` 10/10; spec agent di devnet 11/11 termasuk satu run Autopilot dengan LLM sungguhan. Spec baru `e2e/tests/agent-lifecycle.spec.ts` (agent hosted: fund SOL/USDC → create → join → propose/cancel → claim fees → redeem 50%/100% lewat remote MCP; validasi Autopilot; Run now; UI halaman AI; run LLM opsional `E2E_AUTOPILOT_LLM=1`). Perbaikan: chip index Autopilot (mematikan satu index dari "semua" malah menyisakan satu), Autopilot tidak bisa dinyalakan tanpa index, langkah "Next" per agent, copy mode 3/"Run it on its own" menunjuk Autopilot (CLI jadi opsi developer), penjelasan API key hanya untuk client yang bisa kirim header (Claude.ai/ChatGPT tidak bisa) + snippet mcp.json, agent milik sendiri tampil duluan di picker manager, header index clone menampilkan "clone of X", tab index tersimpan di URL (`?tab=discussion`), posisi dari vault kosong (redeem penuh, indexer belum sinkron) tidak tampil sebagai -100%, nama agent tampil di feed (bukan alamat), label interval "30 min", direktori agent urut AUM + agent tanpa index disembunyikan, ringkasan run Autopilot plain text (`plainSummary`). Test diperbaiki: `agent-keys.test.ts` (tidak bergantung env), OG image dibaca dari meta `og:image` (route group menambah hash), social membuka tab Discussion.
- 2026-09-26: Cloudflare live (D050) — Workers Builds dari `SkyRizzAI/stockbreak` `main`: `stockbreak` (https://stockbreak.fun) + `stockbreak-worker` (cron `* * * * *`), Neon via Hyperdrive, data devnet disalin (`db:remote -- copy`). `check:public` 10/11: FAIL hanya OG `/i/<index>/opengraph-image` 404 (sejak route group `(app)`, Next 16 memberi hash pada route OG; `og:image` halaman tetap benar, ikon Blink & metadata token memakai path lama). Fix: `apps/web/app/i/[pubkey]/opengraph-image/route.ts` (path tetap, memanggil generator OG yang sama); diuji `wrangler dev` lokal: path lama + ber-hash 200 PNG 1200×630.
- 2026-09-26: rekaman video teknis: `demo.spec.ts` diperluas menjadi 16 adegan 1920×1080. Isinya landing, markets/search, onboarding, create, share+Blink, join, redeem, clone+follow, konsol AI (agent, fund, API key), manage (bobot, agent sebagai manager, pause), Autopilot dengan LLM sungguhan, MCP→`/sign`, keeper, IPO, social, dan fee kreator. Semua 16/16 lulus di localnet. Ekspor H.264 ada di `e2e/demo/mp4/` dan video gabungan di `e2e/demo/stockbreak-technical-demo.mp4` (±4:38; waktu tunggu Autopilot/keeper dipercepat 6×). UX ikut diperbaiki: status "Queued" setelah Run now, "next in 29 min" (sebelumnya "next 0s"), petunjuk agent menyesuaikan status Autopilot, ringkasan run tanpa label "Cycle summary", TVL "—" untuk index yang belum punya snapshot, dan posisi index baru tetap tampil di portfolio.

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
- 2026-09-25: deploy publik devnet disiapkan (D038, `docs/DEPLOY.md`): Opsi A Vercel + Neon + worker lokal, Opsi B Cloudflare quick tunnel. Kode: file tracing Next (deployments json ikut ke fungsi), `connectionOptions` postgres.js (Neon: TLS, buang `channel_binding`, pooler tanpa prepared statement, pool kecil di Vercel), `ADMIN_KEYPAIR_JSON` opsional + faucet SOL mati dengan pesan jelas, script `db:remote`, `vercel:env`, `check:public`, `worker:devnet`, `start:devnet`. Gate:
  - typecheck hijau; lint hijau;
  - test db 4/4 (baru), config 3, worker 7;
  - build web dengan env ala Vercel (tanpa `.env`, standalone) → `check:public` PASS 10/10 pada server standalone;
  - `db:remote copy` diuji ke DB lokal kosong (13 index, 1495 harga tersalin, `--force` idempoten);
  - `worker:devnet` dengan DB non-docker: indexer + MCP hidup;
  - `verify:devnet` PASS 10/10 (4,6 menit).

  MCP test 7/10 bila hanya chain lokal (`--chain-only`) tanpa worker: `AccountNotInitialized` pada agent_create_index. Butuh stack penuh `bun run verify`; tidak disentuh fase ini.
- 2026-09-25: persiapan submission (A17).
  - Riset hackathon, kompetitor, dan pasar di `docs/analysis/A17-riset-hackathon.md`.
  - Integrasi PreStocks (D037): harga dari API PreStocks, tag/panel UI, MCP.
  - Persiapan live demo publik (D038, `docs/DEPLOY.md`): Vercel + Neon + worker lokal, atau Cloudflare tunnel; `check:public`.
  - README versi juri + screenshot `docs/media/`.
  - Paket submission & naskah video di `docs/SUBMISSION.md`.
  - Halaman Agents menjelaskan MCP berjalan lokal.
  - `bun run verify` ALL GREEN (89 e2e, MCP 10, SDK 59, worker 7, db 4, config 3, program 38).
- 2026-09-25: QA putaran 2 (A18, D039).
  - Dua audit menghasilkan 39 temuan. Run e2e penuh menemukan 2 cacat lagi:
    - `chainClock` jatuh ke jam komputer di browser;
    - join/redeem langsung gagal tepat setelah warp.
  - Yang terpenting sudah diperbaiki:
    - harga live dibatasi 5%/tick;
    - IPO kontinu, bisa diulang, dan aman terhadap race follow;
    - tombol **Rebalance now** di Manage;
    - fase-out ke 0% tanpa debu;
    - validasi MCP (aset yang sudah IPO, benchmark, minimum, alamat, propose update);
    - klaim fee saat terakru;
    - leaderboard fee;
    - DB devnet bersama + `verify:devnet` menolak DB publik;
    - TLS/pooler Postgres, `metadataBase` Vercel, faucet tanpa kunci admin;
    - mobile Allocation, "-0%", screenshot tema terang.
  - Tes baru `scenarios-chain.spec.ts` (4).
  - `bun run verify` ALL GREEN: program 38, SDK 59, MCP 10, worker 7, db 5, config 3, **93 e2e**.
- 2026-09-25: susulan A18:
  - `simulate_rebalance` memakai aturan keeper; `agent_rebalance` hanya untuk index milik atau yang dikelola agent;
  - panel PreStocks: penanda basi + Retry;
  - `list_assets` timeout 1,5 s;
  - `ADMIN_KEYPAIR_JSON` divalidasi lazy;
  - peringatan Follow + Hold di wizard;
  - `.env.example` lengkap;
  - retry RPC untuk error jaringan sesaat;
  - wizard "Finish deposit with swapped assets".

  `verify:devnet` PASS 10/10. `bun run verify` ALL GREEN (93 e2e).
- 2026-09-25: `bun run demo:record` (klip video pitch otomatis, `e2e/tests/demo.spec.ts`, 8 adegan).
  - Merekam demo menemukan dua cacat, keduanya sudah diperbaiki:
    - setoran pertama gagal (`InitialWeightMismatch`) bila harga bergerak antara swap dan join → `fitInitialAmounts` di zapIn, `joinWithHeld`, dan server;
    - `joinWithHeld` menolak index kosong.
  - `bun run verify` ALL GREEN (93 e2e); demo 8/8.
- 2026-09-25: rename produk → **Stockbreak** (D040). UI via `APP_NAME`, MCP `stockbreak`, dokumen submission; identifier internal & URL repo/hackathon tetap.
- 2026-09-25: logo token resmi (D041): `/api/token-logos` (Jupiter, cache 24 jam, fallback glyph), `TickerMono` sadar-logo, `AssetStack` di tabel index, logo di ticker Home, chip kartu, dan panel PreStocks.
- 2026-09-25: dari tes manual devnet user:
  - composer mengunci tombol Post selama jeda anti-spam ("Wait Ns") alih-alih membiarkan 429 berulang;
  - detail index: 7 bacaan chain/DB diparalelkan + cache 4 s per index. Devnet: panggilan pertama ~2,3 s (sebelumnya 1,7–6,6 s), panggilan berulang ~6 ms.
- 2026-09-25: overlay progres transaksi (D042) untuk semua alur (join/redeem/create/retry/recovery/`/sign`/dev wallet/aksi tunggal); helper e2e mendeteksi error dari overlay. Verifikasi e2e penuh menunggu stack devnet user dimatikan.
- 2026-09-25: menu **Agents** (`/agents`, setup MCP + daftar agent) ditambahkan ke nav desktop; di mobile lewat link "Connect an agent" di Home (bagian Human vs AI). Biome + tsc lolos.
- 2026-09-25: Manage → Managers menampilkan agent terdaftar sebagai saran sekali klik. Biome + tsc lolos.
- 2026-09-25: `/agents` diberi tab **Connect** / **Register an agent**. Register: wallet yang terhubung menandatangani pesan (nonce `agent-register`) → `POST /api/agents` → `registerAgent` (setara tool MCP `agent_register`, tanpa transaksi). Diuji: tanda tangan palsu 401, sah 200, replay nonce 401; baris uji dihapus dari `app_devnet`. Biome + tsc lolos.
- 2026-09-25: perbaikan `glass-bar`/`glass-panel`: `backdrop-filter` ternyata tidak pernah aktif di Chrome (Lightning CSS hanya menyisakan deklarasi terakhir, `-webkit-backdrop-filter`); urutan ditukar sehingga standar tersisa. Top bar + nav bawah mobile: opasitas 0,62, blur 24px + saturate 160%.
- 2026-09-25: agent menjelaskan keputusan (D044): tool MCP `agent_post` + `get_feed`, guide diperbarui, runner otonom `bun run agent:loop` (`--once`, `--dry-run`, `--index`, `--interval`, `--register`), env di `.env.example`, bagian "Agent otonom" di DEMO. Perbaikan saldo USDC `agent_info` (NaN). Gate: tsc `apps/mcp` + `scripts` lolos, biome lolos, `bun test test/social.test.ts` lolos, dry-run `agent:loop -- --once --dry-run` terhadap stack devnet berjalan (baca ATLS → tidak ada aksi) dan jalur error (MCP tak terjangkau, tanpa tool agent) keluar kode 1 dengan penjelasan. `mcp.test.ts` (termasuk uji `agent_post`) belum dijalankan: butuh stack localnet (`bun run e2e`).
- 2026-09-25: MCP remote (D043): `https://<web>/api/mcp` (stateless, CORS, rate limit 60/menit/IP) + `/api/mcp/health`; publik hanya tool riset/simulasi/`build_*`, `agent_*` hanya dengan Bearer `MCP_AGENT_TOKEN` + keypair (`AGENT_KEYPAIR_JSON`/path). `apps/mcp` mode publik standalone (`MCP_PUBLIC=1`, `MCP_HOST`, `MCP_ALLOWED_HOSTS`, `PORT`); env baru di `packages/config`, `.env.example`, `turbo.json`, `vercel:env --with-agent`; `check:public` cek #11. Test: `apps/mcp/test/public.test.ts` (6 lolos), `e2e/tests/mcp-remote.spec.ts` (3 lolos + 1 skip tanpa token, terhadap web dev yang sedang jalan). Biome, typecheck, `next build` lolos. Tes agent di `mcp.test.ts` gagal hanya karena stack yang jalan adalah devnet sedangkan `.env` localnet (RPC 8899 mati), bukan karena perubahan ini.
- 2026-09-25: fix search di navbar (crash "reading subscribe"): `CommandDialog` shadcn baru tidak membungkus isi dengan root cmdk; command palette sekarang membungkus dengan `<Command shouldFilter={false}>` (filter di server). Diuji: ⌘K → ketik → Enter membuka index.
- 2026-09-25: feed menampilkan token index: post tertaut index (tanpa kartu) memakai `IndexStrip` (logo + simbol + bobot + bar alokasi), baris aktivitas menampilkan tumpukan logo token (`IndexRef.assets`, opsional, dari `indexes.assets`). Biome + tsc lolos; dicek 1280px & 375px (dark).
- 2026-09-25: navbar dirampingkan: tombol search `w-44`; Portfolio dihapus dari nav desktop (tetap di menu wallet dan tab bar mobile); badge cluster (Devnet/Localnet) pindah dari top bar ke footer. Switch cluster dibatalkan. Biome + tsc lolos.
- 2026-09-25: lebar container semua halaman disamakan dengan navbar (`max-w-[1280px]` + `px-4 md:px-8`): Feed (sebelumnya 720px), Faucet, Sign, Manage, layar sukses Create (sebelumnya 640px).
- 2026-09-25: kartu Top 3 Leaderboard: + sparkline 30d, komposisi token (`TokenWeights`, dipakai bersama `IndexStrip` feed), AUM & holders. Biome + tsc lolos.
- 2026-09-25: menu nav "Agents" → "AI" (halaman berisi koneksi MCP dan registrasi agent); judul halaman "AI"; link Home "Connect AI". Route tetap `/agents`.
- 2026-09-25:
  - halaman Agents didesain ulang: direktori kartu agent, "Latest from agents", panel sticky Connect/Register/Run; penjelasan dipindah ke modal "How agents work";
  - `bun run agent:token` membuat token operator untuk tool `agent_*` di remote MCP, menulis `MCP_AGENT_TOKEN`/`AGENT_MCP_TOKEN` ke `.env`, dan menampilkannya sekali; langkahnya ada di halaman Agents dan DEPLOY.
- 2026-09-25: halaman detail index dirombak (~4.900px → ~3.300px): section tetap untuk konten keputusan (header, chart, Allocation, PreStocks, Thesis, Strategy & guards | Fees + Timeline); daftar panjang pindah ke tabs (Activity default, Holders jadi tabel + bar porsi, Clones, Discussion). Managers masuk baris KV Strategy. `PostThread.title` opsional, `PostCard.hideIndex`. Biome + tsc lolos; Timeline & panel PreStocks tetap terlihat saat load (dod 8, demo 06), Activity tab default (demo 05).
- 2026-09-25: contract: D045 agent milik user + API key — tabel `agent_wallets`, `api_keys` (migrasi drizzle 0003, diterapkan ke app/app_test/app_devnet lokal); env `AGENT_KEY_SECRET`; route `/api/me/agents`, `/api/me/agents/[wallet]/keys`, `/api/me/agents/[wallet]/fund`, `/api/me/keys/[id]`; remote MCP menerima `Bearer sbk_…` dan bertindak sebagai agent itu (`createServer({ agent })`), 401 untuk key tidak valid/dicabut, rate limit per key. Faucet SOL dipindah ke `lib/server/faucet.ts` (dipakai ulang). Gate: lint, typecheck, `next build` hijau; test db (enkripsi, key, DB app_test) + MCP public (sbk_ 401/503, signer eksplisit) hijau; e2e baru `agent-keys.spec.ts` (dijalankan di `bun run verify`). Stack yang sedang jalan perlu restart agar membaca `AGENT_KEY_SECRET`.

- 2026-09-25: detail index: Timeline pindah dari bawah Fees ke tab (Activity · Holders · Clones · Timeline · Discussion); grid kembali Strategy | Fees. e2e dod 8 membuka tab Timeline sebelum mengecek teks IPO.
- 2026-09-25: contract: D046 tool MCP agent simetris — `agent_redeem`, `agent_claim_fees`, `agent_apply_update`, `agent_cancel_update`, `agent_get_test_usdc` (aditif, program tidak berubah); `POST /api/me/agents/[wallet]/fund` menerima `{asset: "SOL"|"USDC", amount}` (USDC: agent menandatangani faucet mock market, default 1.000, maks 10.000/hari/agent). Gate: `bun run typecheck` lolos; biome bersih untuk file yang diubah; `apps/mcp` bun test: unit & public lolos, test integrasi agent butuh stack localnet (gagal karena stack yang jalan devnet).
- 2026-09-25: contract: D048 mode asisten mengelola index lewat MCP — tool `build_propose_update`, `build_apply_update`, `build_cancel_update`, `build_set_paused`, `build_set_managers`, `build_claim_fees` + jenis intent `propose_update`/`apply_update`/`cancel_update`/`set_paused`/`set_managers`/`claim_fees` (aditif; program & DB tidak berubah). Server `/api/intents/[id]/tx` memeriksa signer on-chain (403) sebelum membangun transaksi; `/sign` menampilkan ringkasan per jenis. Gate: lint & typecheck untuk file yang diubah bersih, `apps/mcp` bun test `manage.test.ts` hijau (validasi tanpa stack), `next build` hijau, smoke tool terhadap stack devnet (pesan 403/ETA/royalti benar). e2e baru `e2e/tests/mcp-manage.spec.ts` (belum dijalankan; MCP :3333 perlu restart agar tool baru terdaftar).
- 2026-09-25: contract: D047 Autopilot terhosting — tabel `agent_autopilot`, `agent_runs`, `worker_status` (migrasi drizzle 0004, diterapkan ke app/app_test/app_devnet lokal); modul siklus `@repo/mcp/autopilot` (allowlist tool, scope index, strategi owner, dry-run, LLM injectable; `agent:loop` memakainya); loop worker `autopilot` (klaim `SKIP LOCKED`, timeout 120 s, jeda 429, heartbeat); route `GET/PUT /api/me/agents/[wallet]/autopilot`, `POST …/autopilot/run`; env `AUTOPILOT_*` + `AGENT_LLM_*` di skema worker. Gate: `bun run typecheck` 7/7 hijau; biome bersih untuk semua file yang diubah (`bun run lint` masih gagal hanya di `apps/web/components/landing/**` milik pekerjaan lain); test baru hijau (db `autopilot.test.ts` 7 terhadap app_test, mcp `autopilot.test.ts` 8 dengan LLM palsu + server MCP palsu in-memory, worker `autopilot.test.ts` 2); `test:ts`: gagal hanya 5 test integrasi agent di `mcp.test.ts` (butuh stack localnet, yang berjalan devnet); `next build` hijau. Dry-run: jalur worker penuh (klaim → dekripsi → MCP in-process → catat run) pada fixture app_test → `noop`; siklus LLM dry-run untuk agent operator devnet (ATLS, OpenRouter) → 2 aksi tercatat "Dry run (not executed)", tanpa transaksi. Stack yang sedang jalan perlu restart agar worker memuat loop autopilot.
