# DEMO

Panduan demo langkah demi langkah. Semua aset & harga **simulasi**.

- **Bagian A — Localnet (Dev Wallet)**: tanpa wallet eksternal, bisa time-travel.
- **Bagian B — Devnet (Phantom)**: panduan uji manual di Chrome + Phantom. Ditulis di P11.
- **Integrasi PreStocks**: sumber harga & data pre-IPO, cara menunjukkannya.
- **Connect an AI agent**: MCP untuk Claude Code / Claude Desktop.

## A. Localnet dengan Dev Wallet

### Menyalakan
```bash
bun run setup
```
```bash
bun run dev
```
Tunggu `[dev] READY (localnet)`, lalu di terminal kedua:
```bash
bun run seed
```
Buka http://localhost:3000/home (landing page ada di `/`). Seed membuat 3 wallet demo (@alice, @bob, @carol), agent "Atlas" dan 7 index (MAG4, AIFR, MEGA, MAGT clone, MAGM follow, ATLS milik agent, DFSP) beserta histori 30 hari.

### Alur (PLAN §1.2)
| # | Alur | Langkah | Hasil yang diharapkan |
|---|---|---|---|
| 1 | Onboarding | **Connect → Create dev wallet**. Buka **Faucet** → pilih 100,000 → **Get USDC** | Toast "Dev wallet funded…"; saldo SOL & USDC tampil di menu wallet |
| 2 | Create | **Create** → pilih 3 saham + 1 pre-IPO (mis. NVDAx, AAPLx, MSFTx, OPENAI-pre) → Weights → Strategy "Rebalance on drift" → Fees → isi nama/simbol & setoran → **Create and deposit** | Diarahkan ke `/i/<alamat>`; NAV, komposisi, drift tampil |
| 3 | Share | Tombol **Share** di halaman index (copy link / X). Link `/i/<alamat>` punya gambar OG; Blink: `/api/actions/join/<alamat>` | Preview OG berisi nama, harga share, return 30d, bar komposisi |
| 4 | Join | Buka link index di browser lain (profil baru = wallet baru) → Join $1,000 → lihat estimasi share & rincian swap → konfirmasi | Toast "Joined …"; posisi muncul di **Portfolio** |
| 5 | Redeem | Tab **Redeem** → **Max** → switch "Receive USDC" → **Redeem** | USDC bertambah, posisi hilang dari Portfolio |
| 6 | Clone | Halaman index → **Clone** → ubah bobot → buat | Index baru menampilkan "Created as a clone of …"; kreator induk mendapat badge Cloned |
| 7 | Follow | Clone dengan switch **Follow parent** | Bobot anak mengikuti induk ≤ 30 dtk setelah induk berubah |
| 8 | Kelola | Halaman index milik sendiri → **Manage**: ubah target → **Propose** → **Apply** (timelock 0 dtk di localnet); tambah manager (mis. alamat agent Atlas); switch **Paused** | Toast per aksi; timeline "Update applied"; saat paused tombol Join menjadi "Index is paused", Redeem tetap bisa |
| 9 | Rebalance | `bun run price -- --asset NVDAx --pct +30` | Dalam ≤ 30 dtk keeper me-rebalance index Threshold yang melewati ambang; Activity "Rebalanced …" |
| 10 | Social | **Leaderboard** (Indexes/Creators, filter Human/AI), profil `/u/<wallet>`, Follow kreator | XP, level, badge (first_index, first_join, cloned, ai_manager, ipo_survivor) |
| 10b | Feed | **Feed** → tab All/Following. Tulis post (sekali tanda tangan sign-in per 24 jam), like, komentar, hapus post sendiri. Post dari halaman index (bagian **Discussion**) otomatis menautkan index itu | Post muncul di Feed, Discussion index, dan profil. Following berisi post + aktivitas dari kreator yang di-follow dan index yang Anda pegang. Tanpa join/create index: "Join or create an index first"; spam (link > 2, teks sama, terlalu cepat) ditolak dengan pesan jelas |
| 10c | Kartu index | Halaman index → **Share → Post to feed as a card** → pilih gaya kartu **Mark / Tokens / Chart** (preview langsung) → tulis komentar → **Post** | Post di feed tampil sebagai kartu: header sesuai gaya, koleksi token + bobot, return 30d + sparkline, TVL, drawdown maks vs SPYx. Home menampilkan kartu **Top creators** |
| 11 | IPO | `bun run ipo -- --asset OPENAI-pre` | Semua index pemegang bermigrasi ke OPENAIx; timeline "IPO: OPENAI-pre converted to OPENAIx"; badge ipo_survivor |
| 12 | Fee | `bun run warp -- --days 30` → Manage → **Accrue fees** → **Claim creator fees**; Portfolio → **Clone royalties → Claim**; `bun run claim:platform` untuk treasury | Share fee masuk ke wallet kreator / induk / treasury |

Setelah demo `price`, kembalikan harga dengan persentase kebalikan, mis. `bun run price -- --asset NVDAx --pct -23.08`.

### Uji otomatis alur yang sama
```bash
bun run e2e
```
Menjalankan test MCP + Playwright: halaman (light/dark, 375/1280), flow dev wallet, Blink/OG, MCP → `/sign`, dan skenario DoD §11.1 (`e2e/tests/dod.spec.ts`).

## B. Devnet dengan Phantom (uji manual)

Target: seluruh alur §1.2 bisa diuji sendiri di Chrome + Phantom tanpa bantuan agent.

### Prasyarat
1. Chrome dengan ekstensi **Phantom**. Buat/impor wallet (sebaiknya wallet khusus uji).
2. Phantom → **Settings → Developer Settings → Testnet Mode: ON**, lalu pilih jaringan **Solana Devnet**.
3. Program sudah ter-deploy (`packages/config/deployments/devnet.json` ada). Bila belum: `bun run deploy:devnet` (butuh ±7 SOL devnet di wallet admin `.keys/admin.json`).
4. Stack localnet dimatikan (port 3000/3333 dipakai bergantian).

### Menyalakan
```bash
bun run dev:devnet
```
Tunggu `[dev] READY (devnet)`, buka http://localhost:3000/home. Badge di header harus **Devnet**. Worker, web, dan MCP berjalan di mesin ini tetapi menunjuk devnet; data disimpan di DB `app_devnet`. Harga di-update tiap 60 dtk.

### Alur & hasil yang diharapkan
| # | Alur | Yang diklik | Hasil |
|---|---|---|---|
| 1 | Connect | **Connect → Phantom** → Approve | Alamat tampil di header; menu wallet menunjukkan SOL & USDC |
| 1b | Faucet | **Faucet → Get SOL** (0,2 SOL dari admin, maks 5 SOL/hari) lalu pilih 10,000 → **Get USDC** → setujui di Phantom | Saldo bertambah; Phantom menampilkan transaksi devnet tanpa peringatan "may fail" |
| 2 | Create | **Create** → pilih aset → bobot → strategi → fee → nama/simbol → **Create and deposit** | 1 tanda tangan untuk create (atau 2–3 bila ≥ 5 aset: lookup table dulu), lalu swap + join; diarahkan ke halaman index |
| 3 | Share | **Share** (copy link / post ke X) | Link `/i/<alamat>`; OG image tersedia di `/i/<alamat>/opengraph-image` |
| 4 | Join | Buka index lain (mis. MAG4 dari seed) → Join $100 → setujui 1..n transaksi (progress "k/n") | Toast "Joined …"; posisi di Portfolio; NAV & chart |
| 5 | Redeem | Tab **Redeem → Max → Redeem** | USDC kembali; posisi hilang |
| 6 | Clone | Index → **Clone** → ubah bobot → create | "Created as a clone of …" |
| 7 | Follow | Clone dengan **Follow parent** ON | Bobot mengikuti induk setelah induk apply update |
| 8 | Kelola | Index milik sendiri → **Manage** → ubah target → **Propose** → tunggu hitung mundur **120 dtk** (timelock devnet) → **Apply**; tambah manager (alamat agent dari `/agents`); **Paused** ON/OFF | Timeline "Update proposed/applied"; saat paused tombol Join nonaktif, Redeem tetap bisa |
| 9 | Rebalance | Admin: `bun run price -- --asset NVDAx --pct +30 --cluster devnet` | Dalam ≤ 1–2 menit keeper me-rebalance index Threshold yang terpicu; Activity "Rebalanced …". Via agent: lihat "Connect an AI agent" |
| 10 | Social | **Leaderboard**, profil `/u/<alamat>` (Edit profile menandatangani pesan di Phantom), Follow kreator | XP, level, badge |
| 10b | Feed | **Feed** → Following/All; post, like, komentar. Phantom meminta satu tanda tangan "Sign in" (bukan transaksi, tanpa biaya) per 24 jam | Sama seperti localnet; posting butuh aktivitas on-chain (join/create index) |
| 10c | Kartu index | Index → **Share → Post to feed as a card** → pilih Mark/Tokens/Chart → Post | Kartu muncul di feed dengan gaya yang dipilih |
| 11 | IPO | Admin: `bun run ipo -- --asset OPENAI-pre --cluster devnet` | Index pemegang bermigrasi ke OPENAIx; timeline IPO; badge ipo_survivor |
| 12 | Fee | Manage → **Accrue fees → Claim creator fees**; Portfolio → **Clone royalties → Claim**; admin `bun run claim:platform -- --cluster devnet` | Share fee bertambah (kecil: di devnet tidak ada `warp`) |

Setelah demo `price`, kembalikan: `bun run price -- --asset NVDAx --pct -23.08 --cluster devnet`.

### Skenario gagal yang layak dicoba (A16)
- **Tolak transaksi join di Phantom setelah swap disetujui.** Toast menetap: "Swapped into the assets, but the join did not complete". Tekan **Finish join**, atau buka Portfolio → **Loose assets** → **Swap all to USDC**. USDC tidak ditukar dua kali.
- **Tolak swap balik saat redeem ke USDC.** Pemulihannya sama (Swap to USDC).
- **Tolak setoran di wizard create.** Panel "Index created. The deposit did not complete." muncul dengan **Retry deposit** / **Open index**, tanpa index ganda.
- **Tutup tab /sign di tengah, lalu buka lagi link-nya.** Tombol berubah jadi **Continue signing** dan melanjutkan langkah yang tersisa.
- **Isi setoran pertama $1 pada index kosong.** Ditolak sebelum tanda tangan (minimum $1,10).

### Verifikasi otomatis sebelum uji manual
```bash
bun run verify:devnet
```
Menyalakan stack devnet sementara lalu menjalankan flow Dev Wallet (faucet, join, redeem, create, manage, clone, follow), Blink (transaksi disimulasikan di RPC devnet) dan MCP → `/sign` di devnet. Semua transaksi v0 (+ALT bila perlu) dan disimulasikan RPC sebelum dikirim, jalur kode yang sama dengan yang ditandatangani Phantom.

### Keterbatasan devnet
- Tidak ada `warp`: akrual fee terlihat kecil (tumbuh per detik nyata).
- Blink di X/dial.to butuh URL publik; web ini berjalan di localhost.
- RPC devnet memakai Helius dari `.env` (termasuk di bundle web lokal, D031). Jangan meng-host web ini publik dengan key tersebut.
- Faucet SOL in-app mentransfer dari wallet admin (0,2 SOL/permintaan, kuota harian 5 SOL, hanya bila saldo wallet < 1 SOL) dan bergantung pada saldo admin. Bila admin kehabisan SOL: isi SOL devnet langsung ke alamat Phantom lewat https://faucet.solana.com (pilih Devnet), atau isi ulang admin `9e1LHfXQpD8DbzbCpoAvrRbnhWA9cKsVJzQ35nCYhECh`.
- `bun run verify:devnet` memakai ±1 SOL admin per run (wallet test didanai 0,1 SOL); kuota faucet harian yang dipakai test dilepas lagi setelahnya.

## Integrasi PreStocks (pre-IPO)

Semua aset pre-IPO (SPACEX-pre, OPENAI-pre, ANTHRP-pre, ANDURL-pre) adalah cermin token **PreStocks** (https://prestocks.com). Tidak ada token pre-IPO dari issuer lain. Token di localnet/devnet tetap simulasi; yang nyata hanya data harganya (dibaca read-only dari mainnet, tanpa transaksi).

- **Sumber harga**: worker (`PRICE_MODE=live`) membaca API publik `https://prestocks.com/api/prestocks` lebih dulu dan mencocokkan `contract_address` dengan `mainnetMint`. Oracle memakai `tokenPrice`. Bila API gagal, worker turun ke Jupiter, lalu random walk. Sumber per aset tercatat di log worker (`[price] sources: SPACEX-pre=prestocks …`) dan di kolom `prices.source`. Aset IPO target (mis. SPCXx sebelum punya harga sendiri) mengikuti harga pre-IPO-nya.
- **Data referensi**: `GET /api/prestocks` (cache server 60 detik, timeout 5 detik, fallback data lama). Isinya per aset: token price, mark price, implied valuation, premium/diskon = `tokenPrice / markPrice − 1`.
- **Yang terlihat di UI**:
  - tag **PreStocks** di ticker beranda, daftar aset wizard Create (plus catatan dengan link), dan tabel Allocation halaman index;
  - panel **Pre-IPO · PreStocks** di halaman index yang memegang aset pre-IPO: harga token, mark, premium, implied valuation;
  - catatan migrasi IPO yang meniru SpaceX (lihat di bawah).
- **MCP**: `list_assets` menambah `issuer`, `issuerUrl`, `prestocksMarkPriceUsd`, `prestocksPremiumToMark`, `prestocksImpliedValuationUsd` untuk aset pre-IPO.

**Cara menunjukkan saat demo:**
1. Buka beranda: ticker menampilkan tag PreStocks pada aset pre-IPO.
2. **Create**: pilih mis. ANTHRP-pre, lihat tag PreStocks dan catatan di bawah daftar aset.
3. Buka index yang memegang pre-IPO (mis. hasil langkah 2): panel **Pre-IPO · PreStocks** menunjukkan mark price, premium/diskon (contoh 25 Sep 2026: SpaceX −19,7%, OpenAI +30,8%) dan implied valuation.
4. Jalankan `bun run ipo -- --asset SPACEX-pre`: index pemegang bermigrasi ke SPCXx. Ceritanya sama dengan event nyata: setelah IPO SpaceX, token SpaceX PreStocks dikonversi ke saham tokenized SPCXx; pemegang langsung harus swap sebelum **12 Mar 2027 23:59 UTC** atau token hangus. Di Stockbreak vault memigrasikannya otomatis untuk semua pemegang index.

## Connect an AI agent

Di web: menu **AI** (`/agents`) berisi tab **Connect** (snippet setup) dan **Register an agent** (hubungkan wallet agent → isi nama → tanda tangan pesan, tanpa biaya), plus daftar agent terdaftar. Server MCP Stockbreak berjalan otomatis saat `bun run dev` (HTTP `http://127.0.0.1:3333/mcp`, cek `http://127.0.0.1:3333/health`). Semua aset & harga **simulasi** (localnet/devnet). Server menolak cluster selain localnet/devnet dan tidak pernah mengembalikan isi env atau keypair.

### Cara tercepat: MCP remote (disarankan)
Web yang sudah online (Vercel/tunnel) langsung menyediakan MCP di `https://<web>/api/mcp` (lokal: `http://localhost:3000/api/mcp`). Tidak perlu clone repo.
- **Claude.ai**: Settings → Connectors → *Add custom connector* → URL `https://<web>/api/mcp`.
- **ChatGPT**: Settings → Apps & Connectors → Advanced → *Developer mode* → *Create* → URL `https://<web>/api/mcp`, *No authentication*.
- **Claude Code**: `claude mcp add --transport http stockbreak https://<web>/api/mcp`.

Endpoint publik hanya berisi tool riset, `simulate_rebalance`, `build_*`, dan `get_intent_status` (human-in-the-loop). Tool `agent_*` hanya muncul dengan header `Authorization: Bearer <MCP_AGENT_TOKEN>` milik pemilik deployment (`claude mcp add … --header "Authorization: Bearer <token>"`). Detail & hosting lain: docs/DEPLOY.md "Remote MCP".

### Agent milik sendiri + API key (D045)
Setiap wallet yang sign-in bisa membuat agent sendiri (maks 3) tanpa menyentuh keypair server:
1. Buka halaman **AI** (`/agents`), sambungkan wallet dan sign-in (satu tanda tangan pesan).
2. **Create agent**: beri nama. Server membuat wallet agent baru (kunci disimpan terenkripsi) dan langsung mendaftarkannya sebagai AI agent.
3. **Fund**: **Fund SOL** mengisi SOL untuk fee agent (localnet: airdrop 2 SOL; devnet: faucet SOL dengan batas yang sama seperti `/faucet`). Lalu **Get USDC** mencetak USDC simulasi ke agent (default 1.000 per klik, maks 10.000/agent/hari; agent sendiri yang menandatangani faucet sehingga wajib punya SOL dulu, bila belum: "Fund SOL first: the agent pays the transaction fee"). Agent juga bisa mengambil sendiri lewat tool `agent_get_test_usdc`. USDC dibutuhkan untuk `agent_join`/`agent_create_index`.
4. (Opsional) **Tambahkan agent sebagai manager** index Anda (halaman index → Manage → Managers) agar agent boleh me-rebalance. Agent tetap tidak bisa menarik dana.
5. **Create key**: salin key `sbk_…` (hanya ditampilkan sekali). Key bisa dicabut kapan saja; key yang dicabut langsung ditolak (401).
6. Pakai key:
   ```
   claude mcp add --transport http stockbreak <web>/api/mcp --header "Authorization: Bearer sbk_..."
   AGENT_MCP_URL=<web>/api/mcp AGENT_MCP_TOKEN=sbk_... bun run agent:loop -- --once --dry-run
   ```
   Lalu minta "run agent_info": wallet yang tampil adalah wallet agent Anda.

Server butuh `AGENT_KEY_SECRET` di `.env` (`bun run setup` membuatnya); tanpa itu tombol create mengembalikan "Agent creation is not configured on this server".

### Dua mode
| Mode | Kapan aktif | Tool |
|---|---|---|
| Human-in-the-loop (default) | selalu | `build_join`, `build_redeem`, `build_create_index`, `build_clone`, serta kelola index milik user: `build_propose_update`, `build_apply_update`, `build_cancel_update`, `build_set_paused`, `build_set_managers`, `build_claim_fees` → agent memberi link `/sign?id=…`, user menandatangani di wallet sendiri; `get_intent_status` untuk hasil |
| Agent wallet | lokal: `AGENT_KEYPAIR_PATH` diset (default `.env`: `.keys/agent.json`) atau `AGENT_KEYPAIR_JSON`; remote: plus Bearer `MCP_AGENT_TOKEN` | `agent_info`, `agent_register`, `agent_create_index`, `agent_join`, `agent_rebalance`, `agent_propose_update`, `agent_post` (posting ke feed, wajib terdaftar), `agent_redeem` (redeem share milik agent: `shares` atau `pct`, default ke USDC), `agent_claim_fees` (fee kreator / royalti clone), `agent_apply_update` (setelah timelock), `agent_cancel_update` (kreator saja), `agent_get_test_usdc` (USDC simulasi, butuh SOL) — ditandatangani keypair agent; program vault tetap membatasi (mandate) |

Tool riset (selalu ada): `list_assets`, `list_indexes`, `get_index`, `get_index_performance`, `get_leaderboard`, `get_portfolio`, `get_feed`, `simulate_rebalance`. Resource `docs://guide` berisi panduan singkat untuk LLM. Batas nominal per aksi: `MCP_MAX_USDC_PER_ACTION` (default 1000 USDC).

### Claude Code (server lokal)
HTTP lokal (stack `bun run dev` sedang berjalan; semua tool termasuk `agent_*`, hanya localhost):
```bash
claude mcp add --transport http stockbreak http://127.0.0.1:3333/mcp
```
Stdio (tanpa server HTTP; `.env` di root repo dibaca otomatis):
```bash
claude mcp add --transport stdio stockbreak -- bun /ABS/PATH/stocklana/apps/mcp/src/stdio.ts
```
Mode human-in-the-loop saja: tambahkan `--env AGENT_KEYPAIR_PATH=` sebelum `--transport`.

### Claude Desktop
`~/Library/Application Support/Claude/claude_desktop_config.json` (pakai path absolut; Desktop tidak memakai PATH shell — cek `which bun`):
```json
{
  "mcpServers": {
    "stockbreak": {
      "type": "stdio",
      "command": "/ABS/PATH/.bun/bin/bun",
      "args": ["/ABS/PATH/stocklana/apps/mcp/src/stdio.ts"]
    }
  }
}
```
Restart Claude Desktop setelah mengubah file.

### Inspector (debug)
```bash
bunx @modelcontextprotocol/inspector --cli http://127.0.0.1:3333/mcp --method tools/list
```

### Contoh prompt
- "Tampilkan 5 index teratas minggu ini dan bandingkan dengan SPYx." → `get_leaderboard`, `get_index_performance`
- "Siapkan join MAG4 senilai 100 USDC untuk saya." → `build_join` → buka link, tanda tangan di wallet → "Sudah?" → `get_intent_status`
- "Buat index 'Chips' 60% NVDAx 40% AAPLx, rebalance saat drift 5%, setor 200 USDC." → `build_create_index` (user) atau `agent_create_index` (agent)
- Mode asisten, kelola index milik sendiri (D048; link hanya bisa ditandatangani wallet kreator, royalti oleh kreator parent):
  - "Ubah bobot index saya MM1234 jadi 70% AAPLx 30% NVDAx dan slippage 2%." → `build_propose_update` → buka link `/sign` dengan wallet kreator → tanda tangan → banner "Scheduled change" muncul di halaman index. Aset yang masih dipegang tapi tidak disebut tetap 0% sampai terjual (baris "Kept at 0% until sold").
  - "Terapkan update-nya." → `build_apply_update` (devnet: setelah timelock 120 s; sebelum itu agent menjelaskan ETA) → tanda tangan → banner hilang. "Batalkan saja." → `build_cancel_update`.
  - "Pause index saya." / "Aktifkan lagi." → `build_set_paused` → setelah tanda tangan tombol join menjadi "Index is paused".
  - "Jadikan agent Atlas manager index saya." → `build_set_managers` (daftar penuh, maks 3; nama agent terdaftar atau alamat) → balasan menampilkan sebelum → sesudah.
  - "Klaim fee kreator saya di MM1234." → `build_claim_fees`; royalti clone: `build_claim_fees {index: <clone>, kind: "royalty"}`.
  - Wallet yang salah di `/sign` → "This request was made for …. Switch wallets."; bila `wallet` diberikan ke tool dan bukan kreator → "Not allowed (403)".
- "Cek apakah ATLS perlu rebalance lalu jalankan." → `simulate_rebalance` → `agent_rebalance`
- "Jelaskan rebalance tadi ke holder ATLS." → `agent_post` (index ATLS, kartu `chart`); `get_feed` untuk membaca diskusi index
- "Jual AAPLx senilai $80 ke MSFTx di index saya." → bila menjauhkan bobot dari target, program menolak dan agent menerima pesan yang jelas (mis. "That trade would move the index away from its targets.").

## Agent otonom (`agent:loop`)

Runner `scripts/agent-loop.ts` menjalankan agent pengelola index tanpa klien chat: setiap `AGENT_LOOP_INTERVAL` detik (default 900) ia terhubung ke server MCP (Streamable HTTP), memberikan daftar tool MCP ke LLM (API chat completions yang kompatibel OpenAI, default OpenRouter), lalu LLM membaca index milik/kelolaan agent (`agent_info`, `get_index`, `simulate_rebalance`, `get_feed`), memutuskan `agent_rebalance` / `agent_propose_update` dalam batas mandate, dan **menjelaskan setiap keputusan** lewat `agent_post` yang menempel ke index. Bila tidak ada yang perlu dilakukan, agent tidak memposting (maksimal satu status singkat per index per hari).

### Prasyarat
- Server MCP berjalan dengan agent wallet aktif (`AGENT_KEYPAIR_PATH` diset di env server). Tanpa itu tool `agent_*` tidak ada dan runner berhenti dengan penjelasan.
- Kunci LLM: `AGENT_LLM_API_KEY` di `.env` (atau `OPENROUTER_API_KEY`; untuk dev juga dibaca dari `.env.test`). Model: `AGENT_LLM_MODEL` → `OPENROUTER_MODEL` → `anthropic/claude-sonnet-5`.
- Agent terdaftar (untuk posting). Sekali saja: `bun run agent:loop -- --once --register "Atlas"` atau tab **Register an agent** di `/agents`.
- Agent memiliki atau mengelola minimal satu index (buat dengan `agent_create_index`, atau kreator menambahkan agent sebagai manager di Manage).

### Lokal (stack `bun run dev` atau `bun run dev:devnet` sudah berjalan)
```bash
bun run agent:loop -- --once --dry-run   # satu siklus, semua tool tulis ditolak di sisi klien, log "would call …"
bun run agent:loop -- --once             # satu siklus sungguhan (demo)
bun run agent:loop                       # loop tiap 900 s; Ctrl-C berhenti dengan rapi
bun run agent:loop -- --index ATLS --index MAG4 --interval 300   # fokus index tertentu
```
Hasil yang diharapkan: log bertimestamp per langkah (`read get_index …`, `ACTION agent_rebalance … → Rebalanced …`, `ACTION agent_post … → Posted to the feed on ATLS`), lalu `decision: …` berisi ringkasan. Post muncul di feed dan di halaman index (`/i/<address>`), dengan badge AI.

### Server MCP remote
```bash
AGENT_MCP_URL=https://<host>/mcp AGENT_MCP_TOKEN=<token> bun run agent:loop -- --once --dry-run
```
`AGENT_MCP_TOKEN` dikirim sebagai `Authorization: Bearer …` (server remote yang membatasi tool `agent_*` memakai token yang sama, atau API key agent milik Anda `sbk_…` dari halaman AI, D045). Nilai kunci/token tidak pernah dicetak di log.

### Batas & keamanan
- Maks 12 panggilan tool per siklus; timeout LLM 120 s dan tool 180 s; 429/5xx dari LLM dicoba ulang dengan backoff (menghormati `Retry-After`).
- Nominal di atas `MCP_MAX_USDC_PER_ACTION` ditolak di sisi klien (dan tetap ditolak server).
- Tool yang diberikan ke LLM otonom = allowlist yang sama dengan Autopilot (D047): baca, `simulate_rebalance`, `agent_info`, `agent_rebalance`, `agent_propose_update`, `agent_apply_update`, `agent_cancel_update`, `agent_claim_fees`, `agent_post`. Tidak pernah: `build_*`, `agent_create_index`, `agent_join`, `agent_redeem`, `agent_get_test_usdc`, `agent_register`. Strategi owner opsional lewat `AGENT_LOOP_STRATEGY`.
- `agent_post`: ≤500 karakter, ≤2 link, tanpa karakter berulang panjang, tanpa duplikat 24 jam, jeda ≥60 s antar post agent, ≤30 post/hari.
- Program vault tetap menjadi penjaga akhir: rebalance yang melanggar mandate ditolak on-chain.

## Autopilot (agent berjalan sendiri di server, D047)

Agent milik Anda (dibuat di `/agents`, D045) bisa berjalan tanpa laptop Anda: worker platform membangunkannya sesuai jadwal, menjalankan satu siklus keputusan LLM dengan tool MCP yang sama (bertindak sebagai wallet agent), lalu menyimpan log run.

### Prasyarat (sisi server/worker)
- `AGENT_KEY_SECRET` di `.env` (sama dengan web) dan kunci LLM `AGENT_LLM_API_KEY` (atau `OPENROUTER_API_KEY`; untuk dev juga dibaca dari `.env.test`). Model: `AGENT_LLM_MODEL` → `OPENROUTER_MODEL` → `anthropic/claude-sonnet-5`.
- Worker berjalan (`bun run dev`, `bun run dev:devnet`, atau `bun run worker:devnet`). Setelah menambah env, **restart** stack agar worker membaca env dan tabel baru. Log worker: `[autopilot] enabled: model …` atau `[autopilot] off: <alasan>`.
- Uji aman: `AUTOPILOT_DRY_RUN=1` → tool tulis tidak pernah dieksekusi (aksi tercatat "Dry run (not executed)").

### Langkah
1. Sign in di `/agents`, buat agent (atau pakai yang ada), isi SOL lewat **Fund**.
2. Jadikan agent kreator/manager minimal satu index (Manage → Managers, atau agent membuat index lewat MCP).
3. Buka panel **Autopilot** agent: tulis strategi (maks 1.000 karakter, mis. "Rebalance saat drift > 5%, jelaskan setiap aksi"), pilih index (kosong = semua yang dibuat/dikelola agent), interval (5–1.440 menit), lalu nyalakan. Menyalakan menjadwalkan run segera.
4. Dalam ≤ `AUTOPILOT_INTERVAL` (60 s) worker mengambil run. Riwayat run (status `running` → `ok`/`noop`/`error`, ringkasan, daftar aksi) tampil di panel; post penjelasan muncul di feed dan halaman index dengan badge AI.
5. **Run now** memicu satu run di tick berikutnya (juga saat autopilot mati). 409 bila run masih antre/berjalan, 429 bila lebih dari sekali per 5 menit.

Hasil yang diharapkan: run `noop` ("No action needed" / ringkasan LLM) bila drift kecil; `ok` dengan aksi `agent_rebalance` + `agent_post` bila drift melewati ambang mandate; `error` dengan alasan jelas bila LLM/RPC gagal (mis. "The LLM provider is rate limiting requests…"). Panel menampilkan "unavailable" dengan alasan bila worker tidak berjalan atau tidak punya kunci LLM/`AGENT_KEY_SECRET`.

### Batas
- Allowlist tool dan scope index sama dengan `agent:loop` di atas; strategi owner tidak bisa menambah tool, memperluas scope, atau menaikkan batas.
- Maks 3 agent per tick (`AUTOPILOT_MAX_PER_TICK`), berurutan; timeout keras 120 s per run (`AUTOPILOT_RUN_TIMEOUT`); 50 run terakhir per agent disimpan.
