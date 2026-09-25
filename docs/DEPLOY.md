# DEPLOY — demo publik di devnet

Juri hackathon dan klien Blink (dial.to, X) butuh **URL publik https**. Program sudah ter-deploy di devnet (`packages/config/deployments/devnet.json`, lihat STATUS P11). Dokumen ini menyiapkan web publik dengan langkah sesedikit mungkin. Semua aset & harga tetap simulasi, dan tidak ada transaksi mainnet.

| | Opsi A (disarankan) | Opsi B (tercepat) |
|---|---|---|
| Web | Vercel (Hobby, gratis) | laptop user lewat Cloudflare quick tunnel |
| DB | Neon Postgres (gratis) | Postgres docker lokal (atau Neon) |
| Worker | laptop user → Neon + devnet | laptop user |
| MCP remote (`/api/mcp`) | ikut web Vercel | ikut web lewat tunnel |
| Akun baru | GitHub (sudah), Vercel, Neon | tidak ada |
| URL | tetap (`https://<project>.vercel.app`) | acak, berubah setiap tunnel dijalankan |
| Bila laptop mati | web tetap hidup; harga/indexer/keeper berhenti | web mati |

Worker (feeder harga, indexer, keeper, follow, gamifikasi) di kedua opsi tetap berjalan di laptop user. Selama penjurian (sampai 2 Okt), jalankan worker sesering mungkin. Tanpa worker, halaman tetap bisa dibuka dan transaksi tetap jalan. Namun harga oracle menjadi stale, sehingga zap join/redeem akan ditolak program ("oracle stale"). **Worker harus hidup saat juri mencoba.**

MCP **remote** ikut web di `https://<web>/api/mcp` (bagian "Remote MCP" di bawah, D043): siapa pun bisa menghubungkan Claude.ai, ChatGPT, atau Claude Code. Endpoint publik hanya menyediakan tool baca, simulasi, dan `build_*` (user tetap menandatangani sendiri di `/sign`). Tool `agent_*` (keypair agent milik server) hanya muncul untuk request dengan `Authorization: Bearer <MCP_AGENT_TOKEN>`. Server MCP lokal (`127.0.0.1:3333`) tetap localhost-only seperti sebelumnya.

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

Worker ini juga menjalankan **Autopilot** (D047): agent milik user yang autopilot-nya aktif dibangunkan dari sini, bukan dari Vercel. Syaratnya di `.env` mesin worker: `AGENT_KEY_SECRET` **sama persis** dengan nilai di Vercel (untuk membuka seed agent di DB yang sama) dan kunci LLM `AGENT_LLM_API_KEY` (atau `OPENROUTER_API_KEY`), opsional `AGENT_LLM_BASE_URL`/`AGENT_LLM_MODEL`. Kunci LLM **tidak** perlu dan jangan dimasukkan ke Vercel (`vercel:env` tidak menyalinnya). Web di Vercel menampilkan status "available" dari heartbeat worker di tabel `worker_status`; bila worker mati >5 menit, panel Autopilot menampilkan "The autopilot worker is not running on this server." Env opsional: `AUTOPILOT_INTERVAL` (60), `AUTOPILOT_MAX_PER_TICK` (3), `AUTOPILOT_RUN_TIMEOUT` (120), `AUTOPILOT_ENABLED=false` (mematikan), `AUTOPILOT_DRY_RUN=1` (tanpa aksi tulis). Dua worker yang berbagi DB tidak menjalankan agent yang sama dua kali (klaim `FOR UPDATE SKIP LOCKED`), tetapi tetap jangan jalankan dua worker karena loop lain (harga, keeper).

### A5. Verifikasi
```
bun run check:public -- https://<nama-project>.vercel.app
```
Hasil yang diharapkan `PASS 11/11`: https, `/api/config` (cluster devnet, deployment terbaca), `/api/indexes`, `/api/prices`, `/actions.json` (+CORS), Blink GET (ikon di domain publik), OPTIONS (CORS), OG image, halaman index (og:image di domain publik), home, dan `/api/mcp/health` (MCP remote, cluster devnet). Script juga mencetak link uji Blink `https://dial.to/?action=solana-action:…&cluster=devnet`.

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
| `NEXT_PUBLIC_MCP_URL` | publik | `https://<project>.vercel.app/api/mcp` | URL MCP di halaman Agents; kosong = origin halaman + `/api/mcp` |
| `MCP_WEB_URL` | server | `https://<project>.vercel.app` | opsional; basis panggilan API web dari tool MCP (default `WEB_URL`) |
| `MCP_AGENT_TOKEN` | server, **secret** | acak ≥16 karakter | opsional (`vercel:env -- --with-agent`); membuka `agent_*` untuk pemegang token |
| `AGENT_KEYPAIR_JSON` | server, **secret** | isi `.keys/agent.json` | opsional, hanya bersama `MCP_AGENT_TOKEN` |
| `AGENT_KEY_SECRET` | server, **secret** | acak ≥32 karakter (dari `.env`, dibuat `bun run setup`) | opsional; mengaktifkan agent milik user + API key (D045). **Harus sama** dengan nilai yang mengenkripsi agent di DB yang sama; `vercel:env` menyalinnya otomatis |

Tidak perlu di Vercel: `AGENT_LLM_*`/`OPENROUTER_*` dan `AUTOPILOT_*` (hanya worker, D047), `KEEPER_KEYPAIR_PATH`, `AGENT_KEYPAIR_PATH`, `PRICE_*`, `JUPITER_API_KEY`, `FINNHUB_API_KEY`, `MCP_HTTP_PORT`, `MCP_PUBLIC`, `MCP_HOST`, `MCP_ALLOWED_HOSTS`, `*_INTERVAL` (semuanya milik worker/MCP standalone).

**Risiko `ADMIN_KEYPAIR_JSON`** (D038): `admin` adalah upgrade authority program, market authority, dan pendana faucet devnet. Menaruhnya di Vercel berarti siapa pun yang punya akses ke project Vercel bisa meng-upgrade program devnet. Hanya pakai bila faucet SOL in-app benar-benar dibutuhkan. Alternatifnya, arahkan juri ke https://faucet.solana.com (pesan faucet sudah menyebutkannya). Bila dipakai, hapus variabelnya setelah penjurian. Aset yang terlibat hanya devnet, tanpa nilai nyata.

**RPC publik**: pilihan terbaik untuk `NEXT_PUBLIC_RPC_URL` adalah key Helius **kedua** dengan *allowed domains* = domain Vercel (dashboard Helius → Access Control), atau endpoint publik devnet (rate-limited, bisa 429 bila ramai). Jangan memakai key yang sama dengan `RPC_URL`.

---

### Token operator (tool `agent_*` di remote MCP)
Token ini adalah kata sandi acak milik operator. Server menyimpannya sebagai `MCP_AGENT_TOKEN`; klien AI mengirimnya sebagai `Authorization: Bearer <token>`. Tanpa token (atau tanpa kunci agent), remote MCP hanya membuka tool baca, simulasi, dan `build_*`.

1. **Buat token** (disimpan ke `.env` sebagai `MCP_AGENT_TOKEN` dan `AGENT_MCP_TOKEN`, ditampilkan sekali):
   ```
   bun run agent:token             # token baru, atau pakai yang sudah ada
   bun run agent:token -- --rotate # ganti token (klien lama tidak berlaku lagi)
   ```
2. **Pasang di server** yang melayani `/api/mcp`:
   - Lokal: cukup restart `bun run dev` / `dev:devnet` (membaca `.env`).
   - Vercel: `bun run vercel:env -- --web-url https://<project>.vercel.app --with-agent`. Perintah ini menulis `MCP_AGENT_TOKEN` dan `AGENT_KEYPAIR_JSON` ke `.env.vercel`. Tempel ke Vercel sebagai *Sensitive*, lalu redeploy. Atau salin token dari langkah 1 secara manual ke `MCP_AGENT_TOKEN` di Vercel.
3. **Pakai di klien**:
   - Claude Code: `claude mcp add --transport http stockbreak https://<web>/api/mcp --header "Authorization: Bearer <token>"`.
   - Agent loop: `AGENT_MCP_URL=https://<web>/api/mcp bun run agent:loop` (token diambil dari `AGENT_MCP_TOKEN`).

Connector Claude.ai/ChatGPT tidak mendukung header kustom. Di sana dipakai mode tanpa token (user menandatangani sendiri), dan itu memang aman untuk publik.

### API key per user (agent milik user, D045)
Berbeda dengan token operator (satu token, satu keypair agent milik server), setiap user yang sign-in bisa membuat **agent sendiri** dari halaman AI (`/agents`) dan membuat API key untuknya, seperti konsol API.

- Server membuat wallet agent baru (seed ed25519) dan menyimpan seed-nya **terenkripsi** AES-256-GCM dengan kunci turunan `AGENT_KEY_SECRET`. API key berbentuk `sbk_…`; yang disimpan hanya hash SHA-256 + prefix, key ditampilkan sekali.
- Klien mengirim `Authorization: Bearer sbk_…` ke `/api/mcp`; tool `agent_*` lalu bertindak sebagai wallet agent milik key itu. Key tidak valid/dicabut → HTTP 401 "Invalid or revoked API key". Rate limit 120 req/menit per key (di samping per IP).
- Batas: 3 agent per user, 5 key aktif per agent. Batas program tetap berlaku (agent manager tidak bisa menarik dana user).
- Konfigurasi: `AGENT_KEY_SECRET` (≥32 karakter). Lokal: `bun run setup` menambahkannya ke `.env` bila belum ada; restart `bun run dev`/`dev:devnet`. Vercel: `bun run vercel:env` menyalinnya dari `.env` ke `.env.vercel`. Semua server yang berbagi DB (lokal `dev:devnet` + Vercel ke Neon yang sama) **wajib** memakai nilai yang sama; mengganti/kehilangan secret membuat agent lama tidak bisa dibuka. Tanpa secret: API mengembalikan 503 "Agent creation is not configured on this server".
- Hanya untuk devnet/localnet (aset simulasi). Untuk produksi, kunci agent sebaiknya dipegang wallet kustodian/MPC (Turnkey, Privy server wallets), bukan server aplikasi.

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

## Opsi C — Cloudflare Workers (web + worker cron, otomatis dari GitHub)

Dipakai sejak D050. Dua Worker dari repo `SkyRizzAI/stockbreak`; Workers Builds mem-build dan men-deploy setiap push ke `main`. Tidak butuh laptop menyala. Butuh **Workers Paid** (paket gratis: CPU 10 ms dan 50 subrequest per request, tidak cukup).

| Worker | Root directory | Isi | URL |
|---|---|---|---|
| `stockbreak` | `apps/web` | Next.js via OpenNext, `/api/*`, MCP remote `/api/mcp`, Blink, OG | `https://stockbreak.fun` (+ `stockbreak.<subdomain>.workers.dev`) |
| `stockbreak-worker` | `apps/worker` | `src/cf.ts`: Cron `* * * * *`, loop worker 40 detik per menit | tanpa URL publik |

DB: Neon Postgres lewat **Hyperdrive** (binding `HYPERDRIVE`, ID di kedua `wrangler.jsonc`). `wrangler.jsonc` tidak berisi rahasia.

### C1. Sekali saja
1. Neon: buat project, salin URL **direct** ke `.env` sebagai `DEVNET_DATABASE_URL`, lalu isi data: `bun run db:remote -- copy` (atau `migrate` untuk DB kosong).
2. Hyperdrive: dashboard → Storage & databases → Hyperdrive → Create, dengan URL Neon direct. Salin ID ke `hyperdrive[0].id` di `apps/web/wrangler.jsonc` dan `apps/worker/wrangler.jsonc`.
3. Domain: `stockbreak.fun` harus ada di akun yang sama (`routes[].custom_domain`); DNS dibuat otomatis saat deploy.

### C2. Hubungkan repo (Workers & Pages → Create → Import a repository), sekali per Worker
| | `stockbreak` | `stockbreak-worker` |
|---|---|---|
| Root directory | `apps/web` | `apps/worker` |
| Build command | `cd ../.. && bun install --frozen-lockfile && bun run db:remote -- migrate && cd apps/web && bun run cf:build` | `cd ../.. && bun install --frozen-lockfile` |
| Deploy command | `bun run cf:deploy` | `bun run cf:deploy` |
| Build variables | `BUN_VERSION=1.4.2`, `SKIP_DEPENDENCY_INSTALL=1`, `CLUSTER=devnet`, `NEXT_PUBLIC_CLUSTER=devnet`, `NEXT_PUBLIC_RPC_URL=https://api.devnet.solana.com`, `NEXT_PUBLIC_WS_URL=wss://api.devnet.solana.com`, `NEXT_PUBLIC_APP_NAME=Stockbreak`, `NEXT_PUBLIC_MCP_URL=https://stockbreak.fun/api/mcp`, `WEB_URL=https://stockbreak.fun`, `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=postgresql://localhost:5432/unused` | `BUN_VERSION=1.4.2`, `SKIP_DEPENDENCY_INSTALL=1` |
| Build secret | `DEVNET_DATABASE_URL` (Neon direct, untuk migrasi) | — |
| Build watch paths | `apps/web/*`, `apps/mcp/*`, `packages/*`, `bun.lock` | `apps/worker/*`, `apps/mcp/*`, `packages/*`, `bun.lock` |

`NEXT_PUBLIC_*` dan `WEB_URL` di-bake saat `next build`, jadi harus menjadi build variable (nilai di `vars` wrangler hanya untuk runtime). Migrasi (`db:remote -- migrate`) idempoten; bila gagal, build gagal dan versi lama tetap live. `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` hanya placeholder: `opennextjs-cloudflare deploy` membuat emulasi lokal binding Hyperdrive dan menolak jalan tanpa nilai ini (tidak pernah dipakai untuk koneksi).

### C3. Secret runtime (Worker → Settings → Variables and Secrets, tipe Secret)
| Worker | Secret |
|---|---|
| `stockbreak` | `RPC_URL` (Helius devnet), `WS_URL`, `AGENT_KEY_SECRET`; opsional `MCP_AGENT_TOKEN` + `AGENT_KEYPAIR_JSON`, `ADMIN_KEYPAIR_JSON` (faucet SOL, lihat risiko D038) |
| `stockbreak-worker` | `RPC_URL`, `WS_URL`, `ADMIN_KEYPAIR_JSON`, `KEEPER_KEYPAIR_JSON`, `AGENT_KEY_SECRET`; opsional `JUPITER_API_KEY`, `FINNHUB_API_KEY`, `PYTH_API_KEY`, `MAINNET_READ_RPC_URL`, `AGENT_LLM_API_KEY` (autopilot) |

Nilai `*_KEYPAIR_JSON` = isi `.keys/<nama>.json` (array 64 byte, satu baris). `AGENT_KEY_SECRET` harus sama di web, worker, dan server lain yang memakai DB yang sama. Secret tetap ada di antara deploy.

### C4. Verifikasi dan operasional
- `bun run check:public -- https://stockbreak.fun` → PASS.
- Log cron: dashboard `stockbreak-worker` → Observability (baris `[worker] window done`).
- **Jangan** menjalankan `bun run worker:devnet` / `dev:devnet` bersamaan dengan cron (harga & keeper dobel). Untuk menghentikan cron sementara: Settings → Triggers → hapus cron (push berikutnya memasangnya lagi).
- Uji lokal runtime Workers: `cd apps/web && bun run cf:preview` (butuh `.dev.vars` + `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=<URL Postgres>`); worker: `cd apps/worker && bunx wrangler dev --test-scheduled` lalu buka `/__scheduled`.
- Workers Paid berakhir → batas CPU 10 ms: web/cron akan gagal. Perpanjang paket atau kembali ke Opsi A/B.

---

## Remote MCP

Endpoint: `https://<web>/api/mcp` (Streamable HTTP, **stateless**, cocok untuk serverless). Health: `https://<web>/api/mcp/health` → `{ok, cluster, agentTools}`. Route ini menjalankan factory server yang sama dengan `apps/mcp` (`@repo/mcp/public`).

| Tool | Tanpa token | Dengan `Authorization: Bearer <MCP_AGENT_TOKEN>` | Dengan `Authorization: Bearer sbk_…` (API key user) |
|---|---|---|---|
| Riset (`list_*`, `get_*`), `simulate_rebalance`, `build_*`, `get_intent_status`, resource `docs://guide` | ya | ya | ya (default wallet = agent key itu) |
| `agent_*` | tidak | ya (keypair agent milik server), bila `AGENT_KEYPAIR_JSON` (atau file `AGENT_KEYPAIR_PATH`) tersedia | ya, sebagai wallet agent milik key itu (butuh `AGENT_KEY_SECRET`) |

Perlindungan: token dibandingkan waktu-konstan (hash SHA-256), CORS `*` (header `Authorization`, `Content-Type`, `Mcp-Session-Id`, `Mcp-Protocol-Version` diizinkan, `Mcp-Session-Id` di-expose), rate limit per IP 60 req/menit (`MCP_RATE_LIMIT`, in-memory per instance) dengan jawaban 429 berbentuk JSON-RPC. Endpoint ini publik by design, jadi tidak ada validasi Host localhost.

### Menghubungkan klien
- **Claude.ai** (web/desktop/mobile): Settings → Connectors → *Add custom connector* → URL `https://<web>/api/mcp`. Tanpa OAuth; konektor mendapat tool publik (baca + `build_*`). Link `signUrl` dibuka user untuk menandatangani di Phantom.
- **ChatGPT**: Settings → Apps & Connectors → Advanced → aktifkan *Developer mode* → *Create* connector → URL `https://<web>/api/mcp`, autentikasi *No authentication*.
- **Claude Code**:
  ```bash
  claude mcp add --transport http stockbreak https://<web>/api/mcp
  # dengan tool agent_* (token dari .env.vercel / pemilik deployment):
  claude mcp add --transport http stockbreak https://<web>/api/mcp --header "Authorization: Bearer <token>"
  ```
- **Inspector**: `bunx @modelcontextprotocol/inspector --cli https://<web>/api/mcp --method tools/list`.

### Tabel URL & environment per layanan
| Variabel | Dipakai oleh | Isi | Default |
|---|---|---|---|
| `WEB_URL` | web (Blink, OG, metadata, cookie), MCP (link `signUrl`, `/i/<index>`, URI metadata), worker | URL publik web | `http://localhost:3000`; Vercel: `https://$VERCEL_PROJECT_PRODUCTION_URL` |
| `MCP_WEB_URL` | MCP (panggilan API web internal `c.web`) | basis API web yang terjangkau dari server MCP | `WEB_URL` |
| `NEXT_PUBLIC_MCP_URL` | web (halaman Agents, snippet setup) | URL MCP publik | origin halaman + `/api/mcp` |
| `RPC_URL` / `WS_URL` | web (server), worker, MCP | RPC Solana server | localnet `127.0.0.1:8899/8900` |
| `NEXT_PUBLIC_RPC_URL` / `NEXT_PUBLIC_WS_URL` | browser | RPC publik | localnet |
| `DATABASE_URL` | web, worker, MCP | Postgres (Neon pooled untuk Vercel) | wajib |
| `DEVNET_RPC_URL`, `DEVNET_DATABASE_URL`, `DEVNET_WEB_URL` | script devnet (`dev:devnet`, `worker:devnet`, `vercel:env`, `check:public`) | nilai devnet yang dipetakan ke tiga variabel di atas | kosong |
| `MAINNET_READ_RPC_URL` | worker (baca harga saja) | RPC mainnet read-only | `api.mainnet-beta.solana.com` |
| `MCP_HTTP_PORT` / `PORT` | MCP standalone | port HTTP | `3333` (lalu `PORT`) |
| `MCP_PUBLIC`, `MCP_HOST`, `MCP_ALLOWED_HOSTS` | MCP standalone | mode publik, alamat bind, allow-list Host | mati, `127.0.0.1`, kosong |
| `MCP_AGENT_TOKEN` | route `/api/mcp`, MCP standalone publik | secret Bearer untuk `agent_*` | kosong = `agent_*` tidak pernah publik |
| `AGENT_KEYPAIR_JSON` / `AGENT_KEYPAIR_PATH` | MCP (semua mode), agent runner | keypair agent | `.keys/agent.json` (lokal) |
| `MCP_RATE_LIMIT` | endpoint MCP publik | req/menit per IP | `60` |
| `AGENT_MCP_URL` / `AGENT_MCP_TOKEN` | agent runner (`scripts/agent-loop.ts`) | URL MCP yang dipakai loop agent + token Bearer | `http://127.0.0.1:3333/mcp`, kosong |

Agent runner ke deployment publik: `AGENT_MCP_URL=https://<web>/api/mcp AGENT_MCP_TOKEN=<MCP_AGENT_TOKEN>`.

### Opsi hosting MCP
1. **Route Vercel (disarankan)**: otomatis ikut deploy web. `bun run vercel:env -- --web-url https://<project>.vercel.app` sudah menulis `NEXT_PUBLIC_MCP_URL` dan `MCP_WEB_URL`. Tambah `--with-agent` untuk membuat `MCP_AGENT_TOKEN` acak baru dan `AGENT_KEYPAIR_JSON` (nilai hanya ditulis ke `.env.vercel`, tidak dicetak). Batas durasi fungsi: 60 s (`maxDuration`).
2. **Host Bun mana pun (Fly, Railway, Render, VPS)**: `bun apps/mcp/src/http.ts` dengan `MCP_PUBLIC=1 MCP_HOST=0.0.0.0` (port dari `PORT`), `MCP_ALLOWED_HOSTS=mcp.domainanda.com`, plus `CLUSTER`, `RPC_URL`, `DATABASE_URL`, `WEB_URL` (link sign), `MCP_WEB_URL` (API web), opsional `MCP_AGENT_TOKEN` + `AGENT_KEYPAIR_JSON`. File `packages/config/deployments/<cluster>.json` harus ikut di image (jalankan dari clone repo). Endpoint `https://<host>/mcp`, health `/health`. Mode publik menerapkan gating token, CORS, dan rate limit yang sama.
3. **Cloudflare Workers: belum layak hari ini** (tidak diimplementasikan). SDK MCP punya shim workerd dan `@solana/kit` berjalan di Workers, tetapi: (a) deployment dibaca dari filesystem (`readDeployment`, `node:fs`) dan keypair dari file; (b) pool postgres.js di-cache global per proses, sedangkan Workers melarang memakai objek I/O lintas request (butuh klien per request + Hyperdrive); (c) server standalone memakai `Bun.serve`. Butuh refactor `packages/config`/`packages/db`; alternatif murah: route Vercel atau host Bun.

Verifikasi: `bun run check:public -- https://<web>` (cek #11 `/api/mcp/health`), lalu `claude mcp add …` dan minta "list the top indexes".

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
`NEXT_OUTPUT_STANDALONE=1 VERCEL=1` + env produksi → `cd apps/web && bun run build` menghasilkan `.next/standalone` dengan file ter-trace yang sama seperti fungsi Vercel. Hasilnya: `packages/config/deployments/*.json` ikut, sedangkan `.env` dan `.keys/` tidak. `node apps/web/server.js` di folder itu lalu `check:public` → PASS 11/11 (sejak D043 termasuk `/api/mcp/health`; lihat STATUS 2026-09-25).

## Sumber resmi
- Vercel package managers (deteksi `bun.lock`): https://vercel.com/docs/package-managers
- Vercel pin versi Bun: https://vercel.com/kb/guide/how-to-pin-a-specific-bun-version-for-vercel-builds
- Vercel monorepo (Root Directory, filtered install): https://vercel.com/docs/monorepos
- Vercel Node.js versions (24.x default): https://vercel.com/docs/functions/runtimes/node-js/node-js-versions
- Vercel file di Functions (`process.cwd()`, tracing): https://vercel.com/kb/guide/how-can-i-use-files-in-serverless-functions
- Next.js output & file tracing (`outputFileTracingRoot/Includes`): https://nextjs.org/docs/app/api-reference/config/next-config-js/output
- Neon + Node/postgres.js (`ssl: 'require'`): https://neon.com/docs/guides/node
- Neon connection pooling (`-pooler`, transaction mode, migrasi via direct): https://neon.com/docs/connect/connection-pooling
- MCP Streamable HTTP transport: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- Claude custom connectors (remote MCP): https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp
- ChatGPT developer mode & MCP connectors: https://platform.openai.com/docs/guides/developer-mode
- Claude Code MCP (`claude mcp add --transport http`, `--header`): https://docs.claude.com/en/docs/claude-code/mcp
- Cloudflare quick tunnel: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/
- cloudflared download (`brew install cloudflared`): https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/
