# DECISIONS

Format: tanggal · konteks · opsi · pilihan · alasan.

## D001 — 2026-09-24 — Lokasi dokumen
- Konteks: `CLAUDE.md` merujuk `PLAN.md` di root, tetapi file ada di `docs/plan.md`.
- Opsi: pindah ke root / tetap di `docs/`.
- Pilihan: semua dokumen di `docs/` (`docs/PLAN.md`). Root hanya `CLAUDE.md` (wajib dibaca Claude Code dari root) dan `README.md`.
- Alasan: permintaan user; root tetap bersih.

## D002 — 2026-09-24 — Keypair & config Solana CLI lokal project
- Konteks: config global Solana user menunjuk devnet + keypair project lain (`idimon`).
- Pilihan: keypair project di `.keys/` (admin, keeper, agent; di-gitignore) + config CLI lokal `.keys/solana-cli.yml` (RPC localhost, keypair admin, commitment confirmed). Semua perintah memakai `-C .keys/solana-cli.yml` atau `-u`/`-k` eksplisit. Config global tidak pernah diubah.
- Pubkey: admin `9e1LHfXQpD8DbzbCpoAvrRbnhWA9cKsVJzQ35nCYhECh`, keeper `6FhZsUu9gjVjriEW6EgeQvCcnQtjpKgdA2CJ3HJquw2Z`, agent `CB7HjcsHajTn4SQgRh2uUskTDXduMbyqz7L6LgfQiTLG`.
- Alasan: permintaan user; mencegah transaksi tak sengaja ke jaringan/wallet lain.

## D003 — 2026-09-24 — Port Postgres 5434
- Konteks: 5432 dan 5433 dipakai container project lain milik user.
- Pilihan: host port 5434 → container 5432.
- Alasan: hindari bentrok ketika project lain berjalan bersamaan.

## D004 — 2026-09-24 — Toolchain
- Pilihan: Agave/Solana CLI 4.2.2 (channel stable Anza; GitHub "Latest" 4.3.0 belum di channel stable), Anchor 1.2.0 (bukan 2.0.0-rc.1), Surfpool 1.6.0, Rust 1.98.1, platform-tools v1.54.
- Alasan: versi stabil terbaru; RC tidak dipakai.

## D005 — 2026-09-24 — Jaringan uji manual
- Konteks: docs Phantom Testnet Mode hanya menyebut Solana Devnet & Testnet; localnet tidak resmi didukung.
- Pilihan: tahap 1 localnet (test otomatis, Dev Wallet); tahap 2 devnet sebagai target uji manual Phantom oleh user di akhir (PLAN §11.4). `bun run dev:devnet` menjalankan worker/web/MCP lokal menunjuk devnet.
- Alasan: keputusan user; Phantom perlu devnet untuk simulasi & saldo.

## D006 — 2026-09-24 — Faucet SOL devnet dari wallet admin
- Konteks: airdrop publik devnet sering rate limit.
- Pilihan: `POST /api/faucet/sol` mentransfer 0.2 SOL dari admin, batas per wallet/24 jam (`faucet_claims`) + cap harian. User mendanai admin sebelum eksekusi.
- Alasan: uji manual tidak boleh terhambat faucet publik.

## D007 — 2026-09-24 — Timelock devnet 120 detik
- Konteks: PLAN awal 3600 detik; uji manual propose → apply akan menunggu 1 jam.
- Pilihan: `timelock_secs` devnet 120, localnet 0.
- Alasan: uji manual praktis; tetap mendemokan timelock.

## D008 — 2026-09-24 — Nama produk
- Pilihan: `NEXT_PUBLIC_APP_NAME=Stocklana` (default).
- Alasan: keputusan user.

## D009 — 2026-09-24 — Cache tool di luar repo diizinkan
- Pilihan: `~/.cargo`, `~/.cache/solana`, `~/.bun/install/cache`, `~/Library/Caches/ms-playwright`, volume OrbStack boleh ditulis.
- Alasan: keputusan user; lokasi standar tool.

## D010 — 2026-09-24 — API key eksternal dari `.env.test`
- Konteks: user menyediakan `.env.test` (di-gitignore) berisi JUPITER_API_KEY, FINNHUB_API_KEY, HELIUS_RPC_URL (mainnet, api-key yang sama berlaku di devnet), FALLBACK_RPC_URL, OPENROUTER_*.
- Verifikasi 2026-09-24: Jupiter Price v3 HTTP 200; Finnhub quote HTTP 200; Helius `getHealth` ok di mainnet & devnet.
- Pilihan: `bun run setup` menyalin nilai relevan ke `.env` (tanpa mencetak nilai). Harga: Jupiter v3 (`stockData.price` lalu `usdPrice`) → Finnhub quote (saham US) → random walk dari harga terakhir/fixture; Pyth Hermes hanya bila `PYTH_API_KEY` diisi (Hermes wajib key sejak 2026-08-26). Devnet RPC = Helius devnet (`DEVNET_RPC_URL`), fallback `https://api.devnet.solana.com`. `MAINNET_READ_RPC_URL` = Helius mainnet (hanya baca). OpenRouter tidak dipakai (LLM di luar app, K7).
- Alasan: gratis, sudah terverifikasi, mengurangi rate limit.

## D011 — 2026-09-24 — Versi transaksi v0
- Konteks: Kit 8 bisa membangun v1 (SIMD-0385), tetapi Phantom/Solflare/Backpack belum bisa menandatangani v1, dan v1 tidak mendukung ALT.
- Pilihan: semua transaksi `version: 0` (+ALT bila perlu).
- Alasan: kompatibilitas wallet untuk uji manual Phantom.

## D012 — 2026-09-24 — Script tidak bergantung pada symlink Solana global
- Konteks: `~/.local/share/solana/install/active_release` sempat berubah kembali ke 3.1.10 oleh proses di luar project (kemungkinan project lain milik user).
- Pilihan: semua script project menaruh `~/.local/share/solana/install/releases/4.2.2/solana-release/bin` di depan PATH (via helper `scripts/lib/toolchain.ts`); `bun run setup` memverifikasi versi. Symlink global tidak diubah oleh script.
- Alasan: project stabil tanpa mengganggu project lain yang mungkin butuh 3.1.10.

## D013 — 2026-09-24 — Validator dev: Surfpool langsung
- Konteks: `anchor localnet` panic tanpa TTY dan meninggalkan Surfpool yatim; runbook Surfpool auto-deploy memakai `~/.config/solana/id.json`.
- Pilihan: `surfpool start --offline --no-deploy --no-tui` + `anchor program deploy --provider.wallet ../.keys/admin.json --program-keypair keys/<prog>-keypair.json`. Fallback: `solana-test-validator` (tanpa time travel; `warp` exit 0 dengan pesan).

## D014 — 2026-09-24 — LiteSVM 0.16 + Rust 1.98.1
- Konteks: template `anchor init` litesvm 0.10 gagal memuat program SBPFv3; rust 1.89 gagal compile LiteSVM 0.16.
- Pilihan: litesvm 0.16.0, solana-message 4.2.4, solana-transaction 4.1.5, solana-signer 3.0.1, solana-keypair 3.1.2; `anchor/rust-toolchain.toml` = 1.98.1.

## D015 — 2026-09-24 — `drizzle.config.ts` ditulis tangan
- Konteks: drizzle-kit tidak punya command init (pengecualian aturan §0.3).
- Pilihan: tulis `packages/db/drizzle.config.ts` dengan `defineConfig` sesuai docs resmi.

## D016 — 2026-09-24 — TypeScript 5.9.x dipin
- Konteks: npm `latest` = TypeScript 7.0.2 (dipakai create-turbo/bun init/create-playwright), create-next-app menulis `^5`.
- Pilihan: satu versi `typescript@5.9.x` di root; hapus devDependency typescript di paket nested bila bentrok.

## D017 — 2026-09-24 — Playwright generator memakai npm
- Konteks: create-playwright selalu memasang dengan npm.
- Pilihan: jalankan generator, hapus `package-lock.json` & `node_modules` hasilnya, lalu `bun install` dari root.

## D018 — 2026-09-24 — Kesiapan Phantom diverifikasi tidak langsung
- Konteks: Phantom (ekstensi) tidak praktis diotomasi.
- Pilihan: `bun run verify:devnet` → setiap tx alur §1.2 dicek v0, ≤ 1232 byte, `simulateTransaction` devnet sukses; plus Playwright smoke devnet dengan Dev Wallet. Uji manual Phantom dilakukan user di akhir mengikuti `docs/DEMO.md`.

## D019 — 2026-09-24 — Agent tidak mengelola git
- Konteks: user mengelola git sendiri; `user.name` sengaja tidak diset.
- Pilihan: agent tidak menjalankan `git commit`/`push`/`config` (baca saja). Pengganti commit: entri Log di `docs/STATUS.md` per fase. Prosedur Contract change dicatat sebagai entri `contract:` di Log.
- Alasan: keputusan user.

## D020 — 2026-09-24 — Dua program dipertahankan
- Pilihan: `index_vault` dan `mock_market` terpisah (K5).
- Alasan: keputusan user; mock terisolasi, batas CPI ke program market sah bisa dites, bisa diganti adapter nyata. Penghematan biaya bila digabung kecil (~0,5–1 SOL).

## D021 — 2026-09-24 — create-turbo template `basic`
- Konteks: `-e with-biome` gagal ("Could not locate an example") karena API GitHub rate limit (HTTP 403).
- Pilihan: template default (`basic`), lalu hapus apps/docs, apps/web, packages/{ui,eslint-config}, prettier; Biome dipasang via `bunx biome init`.

## D022 — 2026-09-24 — docker-compose.yml ditulis tangan
- Konteks: tidak ada generator resmi untuk compose Postgres (`docker init` untuk Dockerfile aplikasi).
- Pilihan: compose minimal sesuai docs image resmi (PG18 volume `/var/lib/postgresql`, port 5434).

## D023 — 2026-09-24 — Penyempurnaan & pembekuan kontrak (P2)
- Konteks: spesifikasi §5 perlu detail agar bisa diimplementasikan & aman (asal `AssetKind`, parameter oracle mock, bentuk argumen).
- Pilihan: lihat PLAN §5.5. Ringkas: kind aset dari feed market (bukan input kreator), `ConfigParams`, `AssetInput`, share token SPL klasik, `emit!`, crate math bersama, error tambahan, kolom DB tambahan.
- Alasan: mencegah kreator menandai aset pre-IPO sebagai saham (atau sebaliknya), satu sumber math untuk program/SDK, log event cukup kecil untuk tx rebalance.

## D024 — 2026-09-24 — Codama: rename akun `Index` → `IndexAccount`
- Konteks: akun Anchor `Index` menghasilkan `accounts/index.ts` & `pdas/index.ts` yang menimpa barrel `index.ts`.
- Pilihan: visitor `updateAccountsVisitor` di `codama.json` (`index` → `indexAccount`); di TS dipakai `fetchIndexAccount`, `findIndexAccountPda`. Nama akun on-chain tidak berubah.

## D025 — 2026-09-24 — Satu config Codama, dua script
- Pilihan: `codama.json` di root dengan script `vault` & `market`, IDL dipilih via `-i`; output `packages/sdk/src/generated/{index-vault,mock-market}`; `kitImportStrategy: rootOnly`; `@codama/nodes-from-anchor` dipasang eksplisit (CLI menawarkan `yarn add`).

## D026 — 2026-09-24 — Skenario harga +30% (bukan +20%)
- Konteks: dengan pemicu `max_i |w_i − t_i| > 5%` (PLAN §6.3), kenaikan harga satu aset sebesar p menggeser bobotnya Δ = p·w(1−w)/(1+p·w); untuk p = 20% maksimum Δ ≈ 4,5% (w = 50%) → tidak pernah melewati 5%.
- Pilihan: skenario §11.1 no. 6 dan gate P7 memakai `--pct +30` (w = 40% → Δ ≈ 5,8%). Aturan program tidak diubah.
- Tambahan (P10): index A di `e2e/tests/dod.spec.ts` memegang 4 aset × 25% → +30% hanya Δ ≈ 5,2% (garis batas, bisa gagal setelah rebalance agent). Test memakai `+40` (Δ ≈ 6,8%). Rumus yang sama dicatat di DEMO.

## D027 — 2026-09-24 — Database terpisah per cluster
- Konteks: localnet & devnet memakai Postgres lokal yang sama; reset localnet (chain baru) tidak boleh menghapus data devnet dan data tidak boleh tercampur.
- Pilihan: `app` (localnet), `app_devnet` (dev:devnet mengganti `DATABASE_URL`), `app_test` (test). `bun run setup` membuat & memigrasi ketiganya.

## D028 — 2026-09-24 — Tool baca MCP memakai JSON API web
- Konteks: NAV live, return, benchmark, leaderboard, dan portfolio dihitung di `apps/web/lib/server/data.ts` (DB + SDK). Menduplikasi logika itu di `apps/mcp` berisiko angka berbeda dengan UI.
- Pilihan: tool baca MCP memanggil route JSON web (`WEB_URL`). Intent tetap ditulis lewat `packages/db`; tool `agent_*` dan `simulate_rebalance` memakai `packages/sdk` langsung. Web adalah bagian stack `bun run dev`, dan link sign intent memang butuh web.

## D029 — 2026-09-24 — `planPair` diekstrak di SDK; update parsial di MCP
- `packages/sdk/src/rebalance.ts`: perhitungan pasangan swap + prediksi drift diekstrak menjadi `planPair` agar `simulate_rebalance`/`agent_rebalance` bisa menilai swap custom dengan math yang sama dengan program. `planRebalance` memakainya; tes SDK tetap 56/56.
- `agent_propose_update` memakai skema patch tanpa default (Zod 4 tetap menerapkan default di dalam `.optional()`), field kosong mempertahankan nilai on-chain.

## D030 — 2026-09-24 — Deploy devnet dengan panjang program pas (tanpa 2×)
- Konteks: saldo admin devnet 15 SOL; alokasi 2× ukuran program menghabiskan ±11 SOL.
- Pilihan: `solana program deploy` Agave 4.2 (default `max-len` = ukuran program, upgrade auto-extend) lewat `bun run deploy:devnet`; biaya permanen ±5,7 SOL. Deploy idempoten (byte on-chain dibandingkan dengan build lokal). Detail di A13.

## D031 — 2026-09-24 — RPC Helius untuk devnet, juga di klien lokal
- Konteks: RPC publik devnet rate-limited; `dev:devnet` memakai `DEVNET_RPC_URL` (Helius, key dari `.env.test`) untuk worker, MCP, dan `NEXT_PUBLIC_RPC_URL`.
- Konsekuensi: key ikut dalam bundle web yang berjalan di localhost user. Diterima karena app tidak di-host publik; bila web di-host, ganti dengan RPC tanpa key atau proxy server. Dicatat di DEMO.md. Log script menyamarkan key.

## D032 — 2026-09-24 — Klaim fee platform lewat script admin
- Konteks: DoD §11.1 no. 9 mensyaratkan treasury platform bisa klaim; tidak ada UI admin.
- Pilihan: `bun run claim:platform [-- --index X] [--cluster devnet]`: accrue lalu `claim_fees(Platform)` untuk semua index dengan saldo owed.

## D033 — 2026-09-24 — Contract: feed sosial (post, like, komentar) + sesi sign-in + anti-spam
- Konteks: permintaan user/mentor: feed dengan tab Following, aktivitas, post sederhana, like, komentar sederhana, dengan anti-spam.
- Pilihan: tabel baru `auth_sessions`, `posts`, `post_likes`, `post_comments` (PLAN §7.3). Aturan feed & anti-spam di PLAN §7.7.
- Sesi: sign-in sekali per 24 jam (cookie httpOnly) agar like/komentar tidak memunculkan popup wallet setiap klik. Aksi profil/follow tetap memakai tanda tangan per aksi (tidak berubah).
- Tidak ada perubahan program on-chain maupun tool MCP.

## D034 — 2026-09-24 — Desain visual mengikuti refs/Stocklana.html ("quiet green desk")
- Konteks: user meminta UI disesuaikan dengan `refs/Stocklana.html`: modern, minimalis, hijau, sedikit glass, tanpa "AI slop". Ini menggantikan palet monokrom PLAN §8.3.
- Token (dark, default): Ground `#06140E`, Surface `#0B1C15`, Raised `#12271E`, Line `#1C3329`, Hairline `#15291F`, Muted `#9BB3A7`, Text `#E8F3EC`. Mint `#4BF0A9` hanya untuk aksi utama (pill), logo, dan return positif. Coral `#FF8A7A` untuk negatif, Amber `#F4C65A` untuk paused/terblokir. Index mark memakai 4 hijau `#D6F5E6/#8FDDB8/#4FB58A/#2A7A5C`.
- Font Manrope (angka tabular) untuk teks dan angka; IBM Plex Mono (`.mono`) hanya untuk ticker dan alamat.
- Radius: tag 6, mark 8, kontrol 10, kartu 16. Hanya aksi utama berbentuk pill.
- Glass hanya di top bar/nav mobile (`glass-bar`) dan panel Join/Redeem (`glass-panel`). Tanpa glow/shadow; animasi hanya saat hover.
- Dark menjadi default (bukan mengikuti OS). Varian light diturunkan dari keluarga hijau yang sama, dengan warna data digelapkan agar kontrasnya cukup, dan tetap bisa dipilih lewat toggle.
- Implementasi: token di `apps/web/app/globals.css`; komponen shadcn disesuaikan (button pill, outline surface, segmented toggle, underline tabs, table hairline, switch/slider/progress tanpa mint).

## D035 — 2026-09-24 — Contract: kartu index untuk feed (variasi) + kartu kreator
- Konteks: permintaan client, "bisa di-design semacam card; ada koleksi token dalam index card-nya; variasinya beda-beda untuk share di feed" (contoh: kartu index bergaya gradien + ilustrasi 3D, dan kartu "Top Traders").
- Pilihan: struktur dan fungsi diambil (header visual, koleksi token, return + sparkline, TVL, drawdown vs benchmark, kreator). Gaya gradien ungu dan ilustrasi 3D **tidak** diikuti karena melanggar PLAN §8.2 dan D034. Variasi dibuat dari data index sendiri dengan keluarga hijau: `mark`, `tokens`, `chart`.
- Kontrak: kolom `posts.card_variant` (null, atau salah satu dari tiga variasi). Endpoint baca `/api/benchmark` (sparkline & drawdown SPYx). Tidak ada perubahan program atau tool MCP.

## D036 — 2026-09-24 — QA skenario A16: pemulihan alur multi-langkah & progres intent di server
- **Konteks**: audit A16 menemukan alur multi-transaksi (zap join/redeem, create+deposit, /sign, Blink berantai) bisa berhenti di tengah dan membuat user mengulang langkah yang sudah terjadi (swap ganda, index ganda).
- **Keputusan**:
  - Kegagalan parsial dilaporkan sebagai `PartialZapError`, dengan pemulihan dari saldo wallet saat ini (`joinWithHeld`, `swapToUsdc`), tidak pernah dengan mengulang dari awal.
  - Progres intent /sign dipegang server (`_next`, `_built` di `params`), dan hanya maju berdasarkan signature yang terverifikasi on-chain.
  - State Blink ditandatangani HMAC (kunci diturunkan dari `DATABASE_URL`).
  - Baris index bisa disinkronkan on-demand dari chain oleh web (`ensureIndexRow`) agar alur tepat setelah create tidak bergantung pada lag worker.
  - URI metadata memakai alamat index.
- **Kontrak**:
  - Tanpa perubahan skema DB atau program.
  - Tool MCP `get_intent_status` menambah field `result.index` (aditif); `build_redeem` menolak jumlah share 0.
  - API `/api/feed` dan `/api/posts` memakai parameter `cursor` (opak), menggantikan `before`.
- **Belum**: C8 (follower yang parent-nya tumbuh menjadi >10 aset) butuh perubahan program. Worker hanya backoff dan mencatat log.

## D037 — 2026-09-25 — PreStocks sebagai sumber utama harga & data pre-IPO
- **Konteks**: bounty PreStocks mensyaratkan proyek memakai PreStocks; proyek yang memakai token pre-IPO non-PreStocks gugur (A17 §2, §7.4). Sebelumnya harga pre-IPO hanya dari Jupiter, dan UI tidak menyebut issuer.
- **Keputusan**:
  - Worker membaca `https://prestocks.com/api/prestocks` (publik, tanpa key, read-only mainnet) sebagai sumber pertama untuk aset `priceSource: "prestocks"`, dicocokkan lewat `contract_address` = `mainnetMint`. Oracle memakai `tokenPrice` (harga token on-chain, sama konsepnya dengan Jupiter). Urutan fallback: PreStocks → Jupiter → random walk. Gagal API → backoff 30 detik, worker tidak crash. Untuk pre-IPO, fallback Jupiter kini memakai `usdPrice` (harga token), bukan `stockData.price` (≈ mark), agar konsisten dengan sumber utama.
  - Respons divalidasi zod di `packages/config/src/prestocks.ts` (dipakai worker & web). Baris tidak valid dilewati.
  - Skema DB tidak diubah: `prices.source` (text) menyimpan `prestocks`. Mark price, implied valuation, dan premium tidak disimpan di DB, tetapi disajikan route web `GET /api/prestocks` (cache memori 60 detik, timeout 5 detik, data lama tetap disajikan saat gagal).
  - `AssetDef.issuer` (aditif) = `{ name: "PreStocks", url: "https://prestocks.com" }` untuk semua aset pre-IPO; dikirim lewat `/api/config`.
  - UI: tag PreStocks + panel referensi di halaman index + catatan migrasi IPO yang meniru SpaceX (konversi ke SPCXx, tenggat 12 Mar 2027 23:59 UTC).
  - Tidak memakai Tessera atau token pre-IPO lain. Hasil grep: "Tessera" hanya ada di dokumen riset/bounty (`refs/hackathon.md`, A17) dan peringatan di `docs/SUBMISSION.md`; tidak ada di kode, seed, atau MCP.
- **Kontrak**: tanpa perubahan program atau skema DB. Tool MCP `list_assets` menambah field `issuer`, `issuerUrl`, `prestocksTokenPriceUsd`, `prestocksMarkPriceUsd`, `prestocksPremiumToMark`, `prestocksImpliedValuationUsd` (aditif). Endpoint baru `/api/prestocks`.

## D038 — 2026-09-25 — Demo publik devnet: Vercel + Neon + worker lokal (cadangan: Cloudflare quick tunnel)
- **Konteks**: juri dan klien Blink butuh URL https publik. Agent tidak bisa membuat akun atau men-deploy, sehingga user yang menjalankan langkahnya. Biaya harus nol dan langkahnya minimal.
- **Keputusan**:
  - Opsi A (utama): web di Vercel (Root Directory `apps/web`, `apps/web/vercel.json` dengan install `bunx bun@1.4.2 install` dan build `bun run build`), Postgres Neon, sedangkan worker + MCP berjalan di laptop user (`bun run worker:devnet`, DB = `DEVNET_DATABASE_URL`). Opsi B (cadangan): `cloudflared tunnel --url http://localhost:3000` + `DEVNET_WEB_URL=<tunnel> bun run start:devnet`. Detail di `docs/DEPLOY.md`.
  - `next.config.ts`: `outputFileTracingRoot` = root monorepo dan `outputFileTracingIncludes` (`packages/config/package.json`, `packages/config/deployments/*.json`) agar `readDeployment()` jalan di fungsi Vercel. `.env` root tidak dimuat bila `VERCEL` di-set. `WEB_URL` jatuh ke `https://$VERCEL_PROJECT_PRODUCTION_URL` bila kosong (juga di `parseEnv`). Toggle `NEXT_OUTPUT_STANDALONE` untuk uji tata letak lokal. `allowedDevOrigins` = `*.trycloudflare.com`.
  - `@repo/db` `connectionOptions()`: `channel_binding` dibuang (postgres.js mengirimnya sebagai parameter server dan ditolak, terbukti di Postgres lokal), TLS `require` untuk host non-lokal tanpa `sslmode`, `prepare: false` untuk host `-pooler` (PgBouncer transaction mode), dan pool 3 + idle 20 s di Vercel (`DATABASE_POOL_MAX` override). Koneksi lokal tidak berubah.
  - Env aditif `ADMIN_KEYPAIR_JSON` (zod: array JSON 64 byte) sebagai alternatif `ADMIN_KEYPAIR_PATH`. Tanpa keduanya, `/api/faucet/sol` di devnet membalas 503 dengan arahan ke faucet.solana.com (faucet USDC tetap jalan karena ditandatangani user).
  - Script baru: `db:remote` (migrate/copy/check; copy = pg_dump `app_devnet` lokal → pg_restore via image docker postgres, URL tidak dicetak), `vercel:env` (menulis `.env.vercel` git-ignored untuk ditempel ke Vercel, hanya mencetak nama variabel), `check:public` (smoke test URL publik, read-only), `worker:devnet`, `start:devnet`. `dev.ts`: `DEVNET_DATABASE_URL` (lewati docker, migrasi via drizzle migrator) dan `DEVNET_WEB_URL` (WEB_URL untuk worker/MCP/web). Menunggu web lewat `localhost:3000`, bukan `WEB_URL`.
  - MCP tidak dibuka ke publik: server memegang keypair agent, dan guard Host hanya menerima localhost.
- **Risiko**:
  - `ADMIN_KEYPAIR_JSON` di Vercel = upgrade authority program devnet ikut berada di platform pihak ketiga. Opsional dan hanya devnet; disarankan dikosongkan dan dihapus setelah penjurian.
  - `NEXT_PUBLIC_RPC_URL` terlihat publik (lanjutan D031): default endpoint publik devnet, disarankan key Helius kedua yang dibatasi domain, dan `RPC_URL` server tetap secret.
  - Worker di laptop harus menyala agar oracle tidak stale.
- **Kontrak**: tanpa perubahan program, skema DB, atau tool MCP. Env schema hanya aditif.

## D039 — 2026-09-25 — QA putaran 2 (A18): harga live dibatasi, IPO kontinu, rebalance manual
- Harga dari sumber live dibatasi 5% per tick, agar pergantian sumber atau feed baru tidak melompatkan NAV dan memicu rebalance palsu. Shock manual tetap instan.
- IPO:
  - harga saham baru = harga pre-IPO × den/num;
  - follower dimigrasi sebelum parent, dan follow loop menahan follower selama IPO berjalan;
  - skrip menulis deployment lebih dulu dan bisa diulang.
- Kreator bisa rebalance manual dari Manage (dibutuhkan index Hold, keeper-off, dan fase-out). Planner menjual seluruh saldo untuk target 0%.
- MCP (lebih ketat; bentuk tool tidak berubah, kecuali pesan):
  - aset yang sudah IPO dan benchmark ditolak di tool tulis;
  - setoran minimum $1,10, join minimum $1;
  - `agent_propose_update` hanya menerapkan proposal miliknya dan mempertahankan aset bersaldo di 0%.
- `/api/config` menambah `faucetSol` (aditif).
- `PRICE_MODE` default `live`.

## D040 — 2026-09-25 — Nama produk: Stockbreak
- Keputusan user: produk berganti nama dari "Stocklana" menjadi **Stockbreak**. "Stocklana" adalah nama hackathon-nya dan sudah dipakai 7+ repo lain (A17).
- Yang diganti:
  - nama yang terlihat user: `NEXT_PUBLIC_APP_NAME` default dan `.env`, UI/OG/metadata lewat `APP_NAME`, pesan sign-in;
  - nama server MCP (`stockbreak`) beserta panduan dan snippet `claude mcp add`;
  - README, DEMO, SUBMISSION, DEPLOY, ARCHITECTURE.
- Yang sengaja dipertahankan:
  - nama/URL hackathon "Stocklana";
  - URL repo `viandwi24/stocklana` dan nama direktori;
  - identifier internal: key localStorage `stocklana:*` (agar dev wallet dan tema user tidak hilang), nama project docker compose (volume DB), nama package, cache `__stocklanaDb`, kunci HMAC Blink;
  - handle `stocklana` tetap dicadangkan, `stockbreak` ditambahkan.
- Dokumen riwayat (PLAN, STATUS, DECISIONS lama, analisis) tidak ditulis ulang.

## D041 — 2026-09-25 — Logo token resmi (gaya Raydium)
- Permintaan user: aset ditampilkan dengan logonya supaya langsung dikenali, seperti ikon pasangan di Raydium.
- Sumber: metadata token mainnet (read-only) lewat Jupiter Token API v2, diambil satu kali per hari oleh `/api/token-logos` dan di-cache 24 jam.
  - xStocks memakai `xstocks-metadata.backed.fi`, PreStocks memakai `prestocks.com`, USDC memakai logo resmi.
  - Saham hasil IPO memakai logo pre-IPO perusahaan yang sama.
- `TickerMono` menampilkan logo bila tersedia, dan kembali ke tile ticker mono bila offline atau gambar gagal dimuat. Semua tempat yang memakainya otomatis ikut: alokasi, wizard, Manage, command palette.
- `AssetStack` (logo bertumpuk, urut bobot) menggantikan index mark di baris tabel index. Index mark tetap dipakai di header halaman index dan di kartu.
- Pengecualian §8 "monokrom": logo penerbit adalah informasi (identitas aset), bukan dekorasi. Tetap tanpa gradien/ilustrasi.

## D042 — 2026-09-25 — Overlay progres transaksi
- Permintaan user: toast "Step 3 of 5" terlalu minim untuk alur multi-tanda-tangan. Semua alur transaksi kini memakai overlay di tengah layar (`components/shell/tx-overlay.tsx`, store `lib/tx-overlay.ts`), digerakkan oleh `useRun` sehingga setiap alur ikut otomatis.
- Isi overlay:
  - progress ring dengan persentase;
  - daftar tahap yang direncanakan di awal (selesai / aktif / menunggu), dengan catatan "Approve in your wallet" atau "Waiting for fresh prices";
  - tautan setiap transaksi;
  - akhir yang jelas: sukses (tutup otomatis 1,6 s), gagal (tetap sampai ditutup), atau sebagian (tombol pemulihan);
  - tombol "Hide" untuk mengecilkan jadi pil di pojok sementara alur tetap berjalan.
- Alur yang dicakup:
  - join (swap → deposit), redeem (siapkan akun → redeem → swap balik);
  - create index (tabel alamat → create → manager → swap deposit → deposit), retry/finish deposit;
  - finish join, swap to USDC;
  - `/sign` agent (tahap dari server);
  - setup dev wallet (mode otomatis tanpa prompt);
  - semua aksi satu transaksi (manage, klaim, faucet).
- Toast sukses tetap ada (konfirmasi kecil setelah overlay menutup). Toast peringatan untuk hasil sebagian tetap ada agar pemulihan bisa dijangkau setelah overlay ditutup. Toast loading dan toast error untuk run digantikan overlay.
- Gaya mengikuti D034: hijau gelap, mint hanya untuk progres/sukses, coral untuk gagal, animasi halus (ring, ping titik aktif, zoom-in), tanpa gradien/ilustrasi.

## D043 — 2026-09-25 — MCP remote publik (`/api/mcp`) dengan tool agent bertoken
- Masalah: MCP hanya bisa dipakai dari mesin yang meng-clone repo (localhost-only). Konektor Claude.ai/ChatGPT butuh URL https publik.
- Keputusan: web Next.js menyajikan factory server yang sama (`@repo/mcp/public`, `createServer({ agentTools })`) di `app/api/mcp/route.ts` lewat `createMcpHandler` (stateless per request, cocok untuk Vercel; klien 2025 dilayani fallback legacy stateless bawaan SDK). Health `/api/mcp/health`.
- Keamanan endpoint publik:
  - default hanya tool riset, `simulate_rebalance`, `build_*`, `get_intent_status`, resource `docs://guide` (user tetap menandatangani sendiri di `/sign`);
  - `agent_*` hanya bila request membawa `Authorization: Bearer <MCP_AGENT_TOKEN>` (perbandingan waktu-konstan atas hash SHA-256) **dan** keypair agent tersedia (`AGENT_KEYPAIR_JSON` baru, atau file `AGENT_KEYPAIR_PATH`); batas program (mandate) tetap berlaku;
  - CORS `*`, rate limit per IP 60/menit in-memory (per instance; cukup untuk demo, bukan jaminan global), 429 berbentuk JSON-RPC;
  - tanpa validasi Host localhost (publik by design). Server lokal `apps/mcp` tetap localhost-only dan tidak berubah perilakunya; mode publik standalone lewat `MCP_PUBLIC=1` (+ `MCP_HOST`, `MCP_ALLOWED_HOSTS`, `PORT`).
- URL: `MCP_WEB_URL` (basis panggilan API web dari MCP, default `WEB_URL`); link untuk user (`signUrl`, `/i/…`, URI metadata) selalu `WEB_URL`. `NEXT_PUBLIC_MCP_URL` untuk halaman Agents. Semua env baru opsional dan divalidasi zod (`mcpHttpEnvSchema`).
- `vercel:env` menulis `NEXT_PUBLIC_MCP_URL` + `MCP_WEB_URL`; secret agent hanya dengan `--with-agent` (token acak baru, nilai tidak dicetak).
- `Bun.sleep` di `tools/agent.ts` diganti `setTimeout` agar modul bisa berjalan di runtime Node (Vercel).
- Cloudflare Workers ditolak untuk sekarang: `readDeployment`/keypair via `node:fs`, pool postgres.js global (Workers melarang I/O lintas request; butuh klien per request + Hyperdrive), `Bun.serve`. Alternatif: route Vercel atau host Bun mana pun.

## D044 — 2026-09-25 — Agent menjelaskan keputusan di feed + runner otonom `agent:loop`
- Tool MCP baru `agent_post` (mode agent wallet): agent memposting dari wallet-nya sendiri, opsional menempel ke index (alamat/simbol) dan tampil sebagai kartu (`mark|tokens|chart`).
  - Menulis langsung lewat `createPost` di `@repo/db` (MCP sudah punya akses DB), tanpa sesi web.
  - Aturan konten sama dengan web (D033): ≤500 karakter, ≤2 link, tanpa karakter berulang panjang, tanpa duplikat 24 jam. Disalin ke `apps/mcp/src/social.ts` karena `antispam.ts` web bersifat `server-only`.
  - Batas laju khusus agent dari DB (`postStats`/`isDuplicate`): jeda ≥60 s, ≤30 post/hari.
  - Wajib `users.isAgent` (agent_register); syarat "aktivitas on-chain" web tidak dipakai karena agent manager bisa tidak punya event Joined/IndexCreated.
  - URL hasil: `/i/<index>` bila menempel ke index, selain itu `/u/<wallet>` (belum ada permalink post).
- Tool baca `get_feed`: post terbaru untuk satu index (`/api/posts?index=`) atau feed umum dengan aktivitas on-chain (`/api/feed?tab=all`).
- `docs://guide`: setelah setiap `agent_rebalance`/`agent_propose_update` agent wajib `agent_post` yang menjelaskan apa, mengapa (angka), dan langkah berikutnya.
- Runner `scripts/agent-loop.ts` (`bun run agent:loop`): klien MCP Streamable HTTP + LLM via API chat completions kompatibel OpenAI (default OpenRouter). Env dibaca langsung dari `process.env` (bukan skema `packages/config`, agar tidak bentrok dengan pekerjaan paralel): `AGENT_MCP_URL`, `AGENT_MCP_TOKEN`, `AGENT_LLM_BASE_URL`, `AGENT_LLM_API_KEY`, `AGENT_LLM_MODEL`, `AGENT_LOOP_INTERVAL`.
  - Tool yang disembunyikan dari LLM otonom: `build_*` dan `get_intent_status` (butuh manusia), `agent_create_index`/`agent_join` (memakai dana baru), `agent_register` (identitas; lewat flag `--register`).
  - `--dry-run` menolak semua tool tulis (`agent_*` kecuali `agent_info`, `build_*`) di sisi klien.
  - Maks 12 panggilan tool/siklus, nominal > `MCP_MAX_USDC_PER_ACTION` ditolak di klien, status post tanpa aksi maks 1 per index per hari (in-memory).
- Perbaikan terkait: `agent_info` menampilkan saldo USDC `NaN` karena `fetchTokenBalances` (Map) di-destructure sebagai array; kini dibaca lewat `Map.get`.

## D045 — 2026-09-25 — Agent milik user + API key (custody model A, devnet/localnet saja)
- Masalah: agent `agent_*` hanya bisa memakai satu keypair operator (`AGENT_KEYPAIR_*` + `MCP_AGENT_TOKEN`, D043). User ingin membuat agent sendiri dari web dan menghubungkannya ke Claude Code/`agent:loop`, seperti konsol API.
- Keputusan (dipilih user: model A, kustodi server):
  - Server membuat seed ed25519 32 byte (crypto random) per agent, alamat diturunkan dengan `createKeyPairSignerFromPrivateKeyBytes`, seed disimpan terenkripsi AES-256-GCM di `agent_wallets.secret_enc` (format `base64(iv12|tag16|ciphertext)`, kunci = SHA-256(`AGENT_KEY_SECRET`)). Agent langsung terdaftar (`users.is_agent` + `agent_name`).
  - API key `sbk_` + 32 byte acak base64url; yang disimpan hanya hash SHA-256 hex + prefix 12 karakter; key mentah ditampilkan sekali (`Cache-Control: no-store`). Cabut = `revoked_at`.
  - Remote MCP: `Authorization: Bearer sbk_…` → resolve hash (abaikan yang dicabut; `last_used_at` diperbarui maks 1×/menit) → dekripsi seed → cek alamat turunan = wallet tersimpan → `createServer({ agent })`: semua tool memakai ctx dengan `agent` itu. Key tak valid → 401 (tidak jatuh ke mode anonim). Signer hanya diterima factory bila berasal dari resolver di proses yang sama (WeakSet), bukan dari header. Rate limit per key 120/menit + per IP.
  - Batas: 3 agent/owner, 5 key aktif/agent (dicek dalam transaksi dengan advisory lock per owner/agent). Pemilik = wallet sesi sign-in (D033); mutasi wajib same-origin.
  - Batas program tetap berlaku: agent yang dijadikan manager tidak bisa menarik dana; `MCP_MAX_USDC_PER_ACTION` tetap. Dana SOL untuk fee lewat `POST /api/me/agents/[wallet]/fund` yang memakai jalur faucet SOL yang sama (`lib/server/faucet.ts`, batas per wallet & harian sama).
  - `AGENT_KEY_SECRET` (≥32 karakter, server-only) opsional di skema env; bila kosong fitur mati (503 "Agent creation is not configured on this server"; MCP: "Agent API keys are not configured on this server"). `bun run setup` membuatnya bila belum ada; `vercel:env` menyalinnya dari `.env`. Harus sama di semua server yang berbagi DB; kehilangan/mengganti secret = agent lama tidak bisa dibuka (tidak ada rotasi otomatis).
- Risiko & batasan: kunci privat agent ada di server (siapa pun yang memegang DB + `AGENT_KEY_SECRET` bisa menandatangani sebagai agent). Dapat diterima karena aset simulasi dan hanya devnet/localnet. Untuk produksi: pindah ke wallet kustodian/MPC (Turnkey, Privy server wallets) dengan kebijakan per-key, atau model B (user mendelegasikan manager ke keypair yang dia pegang sendiri).
- Alternatif ditolak: keypair per user di file (tidak jalan di Vercel), menyimpan seed tanpa enkripsi, mengembalikan key di listing.

