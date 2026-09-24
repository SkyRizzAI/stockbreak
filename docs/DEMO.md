# DEMO

Panduan demo langkah demi langkah. Semua aset & harga **simulasi**.

- **Bagian A — Localnet (Dev Wallet)**: tanpa wallet eksternal, bisa time-travel.
- **Bagian B — Devnet (Phantom)**: panduan uji manual di Chrome + Phantom. Ditulis di P11.
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
Buka http://localhost:3000. Seed membuat 3 wallet demo (@alice, @bob, @carol), agent "Atlas" dan 7 index (MAG4, AIFR, MEGA, MAGT clone, MAGM follow, ATLS milik agent, DFSP) beserta histori 30 hari.

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
Tunggu `[dev] READY (devnet)`, buka http://localhost:3000. Badge di header harus **Devnet**. Worker, web, dan MCP berjalan di mesin ini tetapi menunjuk devnet; data disimpan di DB `app_devnet`. Harga di-update tiap 60 dtk.

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

## Connect an AI agent

Server MCP Stocklana berjalan otomatis saat `bun run dev` (HTTP `http://127.0.0.1:3333/mcp`, cek `http://127.0.0.1:3333/health`). Semua aset & harga **simulasi** (localnet/devnet). Server menolak cluster selain localnet/devnet dan tidak pernah mengembalikan isi env atau keypair.

### Dua mode
| Mode | Kapan aktif | Tool |
|---|---|---|
| Human-in-the-loop (default) | selalu | `build_join`, `build_redeem`, `build_create_index`, `build_clone` → agent memberi link `/sign?id=…`, user menandatangani di wallet sendiri; `get_intent_status` untuk hasil |
| Agent wallet | `AGENT_KEYPAIR_PATH` diset (default `.env`: `.keys/agent.json`) | `agent_info`, `agent_register`, `agent_create_index`, `agent_join`, `agent_rebalance`, `agent_propose_update` — ditandatangani keypair agent; program vault tetap membatasi (mandate) |

Tool riset (selalu ada): `list_assets`, `list_indexes`, `get_index`, `get_index_performance`, `get_leaderboard`, `get_portfolio`, `simulate_rebalance`. Resource `docs://guide` berisi panduan singkat untuk LLM. Batas nominal per aksi: `MCP_MAX_USDC_PER_ACTION` (default 1000 USDC).

### Claude Code
HTTP (stack `bun run dev` sedang berjalan):
```bash
claude mcp add --transport http stocklana http://127.0.0.1:3333/mcp
```
Stdio (tanpa server HTTP; `.env` di root repo dibaca otomatis):
```bash
claude mcp add --transport stdio stocklana -- bun /ABS/PATH/stocklana/apps/mcp/src/stdio.ts
```
Mode human-in-the-loop saja: tambahkan `--env AGENT_KEYPAIR_PATH=` sebelum `--transport`.

### Claude Desktop
`~/Library/Application Support/Claude/claude_desktop_config.json` (pakai path absolut; Desktop tidak memakai PATH shell — cek `which bun`):
```json
{
  "mcpServers": {
    "stocklana": {
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
- "Cek apakah ATLS perlu rebalance lalu jalankan." → `simulate_rebalance` → `agent_rebalance`
- "Jual AAPLx senilai $80 ke MSFTx di index saya." → bila menjauhkan bobot dari target, program menolak dan agent menerima pesan yang jelas (mis. "That trade would move the index away from its targets.").
