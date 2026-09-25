# DEPLOY — demo publik di devnet

Juri hackathon dan klien Blink (dial.to, X) butuh **URL publik https**. Program sudah ter-deploy di devnet (`packages/config/deployments/devnet.json`, lihat STATUS P11). Dokumen ini menyiapkan web publik dengan langkah sesedikit mungkin. Semua aset & harga tetap simulasi, dan tidak ada transaksi mainnet.

| | Opsi A (disarankan) | Opsi B (tercepat) |
|---|---|---|
| Web | Vercel (Hobby, gratis) | laptop user lewat Cloudflare quick tunnel |
| DB | Neon Postgres (gratis) | Postgres docker lokal (atau Neon) |
| Worker + MCP | laptop user → Neon + devnet | laptop user |
| Akun baru | GitHub (sudah), Vercel, Neon | tidak ada |
| URL | tetap (`https://<project>.vercel.app`) | acak, berubah setiap tunnel dijalankan |
| Bila laptop mati | web tetap hidup; harga/indexer/keeper berhenti | web mati |

Worker (feeder harga, indexer, keeper, follow, gamifikasi) di kedua opsi tetap berjalan di laptop user. Selama penjurian (sampai 2 Okt), jalankan worker sesering mungkin. Tanpa worker, halaman tetap bisa dibuka dan transaksi tetap jalan. Namun harga oracle menjadi stale, sehingga zap join/redeem akan ditolak program ("oracle stale"). **Worker harus hidup saat juri mencoba.**

MCP **tidak** dibuka ke publik. Server MCP memegang keypair agent yang bisa menandatangani, dan hanya menerima Host `localhost` (proteksi DNS rebinding). Juri melihat fitur agent lewat video atau clone repo (docs/DEMO.md "Connect an AI agent").

---

## Opsi A — Vercel + Neon + worker lokal

### A0. Prasyarat (sekali)
1. Commit & push seluruh perubahan ke GitHub (repo boleh private). File yang **wajib** ikut: `bun.lock`, `apps/web/vercel.json`, `packages/config/deployments/devnet.json` (sudah di-track). `.env*` dan `.keys/` tetap di-gitignore, jangan dipaksa masuk.
2. `bun install` sudah pernah dijalankan dan Docker/OrbStack menyala (hanya untuk langkah A2 salin data).

### A1. Neon (Postgres gratis)
1. Daftar di https://neon.com (login GitHub boleh) → **New project**.
   - Postgres version: 18 bila tersedia (sama dengan docker lokal), selain itu 17.
   - Region: **AWS US East (N. Virginia)**, satu wilayah dengan region default fungsi Vercel (`iad1`).
2. Buka **Connect** di dashboard project, lalu salin dua connection string:
   - **Direct** (toggle *Connection pooling* OFF): `postgresql://…@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require`
   - **Pooled** (toggle ON, host berakhiran `-pooler`): `postgresql://…@ep-xxx-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require`
3. Tambahkan ke `.env` di root repo (git-ignored):
   ```
   DEVNET_DATABASE_URL=<URL direct>
   VERCEL_DATABASE_URL=<URL pooled>
   ```
   URL boleh ditempel apa adanya. `@repo/db` membuang `channel_binding` (postgres.js mengirimnya sebagai parameter server yang lalu ditolak). TLS wajib untuk host non-lokal. Pada host `-pooler`, prepared statement bernama dimatikan (PgBouncer transaction mode).

### A2. Isi database Neon
Pilihan 1, **salin data devnet lokal** (disarankan, karena index, histori harga, profil, dan feed sosial ikut):
```
bun run db:remote -- copy
```
Perintah ini menjalankan `pg_dump` dari `app_devnet` lokal (docker), `pg_restore` ke Neon memakai image `postgres:18.6-alpine` (tanpa instal apa pun), lalu migrasi dan menampilkan jumlah baris. URL tidak pernah dicetak. Bila target sudah berisi tabel, perintah menolak; tambahkan `--force` untuk menimpa.

Pilihan 2, **DB kosong**: `bun run db:remote -- migrate`. Setelah itu worker (A4) mengisi index dari chain lewat loop resync. Histori harga, profil, dan feed sosial kosong.

Cek kapan saja: `bun run db:remote -- check`.

### A3. Vercel (web)
1. Daftar di https://vercel.com (login GitHub) → **Add New… → Project** → import repo.
2. **Root Directory**: `apps/web` (klik Edit). Framework terdeteksi Next.js. Install/Build Command diambil dari `apps/web/vercel.json`:
   - install `bunx bun@1.4.2 install` (versi Bun dipin sama dengan lokal; install workspace dari root monorepo);
   - build `bun run build` (= `next build`).

   Opsi "Include files outside the root directory" harus tetap aktif (default), karena `packages/*` dipakai.
3. **Environment Variables**: buat file siap-tempel di laptop:
   ```
   bun run vercel:env -- --web-url https://<nama-project>.vercel.app
   # opsional, faucet SOL in-app aktif (lihat risiko di bawah):
   bun run vercel:env -- --web-url https://<nama-project>.vercel.app --with-admin-key
   ```
   Perintah ini menulis `.env.vercel` (git-ignored, mode 600) dan hanya mencetak nama variabel. Buka file itu, salin seluruh isinya, lalu tempel di form Environment Variables Vercel (form menerima tempelan format `.env`). Pilih environment Production (dan Preview bila perlu). Tandai `DATABASE_URL`, `RPC_URL`, `WS_URL`, `ADMIN_KEYPAIR_JSON` sebagai **Sensitive**.
4. **Deploy**. Bila nama domain berbeda dari tebakan di langkah 3, ubah `WEB_URL` lalu **Redeploy**. `WEB_URL` ikut terpakai saat build (metadata/OG), jadi redeploy wajib.
5. Opsional: Settings → Functions → Region `iad1` (sama dengan Neon).

### A4. Worker di laptop → Neon + devnet
Tambahkan juga ke `.env`: `DEVNET_WEB_URL=https://<nama-project>.vercel.app`, lalu:
```
bun run worker:devnet
```
Perintah ini menjalankan worker + MCP lokal (3333), dengan cluster devnet, DB `DEVNET_DATABASE_URL` (tanpa docker), dan migrasi otomatis. Link `/sign` dari MCP dan URI metadata memakai URL Vercel. Biarkan terminal ini terbuka selama penjurian. Jangan menjalankan `bun run dev:devnet` lain bersamaan, karena dua worker akan mendorong harga dan menjalankan keeper ganda.

### A5. Verifikasi
```
bun run check:public -- https://<nama-project>.vercel.app
```
Hasil yang diharapkan `PASS 10/10`: https, `/api/config` (cluster devnet, deployment terbaca), `/api/indexes`, `/api/prices`, `/actions.json` (+CORS), Blink GET (ikon di domain publik), OPTIONS (CORS), OG image, halaman index (og:image di domain publik), dan home. Script juga mencetak link uji Blink `https://dial.to/?action=solana-action:…&cluster=devnet`.

Lalu uji manual dengan Phantom (Settings → Developer Settings → Testnet mode → Solana Devnet), mengikuti docs/DEMO.md bagian B dengan URL Vercel.

### Tabel environment variable (Vercel)
| Variabel | Publik? | Nilai | Keterangan |
|---|---|---|---|
| `CLUSTER` | server | `devnet` | wajib |
| `NEXT_PUBLIC_CLUSTER` | **publik** (di-bundle) | `devnet` | wajib |
| `RPC_URL` | server, **secret** | Helius devnet (`DEVNET_RPC_URL`) | dipakai route API untuk membangun/simulasi tx |
| `WS_URL` | server, secret | `wss://…` dari RPC_URL | |
| `NEXT_PUBLIC_RPC_URL` | **publik** | default `https://api.devnet.solana.com` | dipakai browser. Nilai apa pun di sini terlihat semua pengunjung (D031/D038), jadi jangan isi key Helius utama |
| `NEXT_PUBLIC_WS_URL` | publik | `wss://api.devnet.solana.com/` | |
| `NEXT_PUBLIC_APP_NAME` | publik | `Stockbreak` | opsional |
| `WEB_URL` | server | `https://<project>.vercel.app` | Blink, OG, metadata, cookie `secure`. Bila kosong, jatuh ke `https://$VERCEL_PROJECT_PRODUCTION_URL` |
| `DATABASE_URL` | server, **secret** | Neon **pooled** | pool 3 koneksi/instance di Vercel (`DATABASE_POOL_MAX` untuk mengubah) |
| `ADMIN_KEYPAIR_JSON` | server, **secret** | isi `.keys/admin.json` | opsional; tanpa ini faucet SOL mati dengan pesan jelas (USDC tetap jalan) |
| `FAUCET_SOL_PER_REQUEST` / `FAUCET_SOL_DAILY_CAP` | server | `0.1` / `1` | batas faucet SOL (saldo admin devnet terbatas) |

Tidak perlu di Vercel: `KEEPER_KEYPAIR_PATH`, `AGENT_KEYPAIR_PATH`, `PRICE_*`, `JUPITER_API_KEY`, `FINNHUB_API_KEY`, `MCP_*`, `*_INTERVAL` (semuanya milik worker/MCP lokal).

**Risiko `ADMIN_KEYPAIR_JSON`** (D038): `admin` adalah upgrade authority program, market authority, dan pendana faucet devnet. Menaruhnya di Vercel berarti siapa pun yang punya akses ke project Vercel bisa meng-upgrade program devnet. Hanya pakai bila faucet SOL in-app benar-benar dibutuhkan. Alternatifnya, arahkan juri ke https://faucet.solana.com (pesan faucet sudah menyebutkannya). Bila dipakai, hapus variabelnya setelah penjurian. Aset yang terlibat hanya devnet, tanpa nilai nyata.

**RPC publik**: pilihan terbaik untuk `NEXT_PUBLIC_RPC_URL` adalah key Helius **kedua** dengan *allowed domains* = domain Vercel (dashboard Helius → Access Control), atau endpoint publik devnet (rate-limited, bisa 429 bila ramai). Jangan memakai key yang sama dengan `RPC_URL`.

---

## Opsi B — Cloudflare quick tunnel (tanpa akun)

Dokumentasi resmi: quick tunnel hanya untuk pengujian. Batasnya 200 request in-flight (lebih dari itu dibalas 429), tanpa SSE, tanpa SLA, dan subdomain `*.trycloudflare.com` acak berubah setiap kali dijalankan.

1. Pasang (sekali): `brew install cloudflared`.
2. Terminal 1, buka tunnel ke port web:
   ```
   cloudflared tunnel --url http://localhost:3000
   ```
   Catat URL `https://<acak>.trycloudflare.com` yang dicetak. Tunnel boleh dibuka sebelum web menyala.
3. Terminal 2, jalankan stack devnet versi produksi dengan URL itu:
   ```
   DEVNET_WEB_URL=https://<acak>.trycloudflare.com bun run start:devnet
   ```
   `start:devnet` = `dev.ts --cluster devnet --ci`: build web produksi (`next build` + `next start`), worker, dan MCP. Build produksi dipakai karena `WEB_URL` dibaca saat build dan `next dev` lebih lambat. `allowedDevOrigins` sudah mengizinkan `*.trycloudflare.com` bila ingin memakai `bun run dev:devnet`.
4. Verifikasi: `bun run check:public -- https://<acak>.trycloudflare.com`.
5. Setiap kali tunnel dijalankan ulang, URL berubah. Ulangi langkah 3 dengan URL baru (Ctrl+C lalu jalankan lagi), dan perbarui link di submission.

Catatan: laptop dan kedua terminal harus tetap menyala selama penjurian (sampai 2 Okt), dan sleep laptop mematikan demo. Karena URL berubah, opsi ini cocok untuk cadangan atau video. Untuk link submission, gunakan Opsi A.

---

## Catatan operasional (A18)
- **IPO di devnet:** `bun run ipo -- --asset <PRE> --cluster devnet` memperbarui `packages/config/deployments/devnet.json` di laptop. Web di Vercel membaca file versi commit, jadi **commit file itu lalu redeploy**. Kalau tidak, halaman publik masih menganggap token lama ter-listing. Worker lokal langsung memakai file baru.
- **`verify:devnet`** menolak jalan selama `DEVNET_DATABASE_URL` terisi, agar data uji tidak masuk ke DB demo publik. Jalankan sebagai `DEVNET_DATABASE_URL= bun run verify:devnet`.
- **`seed -- --cluster devnet`** menulis ke `DEVNET_DATABASE_URL` bila terisi (DB yang sama dengan stack devnet).
- **`PRICE_MODE`** default `live`. PreStocks tidak butuh key; Jupiter/Finnhub dipakai bila key ada. Harga live bergerak maksimal 5% per tick.
- **Faucet SOL** tanpa `ADMIN_KEYPAIR_JSON`: halaman `/faucet` langsung menampilkan faucet.solana.com beserta alamat wallet.

## Troubleshooting
| Gejala | Penyebab & solusi |
|---|---|
| Build Vercel gagal di tahap install | cek log versi Bun; `vercel.json` memakai `bunx bun@1.4.2 install`. Pastikan `bun.lock` ter-commit dan sinkron (`bun install` lokal lalu commit lockfile). |
| `/api/config` → `ready=false` | `packages/config/deployments/devnet.json` tidak ada di repo yang di-push, atau file tracing gagal. File di-trace lewat `outputFileTracingIncludes` di `apps/web/next.config.ts`. |
| `/api/indexes` 500 | `DATABASE_URL` salah/kosong di Vercel, atau DB belum dimigrasi (`bun run db:remote -- migrate`). Log di Vercel → Deployments → Functions. |
| `unrecognized configuration parameter "channel_binding"` | hanya muncul bila memakai `drizzle-kit`/postgres.js mentah ke Neon. Gunakan `bun run db:remote -- migrate` (bukan `bun run --cwd packages/db db:migrate`) atau hapus `&channel_binding=require` dari URL. |
| Blink/OG menunjuk `localhost` | `WEB_URL` belum diisi domain publik → isi lalu **Redeploy** (Opsi A), atau jalankan ulang `start:devnet` dengan `DEVNET_WEB_URL` (Opsi B). |
| Join/redeem gagal "oracle stale" | worker tidak berjalan → `bun run worker:devnet` (A) / `start:devnet` (B). |
| Harga tidak bergerak di web Vercel | worker memakai DB lain. `DEVNET_DATABASE_URL` harus menunjuk project Neon yang sama dengan `DATABASE_URL` Vercel (direct vs pooled, host sama). |
| Faucet SOL: "The SOL faucet is off…" | `ADMIN_KEYPAIR_JSON` sengaja tidak diisi. Pakai faucet.solana.com, atau isi variabel itu lalu redeploy. |
| Faucet SOL: "daily budget is used up" | naikkan `FAUCET_SOL_DAILY_CAP` sesuai saldo admin, atau isi ulang admin devnet. |
| 429 dari RPC di browser | endpoint publik devnet rate-limited. Pakai key Helius kedua yang dibatasi domain untuk `NEXT_PUBLIC_RPC_URL`. |
| Neon "compute suspended"/koneksi pertama lambat | free tier menidurkan compute saat idle. Request pertama beberapa detik lebih lambat; worker yang menyala menjaga compute tetap bangun. |
| X tidak menampilkan Blink | X hanya unfurl action yang terdaftar di registry Dialect dan mainnet. Untuk devnet, pakai link dial.to dari `check:public`. |
| `bun run verify:devnet` menulis ke Neon | `DEVNET_DATABASE_URL` di `.env` ikut terbaca. Untuk uji lokal jalankan `DEVNET_DATABASE_URL= bun run verify:devnet`. |

## Uji lokal tata letak Vercel
`NEXT_OUTPUT_STANDALONE=1 VERCEL=1` + env produksi → `cd apps/web && bun run build` menghasilkan `.next/standalone` dengan file ter-trace yang sama seperti fungsi Vercel. Hasilnya: `packages/config/deployments/*.json` ikut, sedangkan `.env` dan `.keys/` tidak. `node apps/web/server.js` di folder itu lalu `check:public` → PASS 10/10 (lihat STATUS 2026-09-25).

## Sumber resmi
- Vercel package managers (deteksi `bun.lock`): https://vercel.com/docs/package-managers
- Vercel pin versi Bun: https://vercel.com/kb/guide/how-to-pin-a-specific-bun-version-for-vercel-builds
- Vercel monorepo (Root Directory, filtered install): https://vercel.com/docs/monorepos
- Vercel Node.js versions (24.x default): https://vercel.com/docs/functions/runtimes/node-js/node-js-versions
- Vercel file di Functions (`process.cwd()`, tracing): https://vercel.com/kb/guide/how-can-i-use-files-in-serverless-functions
- Next.js output & file tracing (`outputFileTracingRoot/Includes`): https://nextjs.org/docs/app/api-reference/config/next-config-js/output
- Neon + Node/postgres.js (`ssl: 'require'`): https://neon.com/docs/guides/node
- Neon connection pooling (`-pooler`, transaction mode, migrasi via direct): https://neon.com/docs/connect/connection-pooling
- Cloudflare quick tunnel: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/
- cloudflared download (`brew install cloudflared`): https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/
