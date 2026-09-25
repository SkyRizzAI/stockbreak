# PLAN.md

Dokumen ini adalah satu-satunya sumber instruksi untuk membangun project ini dari repository kosong sampai siap dites. Dibaca dan dikerjakan oleh AI agent secara otonom.

---

## 0. Cara kerja agent (baca pertama)

### 0.1 Langkah pertama
1. Baca seluruh dokumen ini sampai habis sebelum menjalankan apa pun.
2. Jika `CLAUDE.md` belum ada di root, buat dari **Lampiran A** (salin persis).
3. Buat folder `docs/analysis/`, `docs/plans/`, lalu file `docs/STATUS.md` (checklist semua fase di §10 + DoD di §11) dan `docs/DECISIONS.md` (log keputusan).
4. Kerjakan fase P0 → P12 berurutan (§10). Setiap fase: tulis analisis yang diwajibkan (§9) → tulis plan fase dari **Lampiran B** → implementasi → jalankan gate fase → update `STATUS.md` (entri Log; agent tidak commit — user yang mengelola git).

### 0.2 Aturan otonom
- **Jangan berhenti** sampai seluruh Definition of Done (§11) hijau. Tidak ada titik "menunggu konfirmasi user".
- Jika ada ambiguitas: pilih opsi yang paling sesuai dokumen ini, paling sederhana, dan paling mudah dites. Catat di `docs/DECISIONS.md` (tanggal, konteks, opsi, pilihan, alasan). Lanjut.
- Jika sebuah langkah gagal: baca error, perbaiki, ulangi. Setelah 3 pendekatan berbeda gagal, pilih fallback yang tercantum di dokumen ini (atau buat fallback yang setara), catat di `DECISIONS.md`, lanjut ke pekerjaan lain, dan kembali lagi di fase P12.
- Jika butuh sesuatu dari luar yang tidak tersedia (mis. Docker tidak ada, faucet devnet limit): gunakan fallback, tandai item terkait di `STATUS.md` sebagai `BLOCKED(eksternal): alasan`, lanjut. Item `BLOCKED(eksternal)` hanya boleh untuk hal yang memang di luar kendali kode.
- Boleh memakai subagent paralel untuk pekerjaan yang tidak saling bergantung setelah kontrak dibekukan (akhir P2), dengan aturan kepemilikan file di Lampiran A.
- Agent **tidak** menjalankan `git commit`/`push`/`config`. Kemajuan dicatat di Log `STATUS.md`. Repo harus selalu bisa di-build di akhir setiap fase.
- **Batas sistem lokal** (lihat bagian "Batas sistem lokal" di `CLAUDE.md`): hanya menulis di repo + `/tmp`/scratchpad + cache standar tool; config global Solana tidak pernah diubah (selalu `-C .keys/solana-cli.yml` / `-k .keys/*.json` / `-u` eksplisit); toolchain boleh diubah hanya bila perlu dan dicatat.
- Semua kebutuhan dari user (SOL devnet di wallet admin, keputusan produk) sudah dipenuhi sebelum eksekusi. Tidak ada titik berhenti untuk bertanya di tengah; bila saldo SOL devnet ternyata kurang di P11, coba `solana airdrop` beberapa kali dengan jeda, bila tetap gagal tandai `BLOCKED(eksternal)` dan selesaikan sisanya.

### 0.3 Aturan setup/scaffold (wajib)
- **Semua inisialisasi project memakai command resmi** (CLI generator resmi tool tersebut). Dilarang membuat file init secara manual (mis. menulis `package.json`, `next.config`, `components.json`, `Anchor.toml`, `drizzle.config` dari nol) bila tool menyediakan command init.
- **Sebelum menjalankan command setup apa pun, baca dokumentasi resmi terbaru tool itu** (WebFetch ke docs resmi) untuk command, flag, dan versi terkini. Jangan memakai command dari ingatan. Tulis sumbernya di `docs/analysis/A01-toolchain.md`.
- Prioritas: command dengan Bun (`bun create …`, `bunx …`, `bun add …`) bila docs tool mendukungnya. Jika docs hanya memberi contoh npm/npx, pakai padanan Bun (`bunx`) dan verifikasi berjalan.
- Edit konfigurasi hasil generator diperbolehkan (setelah dibuat oleh command resmi).
- Repo tidak kosong saat scaffold (sudah ada `CLAUDE.md` dan `docs/` berisi `PLAN.md`). Bila generator menolak direktori tidak kosong, jalankan generator di direktori sementara lalu pindahkan hasilnya. Selalu matikan inisialisasi git bawaan generator (flag `--no-git`/`--disable-git` atau padanannya) agar tidak ada `.git` bersarang. Hapus bawaan template yang bertentangan dengan dokumen ini (mis. app contoh `docs`, ESLint bila memakai Biome, dependensi Anchor TS bawaan).
- Catat versi semua tool & library utama di `docs/VERSIONS.md`.

---

## 1. Produk

Platform index saham tokenized di Solana. Siapa pun (manusia atau AI agent) bisa membuat **index** (keranjang saham tokenized dengan bobot target), membagikannya, dan orang lain bisa ikut. Kreator mendapat fee. Rebalance berjalan otomatis lewat vault program on-chain dengan aturan (mandate) yang ditegakkan program, sehingga tidak ada pihak mana pun yang memegang dana user. Ada leaderboard, profil, XP, dan badge. AI agent eksternal (Claude, Cursor, dll.) berinteraksi lewat MCP.

Semua aset adalah **simulasi** (mock) di localnet/devnet dengan harga yang mengikuti harga nyata.

### 1.1 Istilah (pakai kata yang sama di kode, UI, dan dokumen)

| Istilah | Arti |
|---|---|
| Index | Keranjang aset dengan bobot target, disimpan di satu vault program |
| Share token | Token milik index. Pegang share = pegang bagian proporsional isi vault |
| Join | Masuk ke vault bersama: setor aset, terima share token (model patungan) |
| Redeem | Bakar share token, terima bagian aset |
| Clone | Buat index baru milik sendiri dengan komposisi disalin dari index lain; induk dapat royalty |
| Follow | Index pribadi yang otomatis menyalin perubahan bobot induknya (model copy-trade, vault masing-masing) |
| Mandate / strategy | Aturan yang ditegakkan program: slippage maks, ambang drift, periode, cooldown, siapa yang boleh rebalance, timelock perubahan |
| Manager | Wallet yang diizinkan kreator untuk rebalance (biasanya wallet AI agent). Tidak bisa menarik dana atau mengubah index |
| Keeper | Bot permissionless yang menjalankan rebalance saat strategi terpicu |
| Zap | "Join pakai USDC" dalam satu alur: swap USDC ke tiap komponen lalu Join. Zap out: Redeem lalu swap ke USDC |
| Oracle | Akun harga on-chain yang dibaca program |
| Pre-IPO | Aset token perusahaan yang belum IPO. Saat event IPO, token dikonversi ke token saham dan index bermigrasi |

### 1.2 Alur utama pengguna
1. **Onboarding**: buka app → connect wallet (Phantom/Solflare/Backpack/Wallet Standard lain, atau Dev Wallet di localnet/devnet) → ambil USDC simulasi dari Faucet.
2. **Create index**: pilih aset → atur bobot → pilih strategi → atur fee → isi nama/simbol/deskripsi → tanda tangan → (opsional) setoran awal lewat zap.
3. **Share**: link `/i/{index}`, gambar OG otomatis, Blink (Solana Action) untuk Join langsung dari X/Discord.
4. **Join**: masukkan jumlah USDC → lihat estimasi share & rincian swap → tanda tangan (1..n transaksi dengan progress) → share token masuk.
5. **Redeem**: pilih jumlah share → terima aset atau USDC (zap out).
6. **Clone**: tombol Clone di halaman index → wizard terisi komposisi induk → ubah bila perlu → buat.
7. **Follow**: saat create/clone, centang "Follow parent" → bobot otomatis mengikuti induk.
8. **Kelola index** (kreator): ubah bobot/strategi/fee (lewat timelock), tunjuk manager (mis. wallet agent), pause/unpause.
9. **Rebalance**: otomatis oleh keeper saat terpicu, atau oleh manager/agent via MCP. Program menolak rebalance yang melanggar mandate.
10. **Social**: leaderboard index & kreator (filter manusia/AI), profil, XP, badge, activity feed.
11. **Event IPO** (simulasi): admin menjalankan script IPO → index yang memegang token pre-IPO bermigrasi ke token saham → timeline di halaman index.
12. **Agent**: user menambahkan MCP server ke Claude Desktop/Code → agent bisa riset index, menyiapkan transaksi untuk ditandatangani user, atau (mode agent wallet) membuat dan mengelola index sendiri dalam batas mandate.

---

## 2. Keputusan yang dikunci

| # | Topik | Keputusan |
|---|---|---|
| K1 | Jaringan | Prioritas 1 localnet (local-first, test otomatis + Dev Wallet). Prioritas 2 devnet (target uji manual user dengan Phantom; Phantom tidak resmi mendukung localnet). Mainnet dilarang untuk transaksi. Pengecualian: price feeder boleh **membaca** data harga mainnet |
| K2 | Custody | Wallet client-side untuk user + vault program untuk index. Semua otomatisasi hanya lewat vault program |
| K3 | Mint/redeem | In-kind (setor/terima komponen sesuai rasio vault). Zap USDC dikerjakan di client/SDK |
| K4 | Rebalance | Flash rebalance "sandwich" dalam satu transaksi, dicek oracle dan arah bobot |
| K5 | Program | Dua program Anchor terpisah: `index_vault` (produk inti) dan `mock_market` (semua simulasi: oracle, swap, faucet, issuer, IPO). Dikonfirmasi user 2026-09-24 |
| K6 | Aset & harga | Semua aset mock. Harga oracle mock diisi price feeder dari data nyata; fallback random walk |
| K7 | Agent | LLM di luar app, terhubung lewat MCP. Dua mode: human-in-the-loop dan agent wallet |
| K8 | Fee | Kreator atur sendiri dalam batas; platform fee dari config global; royalty clone ke induk |
| K9 | Biaya | Nol. Tidak ada layanan berbayar yang wajib |
| K10 | Nama produk | Dibaca dari env `NEXT_PUBLIC_APP_NAME` (default `Stocklana`). Jangan hardcode nama produk di tempat lain |
| K11 | Bahasa | Kode & komentar: Inggris. Copy UI: Inggris, singkat. Dokumen di `docs/`: Indonesia |

---

## 3. Tech stack

Pilihan di bawah adalah default. Versi pasti ditentukan di analisis A01 dari docs resmi. Mengganti pilihan hanya bila docs resmi menyatakan deprecated/tidak kompatibel, dan wajib dicatat di `DECISIONS.md`.

| Lapisan | Pilihan | Alasan |
|---|---|---|
| Runtime & package manager | **Bun** | Ringan, TypeScript tanpa konfigurasi, workspaces |
| Monorepo | **Bun workspaces + Turborepo** | Cache task, pipeline build/test |
| Lint & format | **Biome** | Satu tool, cepat |
| Program | **Anchor** (versi stabil terbaru, via AVM) | Standar de facto program Solana |
| Test program | **LiteSVM** (Rust, template default Anchor) | Cepat, deterministik |
| Validator lokal | Validator default `anchor localnet` (Surfpool) dalam mode offline/tanpa fork mainnet; fallback `solana-test-validator` | Sesuai docs Anchor terbaru; bisa time-travel untuk demo fee |
| Client Solana | **@solana/kit** + client program hasil **Codama** dari IDL Anchor | Rekomendasi resmi Solana; client bertipe |
| Program client bawaan | `@solana-program/system`, `@solana-program/token`, `@solana-program/token-2022`, `@solana-program/compute-budget`, `@solana-program/address-lookup-table` | Pasangan Kit |
| Web | **Next.js** (App Router) + **React** + **TypeScript** | Paling banyak dukungan |
| UI | **Tailwind CSS** + **shadcn/ui** (satu-satunya sistem komponen) + ikon **lucide-react** (default shadcn) | Konsisten, modern |
| Chart | **shadcn/ui chart** (Recharts) | Satu sistem dengan shadcn |
| Data fetching | **TanStack Query** | Cache & revalidasi |
| Wallet | **@solana/react** + **@solana/kit-plugin-wallet** (Wallet Standard); fallback bila plugin belum stabil/terdokumentasi: `@solana/react` + `@wallet-standard/react` | Rekomendasi resmi; Phantom/Solflare/Backpack terdeteksi otomatis |
| Font | **Geist Sans** + **Geist Mono** (`geist` / `next/font`) | Bersih, angka tabular |
| Validasi | **Zod** | Env, input API, input MCP |
| DB | **PostgreSQL** (Docker Compose lokal) + **Drizzle ORM** + drizzle-kit, driver **`postgres` (postgres.js)** | Stabil, typed; driver jalan di Bun dan Node (Next.js berjalan di Node, jadi jangan `bun:sql`) |
| Worker | Bun (proses panjang) | Indexer, snapshot, keeper, price feeder |
| MCP | **MCP TypeScript SDK resmi**, versi stabil terbaru (cek di A01 apakah paket server sudah dipisah, mis. `@modelcontextprotocol/server`), transport stdio + Streamable HTTP | SDK resmi |
| Blinks | Implementasi spesifikasi Solana Actions (JSON + tx base64) di route handler Next.js | Tanpa ketergantungan web3.js v1 |
| OG image | `next/og` (ImageResponse) | Bawaan Next.js |
| Test TS | `bun test` | Bawaan |
| Test E2E | **Playwright** | Standar |

Dilarang: `@solana/web3.js` v1, `@solana/wallet-adapter-*`, `@coral-xyz/anchor`, `@anchor-lang/core` (client Anchor TS berbasis web3.js v1), library UI selain shadcn/ui, CSS-in-JS. Pengecualian hanya bila analisis membuktikan tidak ada alternatif dan dicatat di `DECISIONS.md`.

---

## 4. Arsitektur

### 4.1 Komponen

```
                    ┌──────────────────────────────┐
 Browser ──────────▶│ apps/web (Next.js)            │── read ──▶ PostgreSQL
 (Wallet Standard)  │  UI, API routes, Blinks, OG  │
                    └──────────────┬───────────────┘
 Agent eksternal ──▶ apps/mcp ─────┤ (via packages/sdk + packages/db)
 (Claude, Cursor)                  ▼
                           Solana (localnet / devnet)
                           ├─ index_vault  (vault, share token, fee, mandate, rebalance, IPO, follow)
                           └─ mock_market  (oracle, swap, faucet, multiplier, IPO conversion)
                                   ▲
 apps/worker ──────────────────────┘  indexer · snapshot NAV · keeper · price feeder · XP/badge
        │                              └── baca harga nyata (read-only): Pyth (mainnet), Jupiter Price API
        └──▶ PostgreSQL
```

Prinsip:
- On-chain adalah sumber kebenaran untuk saldo, share, bobot, fee. DB hanya cache + data sosial + histori.
- Semua akses chain dari TypeScript lewat `packages/sdk`. Web, worker, MCP tidak membangun instruksi sendiri.
- Semua akses DB lewat `packages/db`.

### 4.2 Struktur repository (target)

```
/
├─ CLAUDE.md, README.md          (semua dokumen lain di docs/)
├─ package.json (workspaces), turbo.json, biome.json, docker-compose.yml, .env.example
├─ anchor/                    Anchor workspace (Anchor.toml, Cargo.toml)
│  └─ programs/
│     ├─ index_vault/
│     └─ mock_market/
├─ apps/
│  ├─ web/                    Next.js
│  ├─ worker/                 Bun
│  └─ mcp/                    MCP server
├─ packages/
│  ├─ config/                 env schema (zod), konstanta, registri aset, cluster
│  ├─ sdk/                    client Codama (generated/), PDA, math, zap, rebalance, tx sender
│  ├─ db/                     skema Drizzle, migrasi, query
│  └─ ui/ (opsional)          hanya bila dibutuhkan; default komponen shadcn tinggal di apps/web
├─ scripts/                   dev orchestrator, bootstrap, seed, ipo-event, deploy-devnet, verify
├─ e2e/                       Playwright
└─ docs/
   ├─ PLAN.md  analysis/  plans/  specs/  STATUS.md  DECISIONS.md  VERSIONS.md  DEMO.md  ARCHITECTURE.md
```

Package scope: `@repo/*` (mis. `@repo/sdk`).

### 4.3 Pipeline kontrak
`anchor build` → IDL JSON → script `scripts/codegen.ts` menjalankan Codama (dari IDL Anchor) → `packages/sdk/src/generated/**` (di-commit) → dipakai SDK. Turbo task `codegen` bergantung pada `anchor build`. Perubahan program selalu diikuti regenerate client di commit yang sama.

Program ID harus stabil di setiap clone: keypair program (khusus localnet/devnet) di-commit di `anchor/keys/` dan dipakai saat build/deploy (sinkronkan `declare_id!` dan `Anchor.toml` dengan command sinkronisasi key resmi Anchor). Ini satu-satunya keypair yang boleh di-commit; keypair lain tetap di `.keys/` yang di-gitignore.

---

## 5. Spesifikasi on-chain

Konvensi:
- Jumlah token on-chain = raw amount `u64`. Hitungan antara `u128` + checked math. Tanpa float di logika uang, kecuali membaca multiplier Scaled UI (dikonversi sekali ke fixed point `MULT_FP = 1e12`).
- USD dalam micro-USD `u64` (`1_000_000` = $1). Basis point: `10_000` = 100%. `YEAR_SECS = 31_536_000`.
- Pembulatan selalu menguntungkan vault.
- **Saldo vault memakai pembukuan internal** (`AssetEntry.balance`), bukan saldo ATA. Token yang dikirim langsung ke ATA vault (donasi) diabaikan oleh semua math. Ini mencegah griefing & manipulasi.
- **Supply efektif** = `share_mint.supply + owed_total` (fee yang belum diklaim ikut dihitung). Semua math share memakai supply efektif.

### 5.1 `index_vault` — konstanta

| Nama | Nilai |
|---|---|
| `MAX_ASSETS` | 10 (turunkan bila analisis A05 membuktikan tidak muat; catat) |
| `MAX_MANAGERS` | 3 |
| `SHARE_DECIMALS` | 6 |
| `LOCKED_SHARES` | 1_000 (dikunci ke ATA share milik Index PDA saat Join pertama, anti inflation attack) |
| `MIN_INITIAL_VALUE` | 1_000_000 micro-USD ($1) |
| `MAX_MGMT_FEE_BPS` | 500 (5%/tahun) |
| `MAX_ENTRY_FEE_BPS` / `MAX_EXIT_FEE_BPS` | 100 / 100 |
| `MAX_PLATFORM_FEE_BPS` | 200 |
| `MIN_SLIPPAGE_BPS` / `MAX_SLIPPAGE_BPS` | 50 / 500 (harus ≥ spread mock_market) |
| `INITIAL_WEIGHT_TOLERANCE_BPS` | 200 |
| `ORACLE_MAX_AGE_SECS` | 120 (localnet/devnet boleh dioverride di config untuk feeder lambat) |
| `ORACLE_MAX_CONF_BPS` | 200 |

### 5.2 `index_vault` — akun

**GlobalConfig** — seeds `["config"]`
```
admin: Pubkey
platform_treasury: Pubkey
platform_fee_bps: u16            // per tahun dari AUM, default 100
clone_royalty_bps: u16           // bagian fee kreator index turunan untuk kreator induk, default 1000
market_program: Pubkey           // program mock_market yang sah (dipakai verifikasi CPI & akun)
timelock_secs: u32               // localnet 0, devnet 120 (cukup singkat untuk uji manual)
oracle_max_age_secs: u32         // default ORACLE_MAX_AGE_SECS
index_count: u64
bump: u8
```

**Index** — seeds `["index", creator, index_id.to_le_bytes()]`
```
creator: Pubkey
index_id: u64
share_mint: Pubkey               // PDA ["share", index]; SPL Token klasik; mint authority = Index PDA
name: String(32), symbol: String(10), uri: String(128)
assets: Vec<AssetEntry>(MAX_ASSETS)
fees: FeeConfig
strategy: Strategy
managers: [Pubkey; MAX_MANAGERS] // Pubkey::default() = kosong
parent: Option<Pubkey>
follows_parent: bool
pending_update: Option<PendingUpdate>
paused: bool                     // menghentikan join & rebalance; redeem SELALU boleh
owed_creator_shares: u64         // fee kreator yang belum diklaim
owed_platform_shares: u64
owed_parent_shares: u64          // royalty untuk kreator induk
last_fee_ts: i64
last_rebalance_ts: i64
rebalance_ticket: Option<RebalanceTicket>
created_at: i64
bump: u8, share_mint_bump: u8
```

**AssetEntry**: `mint, token_program, oracle, target_weight_bps: u16, kind: AssetKind(Stock|PreIpo|Stable), decimals: u8, balance: u64`

**FeeConfig**: `mgmt_fee_bps, entry_fee_bps, exit_fee_bps` (semua `u16`)

**Strategy**: `mode: StrategyMode(Manual|Threshold|Periodic), drift_threshold_bps: u16, period_secs: u32, max_slippage_bps: u16, cooldown_secs: u32, allow_keeper: bool`

**PendingUpdate**: `assets: Option<Vec<AssetEntry>>` (daftar pengganti penuh; `balance` diabaikan dari input), `fees: Option<FeeConfig>`, `strategy: Option<Strategy>`, `eta: i64`

**RebalanceTicket**: `executor: Pubkey, asset_out: u8, amount_out: u64, asset_in: u8, min_amount_in: u64, ata_in_before: u64, drift_before_bps: u32, value_out: u64`

Vault aset: ATA milik Index PDA per mint (program token sesuai `token_program`).

### 5.3 `index_vault` — instruksi

**Aturan global**: bila `rebalance_ticket.is_some()`, setiap instruksi selain `end_rebalance` gagal dengan `RebalanceInProgress`.

| Instruksi | Signer | Aturan |
|---|---|---|
| `init_config(platform_treasury, platform_fee_bps, clone_royalty_bps, market_program, timelock_secs)` | admin | Sekali |
| `set_config(...)` | admin | Batas `MAX_PLATFORM_FEE_BPS` |
| `create_index(index_id, name, symbol, uri, assets, fees, strategy, parent, follows_parent)` | creator | Total bobot = 10_000; aset unik; `len ≤ MAX_ASSETS`; fee ≤ batas; slippage dalam `[MIN, MAX]_SLIPPAGE_BPS`; oracle tiap aset = PDA `["feed", mint]` milik `market_program`; `follows_parent` butuh `parent` (akun Index induk valid); buat share mint, ATA share Index PDA, vault ATA; increment `index_count` |
| `join(max_amounts: Vec<u64>, min_shares: u64)` | user | §6.1; ditolak bila paused |
| `redeem(shares: u64, min_amounts: Vec<u64>)` | user | §6.2; selalu boleh (tidak bergantung akun milik kreator/platform) |
| `accrue_fees()` | siapa saja | §6.4; juga dipanggil internal di awal join/redeem/apply_update/sync; hanya menambah `owed_*`, tidak mint |
| `claim_fees(kind: Creator\|Platform\|Parent)` | penerima | accrue dulu, lalu mint `owed_*` ke ATA share penerima. Creator = `index.creator`; Platform = `config.platform_treasury`; Parent = `parent_index.creator` (akun induk wajib, dicek) |
| `propose_update(update)` | creator | `eta = now + timelock`. Update yang hanya **menurunkan** fee langsung berlaku |
| `apply_update()` | siapa saja | `now ≥ eta`. Aset dengan `balance > 0` wajib tetap ada di daftar (boleh bobot 0), bila tidak → `AssetStillFunded`. Aset `balance == 0` dan bobot 0 dihapus. Aset baru → buat vault ATA. Tidak memindahkan aset; rebalance yang menyesuaikan |
| `cancel_update()` | creator | |
| `set_managers(managers)` | creator | |
| `set_paused(paused)` | creator | |
| `begin_rebalance(asset_out, amount_out, asset_in, min_amount_in)` | executor | §6.3 |
| `end_rebalance()` | executor | §6.3 |
| `migrate_ipo_asset(asset_idx)` | siapa saja | §6.5 |
| `sync_targets_from_parent()` | siapa saja | Hanya bila `follows_parent`. Salin daftar aset & bobot induk dengan aturan `apply_update` (tanpa timelock). Aset lokal dengan `balance > 0` yang tidak ada di induk tetap dipertahankan dengan bobot 0; bila jumlah melebihi `MAX_ASSETS` → `TooManyAssets` (keeper akan rebalance aset itu ke 0 dulu, lalu sync ulang) |

Akun per aset lewat `remaining_accounts`, urutan sama dengan `Index.assets`. Tata letak per instruksi ditentukan di analisis A05 dan ditulis di `docs/ARCHITECTURE.md`; validasi mint, owner, program token, dan urutan wajib.

Events: `IndexCreated, Joined, Redeemed, FeesAccrued, FeesClaimed, IndexUpdateProposed, IndexUpdated, IndexUpdateCancelled, RebalanceExecuted, IpoMigrated, ManagersSet, PausedSet, TargetsSynced` (field: index + data relevan).

Errors minimal: `InvalidWeights, FeeTooHigh, InvalidSlippage, TooManyAssets, DuplicateAsset, Paused, SlippageExceeded, ZeroShares, InitialValueTooSmall, InitialWeightMismatch, Unauthorized, CooldownActive, TriggerNotMet, RebalanceInProgress, NoTicket, SameAsset, MissingEndInstruction, InvalidRebalanceTx, NotTopLevel, OracleStale, OracleConfidence, InvalidPrice, InvalidOracle, InvalidMarketProgram, WrongDirection, TimelockActive, NoPendingUpdate, AssetStillFunded, NotPreIpo, NoIpoConversion, ConversionMismatch, NotFollowing, InvalidParent, AccountOrderMismatch, MathOverflow`.

### 5.4 `mock_market`

Pengganti oracle, DEX, faucet, dan issuer. Mint authority semua token mock = PDA market.

Akun:
- **Market** `["market"]`: `authority, usdc_mint, spread_bps (default 30), faucet_max (localnet 1_000_000 USDC, devnet 10_000 USDC), bump`
- **Mint mock** PDA `["mint", symbol]` (USDC juga: `["mint", "USDC"]`).
- **OracleFeed** `["feed", mint]`: `mint, price: i64, expo: i32, conf: u64, publish_time: i64`. Harga per 1 unit UI token. Bentuk meniru harga Pyth.
- **IpoConversion** `["ipo", old_mint]`: `old_mint, new_mint, ratio_num: u64, ratio_den: u64, active: bool`

Instruksi:
| Instruksi | Signer | Ringkas |
|---|---|---|
| `init_market(spread_bps, faucet_max)` | authority | Buat Market + mint USDC mock (6 desimal) |
| `create_mock_mint(symbol, decimals, token_2022, scaled_ui)` | authority | Saham: Token-2022 + Scaled UI Amount (multiplier authority = PDA market) |
| `create_feed(mint)` | authority | |
| `set_prices(Vec<{price, expo, conf}>)` | `Market.authority` | Batch banyak feed dalam satu tx (akun feed via remaining_accounts); `publish_time = now` |
| `set_multiplier(mint, multiplier, effective_ts)` | authority | Simulasi dividen/split |
| `faucet(amount)` | user | Mint USDC mock, ≤ `faucet_max` per panggilan |
| `swap(amount_in, min_out)` | user/executor | Burn input, mint output pada harga oracle dikurangi spread; memperhitungkan multiplier; tolak oracle basi |
| `register_ipo(ratio_num, ratio_den)` | authority | Akun: old mint, new mint (sudah dibuat + feed), buat `IpoConversion` |
| `convert(amount)` | pemilik token (termasuk PDA via CPI) | Burn token lama, mint `floor(amount * num / den)` token baru |

`index_vault` membaca `OracleFeed` lewat satu modul `oracle.rs` dengan fungsi `read_price(account, now) -> Price`. Modul memverifikasi owner akun = `config.market_program` dan alamat = PDA `["feed", mint]`. Adapter oracle lain cukup mengganti modul ini.

### 5.5 Penyempurnaan kontrak P2 (dibekukan 2026-09-24, D023)
Kode di `anchor/programs/*` dan IDL adalah bentuk final kontrak. Perbedaan terhadap §5.1–§5.4:
- `mock_market`: `Market.oracle_max_age_secs` (arg ke-3 `init_market`); `OracleFeed.kind: AssetKind` (arg `create_feed(kind)`) → vault menurunkan `AssetKind` dari feed, bukan dari input kreator; `set_prices` maks 24 feed; `faucet` mensyaratkan ATA USDC sudah ada; spread maks 500 bps.
- `index_vault`: `init_config(params: ConfigParams)` / `set_config(params, new_admin: Option<Pubkey>)` dengan `ConfigParams { platform_treasury, platform_fee_bps, clone_royalty_bps, market_program, timelock_secs, oracle_max_age_secs }`; event tambahan `ConfigUpdated`.
- `create_index(index_id, name, symbol, uri, assets: Vec<AssetInput{mint, target_weight_bps}>, fees, strategy, follows_parent)`; induk lewat akun opsional `parent_index`. `token_program`, `oracle`, `kind`, `decimals` diturunkan on-chain. Bobot saat create wajib > 0; saat update boleh 0.
- `set_managers(managers: Vec<Pubkey>)` (≤ 3). `propose_update(update: UpdateInput{assets: Option<Vec<AssetInput>>, fees, strategy})`.
- Share token = SPL Token klasik. Event memakai `emit!` (log). Math murni di crate bersama `anchor/crates/index_math` (dipakai kedua program; test vector `anchor/crates/index_math/vectors/math.json` untuk paritas SDK).
- Error tambahan: `InvalidMetadata, InvalidAssetIndex, InsufficientBalance, InvalidManagers, InvalidConfig`.
- Tata letak `remaining_accounts` final: `docs/analysis/A05-batas-transaksi.md`.
- Skema DB (§7.3) tambahan kolom `indexes.share_mint, uri, pending_update, paused`; tabel `faucet_claims`.

---

## 6. Math

### 6.1 Join
```
accrue_fees()
S = supply efektif
if S == 0:
    value = Σ value_usd(i, amount_i)                          // oracle, untuk aset bobot > 0
    require value ≥ MIN_INITIAL_VALUE
    |bobot setoran_i - target_i| ≤ INITIAL_WEIGHT_TOLERANCE_BPS untuk semua i
    shares_total = value                                      // 1 share ≈ $1
    mint LOCKED_SHARES ke ATA share milik Index PDA
    gross = shares_total - LOCKED_SHARES
    amount_i = max_amounts_i
else:
    shares_total = min_i(balance_i > 0) floor(max_amounts_i * S / balance_i)
    amount_i = ceil(shares_total * balance_i / S)              // aset balance 0: amount 0
    gross = shares_total
fee = floor(gross * entry_fee_bps / 10_000) → owed_creator_shares += fee
user_shares = gross - fee ; require user_shares ≥ min_shares && > 0
transfer_checked amount_i user→vault ; balance_i += amount_i ; mint user_shares → user
```

### 6.2 Redeem
```
accrue_fees()
S = supply efektif
fee = floor(shares * exit_fee_bps / 10_000)
net = shares - fee
amount_i = floor(net * balance_i / S) ; require ≥ min_amounts_i
burn `shares` dari user ; owed_creator_shares += fee
transfer_checked amount_i vault→user ; balance_i -= amount_i
```
(Fee exit tetap di supply efektif sebagai owed sehingga nilainya tidak hilang.)

### 6.3 Valuasi & flash rebalance
```
mult_fp = multiplier Scaled UI efektif * MULT_FP (pakai new_multiplier bila now ≥ effective_timestamp); tanpa extension = MULT_FP
require price > 0
value_usd(i, raw) = raw * mult_fp * price * 10^(expo + 6) / (10^decimals * MULT_FP)     → micro-USD
                   (bila expo + 6 < 0, bagi dengan 10^-(expo+6); urutan kali-dulu-bagi-belakang di u128)
NAV = Σ value_usd(i, balance_i) ; share_price = NAV * 10^6 / S ; weight_i = value_i * 10_000 / NAV
drift = Σ_i |weight_i - target_i|
```
Oracle ditolak bila `now - publish_time > config.oracle_max_age_secs` atau `conf * 10_000 / price > ORACLE_MAX_CONF_BPS`.

Satu transaksi: `begin_rebalance` → `mock_market.swap` (executor) → `transfer_checked` hasil swap executor→vault → `end_rebalance`.

`begin_rebalance`:
1. Top-level (bukan CPI). `asset_in != asset_out`, keduanya indeks valid, `amount_out ≤ balance_out`.
2. Tidak paused, tidak ada ticket, `now - last_rebalance_ts ≥ cooldown_secs`.
3. Otorisasi: kreator/manager selalu boleh. Selain itu hanya bila `allow_keeper` **dan** pemicu terpenuhi on-chain (`Threshold`: `max_i |w_i - t_i| > drift_threshold_bps`; `Periodic`: `now - last_rebalance_ts ≥ period_secs`; `Manual`: keeper ditolak) **dan** kedua aset bukan `PreIpo`. Gagal → `Unauthorized`/`TriggerNotMet`.
4. Introspeksi instructions sysvar: instruksi-instruksi setelah `begin` hingga `end_rebalance` (program ini, index yang sama) hanya boleh dari program: `config.market_program` (swap), Token/Token-2022 (`transfer_checked`), Associated Token (create idempotent), Compute Budget. Tidak ada instruksi `index_vault` lain di antaranya. Tidak ditemukan `end` → `MissingEndInstruction`; ada instruksi lain → `InvalidRebalanceTx`.
5. Catat `ata_in_before` (saldo ATA vault asset_in), `drift_before`, `value_out`. Transfer `amount_out` vault→executor; `balance_out -= amount_out`. Simpan ticket.

`end_rebalance`:
1. Ticket ada & signer = executor.
2. `amount_in = ata_in_now - ata_in_before ≥ min_amount_in`; `balance_in += amount_in`.
3. `value_in ≥ value_out * (10_000 - max_slippage_bps) / 10_000`.
4. `drift_after ≤ drift_before` → bila tidak `WrongDirection`.
5. Hapus ticket, `last_rebalance_ts = now`, emit `RebalanceExecuted`.

Planner keeper (off-chain, SDK): pemicu sama seperti poin 3; **abaikan aset `PreIpo`**; pasangan paling overweight → paling underweight; jumlah = yang menutup selisih lebih kecil dari keduanya; `min_amount_in` dari quote dikurangi slippage.

### 6.4 Fee manajemen & platform
```
elapsed = now - last_fee_ts ; rate = mgmt_fee_bps + platform_fee_bps
if rate == 0 || elapsed == 0 || S == 0: last_fee_ts = now ; return
f_fp = rate * elapsed * 1e12 / (10_000 * YEAR_SECS)
new = S * f_fp / (1e12 - f_fp)                       (dilusi)
creator = new * mgmt_fee_bps / rate ; platform = new - creator
if parent: royalty = creator * clone_royalty_bps / 10_000 ; creator -= royalty ; owed_parent_shares += royalty
owed_creator_shares += creator ; owed_platform_shares += platform ; last_fee_ts = now
```

### 6.5 Migrasi IPO
`migrate_ipo_asset(asset_idx)`:
1. Aset `kind == PreIpo`, bila tidak `NotPreIpo`.
2. Akun `market_program` == `config.market_program` (`InvalidMarketProgram`); `IpoConversion` = PDA `["ipo", old_mint]` milik program itu, `active`, `new_mint` cocok (`NoIpoConversion`).
3. Buat vault ATA mint baru (idempoten). Catat saldo ATA baru sebelum.
4. CPI `convert(balance_i)` dengan Index PDA sebagai signer.
5. Verifikasi saldo ATA baru bertambah tepat `floor(balance_i * num / den)` (`ConversionMismatch`).
6. Ganti `mint, token_program, oracle (["feed", new_mint]), decimals`, `kind = Stock`, `balance = hasil konversi`; bobot tetap. Emit `IpoMigrated`.

### 6.6 Zap (SDK)
Zap in: ambil `balance_i` + harga (index kosong: bobot target) → `usdc_i = total * value_share_i * (1 - buffer 1%)` → swap tiap aset → `join(max_amounts = hasil swap, min_shares)`. Pecah ke beberapa transaksi bila perlu; gunakan Address Lookup Table per index (dibuat SDK setelah create, disimpan di DB). Sisa kecil tetap di wallet; UI menawarkan "Sweep to USDC". Zap out: `redeem` lalu swap ke USDC.

---

## 7. Off-chain

### 7.1 `packages/config`
- Env schema (zod) per app; gagal cepat dengan pesan jelas.
- Cluster: `localnet | devnet` (tolak `mainnet`).
- Registri aset mock (`assets.ts`): `symbol, name, kind, decimals, token2022, scaledUi, mainnetMint?, pythFeedId?, priceSource, fixturePrice, ipoTarget?`.
  - Stable: `USDC`
  - Stock: `AAPLx, NVDAx, TSLAx, MSFTx, GOOGLx, AMZNx, METAx, SPYx` (SPYx = benchmark)
  - PreIpo: `SPACEX-pre, OPENAI-pre, ANTHRP-pre, ANDURL-pre`, masing-masing dengan `ipoTarget` (saham hasil IPO: `SPCXx, OPENAIx, ANTHRPx, ANDURLx`, kind Stock, `ratio 1:1` default). Mint & feed target dibuat oleh script IPO saat event, bukan saat bootstrap.
  - Semua nama tampil di UI dengan label "Simulated".
- Alamat program & mint hasil bootstrap disimpan di `packages/config/deployments/{cluster}.json` (ditulis script bootstrap/ipo, di-gitignore untuk localnet, di-commit untuk devnet).

### 7.2 `packages/sdk`
- `generated/` (Codama), `pda.ts`, `accounts.ts` (fetch + decode), `math.ts` (identik dengan program, termasuk multiplier, supply efektif, fee), `zap.ts`, `rebalance.ts` (planner + builder sandwich), `tx.ts` (compute budget, ALT, kirim & konfirmasi, split multi-tx, blockhash baru per kirim), `ipo.ts`, `follow.ts`, `fees.ts` (claim), `errors.ts` (map error program → pesan manusia, dipakai web & MCP).
- Signer abstrak (Kit `TransactionSigner`) sehingga sama untuk browser wallet, keypair worker, dan agent.

### 7.3 Database (Drizzle)
```
users            (wallet PK, handle unique, avatar_seed, bio, is_agent, agent_name, created_at)
auth_nonces      (nonce PK, wallet, purpose, expires_at, used_at)
indexes          (pubkey PK, creator, index_id, name, symbol, description, thesis, parent, follows_parent,
                  assets jsonb, fees jsonb, strategy jsonb, managers jsonb, lookup_table, is_agent_index,
                  created_at, updated_at)
index_snapshots  (index, ts, nav_micro_usd, supply, share_price_micro_usd, weights jsonb, synthetic bool)  PK(index, ts)
positions        (wallet, index, shares, cost_basis_micro_usd, first_joined_at, updated_at)  PK(wallet, index)
events           (signature, ix_index, type, index, wallet, slot, data jsonb, ts)  PK(signature, ix_index)
indexer_state    (program PK, last_signature, last_slot, updated_at)
sign_intents     (id PK, kind, params jsonb, wallet, created_by, status, signatures jsonb, created_at, expires_at)
social_follows   (follower, followee, created_at)  PK(follower, followee)
xp_ledger        (id, wallet, amount, reason, ref, created_at)  unique(wallet, reason, ref)
badges           (wallet, badge, awarded_at)  PK(wallet, badge)
prices           (symbol, ts, price_micro_usd, source, synthetic bool)  PK(symbol, ts)
faucet_claims    (id, wallet, kind SOL|USDC, amount, cluster, created_at)  index(wallet, kind, created_at)
auth_sessions    (token_hash PK, wallet, created_at, expires_at)                        -- D033
posts            (id PK, author, index null, card_variant null, body, like_count, comment_count, created_at, deleted_at)  -- card_variant: D035
                  index(created_at), index(author, created_at), index(index, created_at)
post_likes       (post_id, wallet, created_at)  PK(post_id, wallet)
post_comments    (id PK, post_id, author, body, created_at, deleted_at)  index(post_id, created_at), index(author, created_at)
agent_wallets    (wallet PK, owner, name, secret_enc, created_at)  index(owner)                 -- D045: seed ed25519 terenkripsi AES-256-GCM
api_keys         (id PK, agent_wallet FK→agent_wallets.wallet, owner, name, prefix, key_hash unique,
                  created_at, last_used_at null, revoked_at null)  index(agent_wallet), index(owner)  -- D045: hanya hash SHA-256
```

### 7.4 `apps/worker`
Satu proses, beberapa loop dengan interval terpisah (env), masing-masing idempoten dan tahan error (satu loop gagal tidak mematikan yang lain):
- **price-feeder**: urutan sumber per aset: (1) Jupiter Price API v3 berdasarkan `mainnetMint` (key opsional; tanpa key 30 req/menit), pakai `stockData.price` lalu `usdPrice`; (1b) Finnhub quote untuk saham US bila `FINNHUB_API_KEY` ada; (2) Pyth read-only hanya bila `PYTH_API_KEY` ada (Hermes bila `PYTH_API_KEY` ada; atau akun harga on-chain mainnet bila analisis A06 membuktikan feed-nya aktif); (3) random walk dari harga terakhir/`fixturePrice`. `PRICE_MODE=live` memakai urutan itu; `PRICE_MODE=random` langsung (3). Di luar jam bursa harga boleh diam; feeder tetap menulis ulang harga terakhir agar oracle tidak basi. Tulis via `set_prices` (batch) + tabel `prices`. Di devnet interval default lebih jarang (hemat SOL).
- **indexer**: subscribe log program + backfill signature dari `indexer_state`; decode event → `events`; sinkron akun `Index` → `indexes`; update `positions`.
- **snapshot**: tiap N detik hitung NAV/share price tiap index + SPYx → `index_snapshots`.
- **keeper**: planner §6.3; jalankan rebalance dengan keypair keeper untuk index `allow_keeper` yang pemicunya terpenuhi.
- **fees**: panggil `accrue_fees` berkala untuk index aktif.
- **follow**: panggil `sync_targets_from_parent` saat induk berubah (event `IndexUpdated`/`IpoMigrated` pada induk).
- **gamification**: hitung XP & badge dari events/snapshots (idempoten via unique key).

### 7.5 `apps/web` — API routes
- `GET /api/indexes` (sort, filter, search, paging), `GET /api/indexes/[pubkey]`, `GET /api/indexes/[pubkey]/performance?range=`, `GET /api/indexes/[pubkey]/activity`, `GET /api/leaderboard?board=&range=&type=`, `GET /api/users/[wallet]`, `GET /api/auth/nonce?wallet=&purpose=`, `POST /api/users/[wallet]` (update profil; wajib signMessage atas nonce), `POST /api/users/[wallet]/follow`, `POST /api/indexes/[pubkey]/meta` (deskripsi/thesis; wajib tanda tangan kreator atas nonce), `GET /api/meta/[pubkey]` (target `uri` on-chain), `GET /api/prices`, `GET /api/intents/[id]` + `POST /api/intents/[id]/tx` (bangun ulang tx intent dengan blockhash baru).
- Blinks: `GET/POST /api/actions/join/[pubkey]` + `actions.json` di root, header CORS sesuai spesifikasi. Transaksi zap tunggal bila muat; bila tidak, action chaining.
- OG: `/i/[pubkey]/opengraph-image`.
- Konsol agent (D045, wajib sesi sign-in D033; mutasi wajib same-origin): `GET /api/me/agents` → `{ agents: [{ wallet, name, createdAt, keys: [{ id, name, prefix, createdAt, lastUsedAt, revokedAt }] }] }`; `POST /api/me/agents {name}` → `{ wallet, name }` (maks 3 agent/owner, 409); `POST /api/me/agents/[wallet]/keys {name}` → `{ id, key, prefix }` (key hanya sekali, maks 5 key aktif/agent, 409); `DELETE /api/me/keys/[id]` → `{ ok: true }`; `POST /api/me/agents/[wallet]/fund` → `{ ok, sol }` (aturan faucet SOL yang sama). Tanpa `AGENT_KEY_SECRET` → 503.

### 7.6 `apps/mcp`
> D036: progres langkah /sign dipegang server dan maju hanya dengan signature yang terverifikasi on-chain (bisa dilanjutkan setelah terputus, tanpa mengulang swap). Status yang sudah dimulai kedaluwarsa 1 jam setelah `expiresAt`.

Mode human-in-the-loop (default): tool `build_*` menyimpan **intent** di `sign_intents` dan mengembalikan link `{WEB_URL}/sign?id=<intent>` (+ ringkasan manusiawi). Halaman `/sign` membangun transaksi dengan blockhash baru saat user siap, mendukung multi-transaksi, lalu memperbarui status intent. Tool `get_intent_status` untuk agent mengecek hasilnya. Mode agent wallet: aktif bila `AGENT_KEYPAIR_PATH` diset; tool `agent_*` menandatangani sendiri (program tetap membatasi).

| Tool | Fungsi |
|---|---|
| `list_assets` | Aset, harga, label simulasi |
| `list_indexes` | Cari/sortir index |
| `get_index` | Komposisi, bobot vs target, NAV, fee, strategi, manager |
| `get_index_performance` | Seri share price vs SPYx |
| `get_leaderboard` | Ranking index/kreator, filter manusia/AI |
| `get_portfolio` | Posisi & PnL wallet |
| `simulate_rebalance` | Pasangan swap yang disarankan + lolos/tidak mandate + alasannya |
| `build_create_index`, `build_join`, `build_redeem`, `build_clone` | Intent + link sign |
| `get_intent_status` | Status intent & signature; untuk create/clone juga `result.index` (D036) |
| `agent_info`, `agent_register` | Identitas agent; register via tanda tangan pesan → `users.is_agent` |
| `agent_create_index`, `agent_join`, `agent_rebalance`, `agent_propose_update` | Aksi dengan keypair agent |

Endpoint publik (`/api/mcp`, standalone `MCP_PUBLIC=1`): `agent_*` hanya dengan `Bearer <MCP_AGENT_TOKEN>` (agent operator, keypair server) atau `Bearer sbk_…` = API key user (D045): server memverifikasi hash key, mendekripsi seed agent milik key itu, dan semua tool (termasuk default `get_portfolio`/`simulate_rebalance`) bertindak sebagai wallet agent tersebut. Key tak dikenal/dicabut → HTTP 401 JSON-RPC "Invalid or revoked API key" (tidak diturunkan diam-diam ke anonim). Rate limit per key 120/menit di samping per IP.

Aturan: tolak cluster selain localnet/devnet; batas jumlah per aksi via env; tidak pernah mengembalikan secret/env; setiap tool punya deskripsi jelas dan schema zod; error program dikembalikan sebagai pesan manusia (`errors.ts`). Sediakan resource `docs://guide` berisi cara pakai singkat untuk LLM.

### 7.7 Social & gamifikasi
- Leaderboard index: return 24h/7d/30d/all (share price), selisih vs SPYx, AUM, holder. Filter: all/human/AI (AI = `is_agent_index`: kreator adalah agent terdaftar).
- Leaderboard kreator: AUM total, fee diperoleh, jumlah joiner, jumlah clone.
- XP default: create +50, join +10/index, hold ≥24h +5/hari (maks 30 hari), index-mu di-join orang lain +20, di-clone +30, index-mu mengalahkan SPYx 7d +100. Level = `floor(sqrt(xp / 50))`.
- Badge (kriteria):
  - `first_index`: membuat index pertama.
  - `first_join`: join index pertama.
  - `ten_holders`: index-mu punya ≥ 10 holder.
  - `cloned`: index-mu di-clone ≥ 1 kali.
  - `beat_spy_7d`: return 7d index-mu > SPYx 7d (index umur ≥ 7 hari; snapshot sintetis dihitung).
  - `ai_manager`: kreator menunjuk wallet agent terdaftar sebagai manager.
  - `ipo_survivor`: index-mu mengalami `IpoMigrated`.
- Profil: handle, avatar generatif dari `avatar_seed`, bio, index buatan, posisi, badge, follow/unfollow kreator.
- **Feed & diskusi (D033)**: halaman `/feed` dengan tab **Following** (post + aktivitas on-chain dari wallet yang di-follow, aktivitas index yang dipegang/dibuat viewer, dan post sendiri) dan **All** (semua post + aktivitas penting: create, rebalance, update bobot, IPO, clone). Post singkat (opsional menautkan satu index; tampil juga di bagian Discussion halaman index dan di profil), like, komentar satu tingkat. Penulis bisa menghapus post/komentarnya sendiri (soft delete).
- **Kartu index (D035)**: index dapat dibagikan ke feed sebagai kartu (nama, deskripsi, koleksi token + bobot, return 30d + sparkline, TVL, drawdown maks vs SPYx, kreator) dalam 3 variasi header yang diturunkan dari data index: `mark` (pola index mark), `tokens` (tile token sebesar bobotnya), `chart` (kurva performa). Variasi dipilih penulis saat berbagi dan disimpan per post. Kartu kreator ala "top creators" di Home.
- **Anti-spam (D033)**:
  - Tulis (post/komentar/like) butuh sesi: wallet menandatangani pesan sign-in sekali, lalu server memberi cookie httpOnly 24 jam. Hanya hash token yang disimpan. Origin diperiksa (CSRF).
  - Post & komentar butuh "skin in the game": wallet punya ≥ 1 event on-chain `Joined`/`IndexCreated` di cluster ini.
  - Batas laju per wallet: post 3/10 menit & 20/hari, jeda 20 dtk; komentar 10/10 menit & 100/hari, jeda 5 dtk; like 120/10 menit.
  - Konten: post 1–500 karakter, komentar 1–280. Spasi dinormalkan, maks 2 URL, tanpa deretan > 10 karakter identik, dan tidak boleh sama persis dengan post/komentar sendiri dalam 24 jam.
  - Ditampilkan sebagai teks biasa (URL tidak diubah menjadi link).
  - Post/komentar tidak memberi XP (mencegah farming).

### 7.8 Dev wallet
Wallet Standard wallet lokal (keypair di localStorage) yang didaftarkan ke Wallet Standard registry hanya bila cluster localnet/devnet. Tombol "Create dev wallet" + auto-airdrop SOL + faucet USDC. Dipakai juga oleh Playwright. Label jelas "Dev wallet — for testing".

**Faucet SOL**: localnet memakai `requestAirdrop`. Devnet tidak bergantung pada airdrop publik (rate limit): route server `POST /api/faucet/sol` mentransfer `FAUCET_SOL_PER_REQUEST` (default 0.2 SOL) dari wallet admin, dibatasi per wallet per 24 jam (tabel `faucet_claims`) dan `FAUCET_SOL_DAILY_CAP`. Hanya aktif untuk cluster devnet/localnet.

### 7.9 Orkestrasi lokal
- `bun run setup`: cek prasyarat (bun, rust, avm/anchor, Surfpool atau Solana CLI/Agave untuk `solana-test-validator`, docker) dengan pesan instalasi yang jelas → `bun install` → `bunx playwright install --with-deps chromium` → buat `.keys/` (admin, keeper, agent) → salin `.env.example` ke `.env` bila belum ada → `docker compose up -d` → migrasi DB. Fallback tanpa Docker: Postgres native (`DATABASE_URL` diarahkan ke sana) — dicetak sebagai instruksi.
- `bun run dev`: satu command menjalankan validator lokal (offline), deploy program, bootstrap (idempoten: market, mint, feed, harga awal, `init_config`, airdrop SOL ke admin/keeper/agent), worker, web, MCP (HTTP) — `scripts/dev.ts` dengan output berlabel per proses, health check tiap layanan, dan shutdown bersih. Flag `--ci` untuk dipakai `verify`.
- `bun run seed`: buat 3 wallet demo + 1 wallet agent (register), 6–8 index beragam (pre-IPO, clone, follow, agent-managed, dengan AUM besar agar fee terlihat), join, rebalance, dan histori sintetis 30 hari (`synthetic = true`, UI menampilkan label "Simulated history").
- `bun run price -- --asset <SYMBOL> --pct <+/-N>`: ubah harga secara deterministik (untuk demo & test drift).
- `bun run warp -- --days <N>`: time-travel validator (fitur Surfpool) untuk demo akrual fee; bila tidak tersedia, cetak pesan dan keluar dengan kode 0.
- `bun run ipo -- --asset <SYMBOL>`: buat mint + feed saham target, `register_ipo`, panggil `migrate_ipo_asset` untuk **semua** index pemegang, lalu `sync_targets_from_parent` untuk index follower terkait.
- `bun run verify`: lint, typecheck, test program, test TS, build, lalu menyalakan stack sendiri (`scripts/dev.ts --ci`), menjalankan seed + e2e, dan mematikan semuanya.
- Env: satu `.env` di root. `turbo.json` meneruskan semua var (pass-through/global env), dan `apps/web` memuat `.env` root (mis. `loadEnvConfig` dari `@next/env` di `next.config`).

Port default: web 3000, MCP HTTP 3333, RPC 8899, WS 8900, Postgres **5434** (host; 5432/5433 dipakai project lain milik user).

Solana CLI di semua script: `-C .keys/solana-cli.yml` (config lokal project, RPC localhost, keypair admin) atau `-u <RPC> -k .keys/<nama>.json` eksplisit. Config global user tidak pernah dipakai/diubah.

Mode devnet lokal: `bun run dev:devnet` menjalankan worker, web, dan MCP di mesin lokal dengan `CLUSTER=devnet` (tanpa validator lokal), membaca `deployments/devnet.json`.

---

## 8. UI/UX

Target rasa: produk fintech yang tenang dan presisi (referensi rasa: Linear, Vercel dashboard, Stripe dashboard, Robinhood). Data dulu, dekorasi belakangan.

### 8.1 Prinsip
1. **Monokrom + makna warna.** UI netral (skala neutral/zinc shadcn). Warna hanya untuk makna: hijau naik, merah turun, kuning peringatan, satu aksen untuk aksi utama. Tidak ada warna dekoratif.
2. **Angka adalah pahlawan.** Angka besar, `tabular-nums`, Geist Mono untuk nilai/alamat, satuan kecil dan redup. Perubahan harga ber-animasi halus (tick).
3. **Hierarki lewat tipografi dan spasi**, bukan kotak berlapis. Border 1px halus, radius konsisten (`--radius` 10–12px), tanpa shadow berat.
4. **Satu aksi utama per layar.** Tombol primer satu; sisanya secondary/ghost.
5. **Copy singkat dan konkret.** "Join", "Redeem", "Clone". Tidak ada kalimat pemasaran.
6. **Cepat terasa**: skeleton sesuai bentuk konten, optimistic UI, toast (sonner) untuk transaksi dengan link explorer, progress stepper untuk zap multi-transaksi.
7. **Jujur**: semua aset & harga berlabel "Simulated"; histori sintetis berlabel; kegagalan transaksi dijelaskan dengan bahasa manusia (map error program → pesan).

### 8.2 Anti-"AI slop" (dilarang)
Gradien ungu-biru, glassmorphism, blur/glow, neon, emoji di UI, hero marketing dengan 3 kartu fitur ber-ikon, ilustrasi 3D/stok, background animasi, teks gradien, border gradien, semua elemen di-center, kartu di dalam kartu di dalam kartu, ikon di setiap label, badge warna-warni tanpa makna, copy "Revolutionize/Unlock/Seamless", placeholder lorem ipsum, angka palsu tanpa label.

### 8.3 Design tokens
> **Diperbarui (D034):** palet dan komponen kini mengikuti `refs/Stocklana.html` ("quiet green desk"): keluarga hijau gelap, mint hanya untuk aksi utama/logo/return positif, Manrope + IBM Plex Mono, glass hanya di top bar dan panel Join/Redeem. Token final ada di `apps/web/app/globals.css`. Aturan anti-"AI slop" §8.2 tetap berlaku.

- Font: Geist Sans (UI), Geist Mono (angka, alamat, simbol ticker).
- Skala teks: 12 / 13 / 14 (default) / 16 / 20 / 24 / 32 / 48.
- Spasi: kelipatan 4px. Lebar konten maks 1200px (halaman data), 640px (form).
- Tema: light & dark (default mengikuti sistem), toggle di menu. Token di `globals.css` via CSS variables shadcn; tidak ada warna hardcode di komponen.
- Chart: garis 1.5px, area fill sangat tipis, grid minimal, benchmark garis putus-putus abu-abu, tooltip ringkas, crosshair.
- Alokasi: bar horizontal bertumpuk (bukan pie) + tabel bobot current vs target dengan indikator drift.
- Identitas index: glyph generatif deterministik dari pubkey + komposisi (mis. bar mini bobot), bukan emoji/gambar acak.
- Aset: monogram ticker dalam kotak kecil (warna netral), tanpa logo merek.

### 8.4 Layout & navigasi
Top bar: logo/nama app · Explore · Leaderboard · Create · Portfolio · (kanan) badge cluster (`Localnet`/`Devnet`), command palette (⌘K, cari index/aset/kreator), tombol wallet. Mobile: bottom tab bar, panel aksi jadi Drawer.

### 8.5 Halaman
| Route | Isi |
|---|---|
| `/` | Ringkasan pasar: strip ticker aset (harga + perubahan), "Top indexes" (tabel ringkas dengan sparkline), "Trending clones", "Human vs AI" mini-board, CTA Create. Tanpa hero marketing |
| `/explore` | Tabel/grid index: filter (human/AI, pre-IPO, strategi), sort (return, AUM, holder, terbaru), cari |
| `/i/[pubkey]` | Header (glyph, nama, simbol, kreator, badge human/AI/pre-IPO/follow), share price besar + perubahan, chart (1D/1W/1M/ALL, toggle vs SPYx), panel Join/Redeem sticky kanan, alokasi, strategi & guard (tampilan seperti daftar pengaturan dengan nilai di kanan), fee, manager, holder, activity feed, timeline event (rebalance, IPO), tombol Clone & Share (salin link, Blink, unduh kartu) |
| `/create` | Wizard 5 langkah dengan preview kartu index live di kanan: Assets (pencarian bergaya command) → Weights (slider + input angka, lock, normalize, preset equal/market-cap-like) → Strategy (preset: Hold, Rebalance on drift, Periodic; mode lanjutan) → Fees (slider dalam batas + estimasi pendapatan per $10k AUM) → Details & review (nama, simbol, deskripsi, thesis, manager opsional, follow parent bila clone) |
| `/i/[pubkey]/manage` | Khusus kreator: update terjadwal (timelock countdown), manager, pause, riwayat fee |
| `/portfolio` | Total nilai, PnL, posisi per index, index buatan sendiri + fee diperoleh |
| `/leaderboard` | Tab Index / Creators, filter range & tipe, podium sederhana top 3 (tetap minimalis), tabel |
| `/u/[wallet]` | Profil: avatar, handle, level & XP, badge, index buatan, posisi publik, follow |
| `/faucet` | Ambil USDC simulasi & SOL (localnet: airdrop; devnet: transfer dari wallet admin, dibatasi) |
| `/sign?id=` | Tinjau & tanda tangani intent dari MCP: ringkasan manusiawi (apa yang terjadi), simulasi, tombol Sign, progress bila multi-transaksi, status akhir |
| `/agents` | Cara menghubungkan MCP (snippet config Claude Desktop/Code), daftar agent terdaftar & index yang dikelola |

### 8.6 State wajib per komponen data
Loading (skeleton), empty (satu kalimat + satu aksi), error (pesan + retry), wallet belum connect, saldo kurang, jaringan salah.

### 8.7 Aksesibilitas & responsif
Kontras AA, fokus terlihat, navigasi keyboard, label ARIA pada kontrol ikon, target sentuh ≥ 40px, layout diuji di 375px, 768px, 1280px, 1536px.

### 8.8 Review visual (wajib, P10)
Playwright mengambil screenshot semua halaman di light/dark × mobile (375px)/desktop (1280px) dengan data seed. Agent membuka dan memeriksa tiap screenshot terhadap §8.1–8.7, menulis temuan di `docs/analysis/A15-ui-review.md`, lalu memperbaiki. Maksimal 3 putaran. Pelanggaran §8.2 dan masalah fungsional/aksesibilitas wajib diperbaiki; temuan estetika minor yang tersisa setelah putaran ke-3 dicatat sebagai "diterima" di `DECISIONS.md`.

---

## 9. Analisis wajib

Setiap analisis ditulis di `docs/analysis/Axx-nama.md` dengan format: **Pertanyaan · Sumber yang dibaca (link docs resmi) · Temuan · Opsi · Keputusan · Dampak ke implementasi**. Tulis sebelum fase di kolom terakhir.

| ID | Topik | Harus menjawab | Sebelum |
|---|---|---|---|
| A01 | Toolchain & versi | Command init resmi & versi terbaru: Bun, Turborepo (dengan Bun), Next.js (create-next-app dengan Bun), shadcn (init/add, versi Tailwind yang didukung), Biome, Anchor + AVM (opsi `anchor init`: package manager, test template, no-git), Surfpool (mode offline, time-travel), LiteSVM, Codama (IDL Anchor → client Kit), Kit + plugin wallet + @solana/react, Drizzle + postgres.js, MCP TypeScript SDK (nama paket terkini), Playwright. Isi `docs/VERSIONS.md` | P0 |
| A12 | Strategi test | LiteSVM untuk program (termasuk Token-2022 & clock warp), test paritas math SDK vs on-chain, test worker dengan DB, e2e Playwright + dev wallet, alur `bun run verify` | P0 |
| A02 | Anchor di monorepo | Cara menaruh workspace Anchor di `anchor/` via command resmi; keypair program stabil di `anchor/keys/` + sinkronisasi ID; integrasi turbo (`anchor build` → codegen → sdk); deploy ke localnet & devnet di Anchor versi ini | P1 |
| A03 | Token-2022 & Scaled UI | Dukungan anchor-spl untuk Token-2022, `token_interface`, `transfer_checked` lintas program token; membuat mint dengan ScaledUiAmount & update multiplier dari program (anchor-spl vs crate spl-token-2022); membaca multiplier efektif di program & di Kit | P2 |
| A04 | Introspeksi instruksi | API instructions sysvar di Anchor versi ini; verifikasi daftar instruksi antara `begin` dan `end` (§6.3), memastikan top-level; pola keamanan | P2 |
| A05 | Batas transaksi | Jumlah akun per aset per instruksi; ukuran tx join/redeem/zap/rebalance dengan N aset; kebutuhan ALT & compute budget; nilai `MAX_ASSETS` aman; tata letak `remaining_accounts` final | P2 |
| A14 | Review keamanan program | Checklist: validasi akun & owner, signer, PDA seeds, overflow, pembulatan, CPI hanya ke program yang sah, extension Token-2022 (transfer hook, pausable), penguncian saat ticket aktif, DoS (redeem tidak bisa diblokir), inflation/donation attack. Dibuat di P2 (desain), diverifikasi ulang di P5 (implementasi) | P2, P5 |
| A06 | Sumber harga | Jupiter Price API terbaru (endpoint, header key, dukungan mint xStocks/PreStocks); opsi Pyth tanpa biaya (Hermes butuh key? akun on-chain equity mainnet masih ter-update?); perilaku di luar jam bursa; fallback | P6 |
| A07 | Indexing event | Decode event Anchor dengan client Codama/Kit (atau decoder manual dari IDL); subscribe log vs polling; backfill dengan `indexer_state`; idempotensi | P6 |
| A08 | Wallet & dev wallet | Setup @solana/react + kit-plugin-wallet di Next.js App Router (SSR-safe) atau fallback §3; deteksi Phantom/Solflare/Backpack; mendaftarkan dev wallet sebagai Wallet Standard wallet; signMessage untuk auth | P8 |
| A09 | Blinks & OG | Spesifikasi Solana Actions terbaru (GET/POST, actions.json, CORS, chaining); membangun tx dengan Kit; `next/og` untuk kartu index | P8 |
| A11 | Design system & wireframe | Token final, inventaris komponen shadcn, wireframe teks tiap halaman (§8.5), pemetaan error program → pesan UI | P8 |
| A10 | MCP | Server stdio + Streamable HTTP dengan SDK terbaru; definisi tool (zod); resource; cara uji (client programatik / MCP Inspector); snippet konfigurasi Claude Desktop/Code | P9 |
| A13 | Devnet | Biaya & cara deploy program di devnet (faucet, batas), upgrade authority, bootstrap devnet, anggaran SOL price feeder, konfigurasi web untuk devnet | P11 |

---

## 10. Fase implementasi

Setiap fase: analisis terkait → `docs/plans/Pxx-nama.md` (Lampiran B) → implementasi → **gate** → update `STATUS.md`. Semua gate harus bisa dicek otomatis oleh agent (command/test), bukan oleh manusia.

### P0 — Persiapan
- CLAUDE.md, struktur `docs/`, STATUS, DECISIONS. A01, A12.
- Gate: `docs/VERSIONS.md` berisi versi & sumber semua tool di §3; prasyarat terpasang (bun, rust, avm/anchor, validator, docker) atau cara install + fallback dicatat; `.keys/` (admin, keeper, agent) + `.keys/solana-cli.yml` ada; saldo SOL devnet admin tercatat di `STATUS.md`.

### P1 — Scaffold monorepo
- A02. Init monorepo (Turborepo + Bun) dengan command resmi; `apps/web` (create-next-app), shadcn init, `apps/worker`, `apps/mcp`, `packages/{config,sdk,db}` (bun init), workspace Anchor di `anchor/` (anchor init + anchor new untuk program kedua; keypair program di `anchor/keys/`), Biome, Playwright init, drizzle-kit, docker-compose Postgres, `.env.example` (§12), turbo pipeline (`build, dev, lint, typecheck, test, codegen`), script root (`setup, dev, dev:devnet, seed, price, warp, ipo, test:program, test:ts, e2e, e2e:visual, verify, verify:devnet, deploy:devnet`; boleh stub yang mencetak "not implemented yet" dan exit 0 sampai fasenya).
- Gate: `bun run setup`, `bun run lint`, `bun run typecheck`, `bun run build` hijau; `anchor build` hijau untuk program kosong.

### P2 — Kontrak & codegen
- A03, A04, A05, A14 (desain). Tulis semua akun, enum, error, event, konstanta, dan signature instruksi (§5) di kedua program; body boleh `NotImplemented`. Pipeline Codama → `packages/sdk/src/generated`. Skema Drizzle lengkap (§7.3) + migrasi awal. `packages/config` (env, cluster, registri aset).
- Gate: build + codegen + typecheck hijau; migrasi berjalan di Postgres lokal. **Kontrak beku**; perubahan setelah ini mengikuti prosedur Contract change (Lampiran A).

### P3 — `mock_market`
- Semua instruksi mock_market + test LiteSVM. Script bootstrap idempoten bagian market (market, mint, feed, harga fixture; tulis `deployments/localnet.json`). `scripts/dev.ts` versi awal (validator + deploy + bootstrap). `bun run price`.
- Gate: test hijau; `bun run dev` menyalakan validator + deploy + bootstrap tanpa error.

### P4 — `index_vault` inti
- `init_config, set_config, create_index, join, redeem, accrue_fees, claim_fees, propose/apply/cancel_update, set_managers, set_paused` + test sukses/gagal per error relevan, termasuk Token-2022 dengan multiplier ≠ 1, donasi ke ATA vault diabaikan, redeem saat paused & saat ATA kreator tidak ada. Bootstrap diperluas dengan `init_config` + airdrop admin/keeper/agent.
- Gate: test hijau.

### P5 — Rebalance, IPO, Follow
- `begin/end_rebalance`, `migrate_ipo_asset`, `sync_targets_from_parent` + test: rebalance valid (manager & keeper), slippage, arah salah, cooldown, pemicu belum terpenuhi (keeper), mode Manual menolak keeper, pemanggil tak berhak, `asset_in == asset_out`, begin tanpa end, instruksi asing di antara begin/end (mis. `join`), begin via CPI, instruksi lain saat ticket aktif, oracle basi, PreIpo oleh keeper ditolak, IPO migrasi (termasuk program market palsu ditolak), follow sync. Verifikasi ulang checklist A14 terhadap kode.
- Gate: test hijau; checklist A14 semua terjawab.

### P6 — SDK
- A06, A07. Modul §7.2. Test: paritas math SDK vs state on-chain (localnet), zap in/out end-to-end, rebalance planner + builder, IPO & follow helper, claim fee, split multi-tx + ALT, map error.
- Gate: `bun test` di sdk hijau terhadap validator lokal yang dinyalakan oleh test setup.

### P7 — DB & worker
- Query di `packages/db`; semua loop worker §7.4; `bun run seed`; `bun run ipo`; `bun run warp`; test integrasi dengan Postgres + validator lokal.
- Gate (otomatis via script test): `bun run dev --ci` + `bun run seed` mengisi semua tabel; snapshot bertambah; `bun run price -- --asset <X> --pct +30` memicu keeper rebalance dalam ≤ 2 interval; `bun run ipo` memigrasi semua index pemegang.

### P8 — Web
- A08, A09, A11. Urutan: design tokens & layout → provider (wallet, query, theme) → dev wallet → halaman §8.5 → Blinks & OG → auth profil → `/sign` untuk intent.
- Gate: build & typecheck hijau; smoke test Playwright: setiap halaman §8.5 render dengan data seed tanpa error console; alur §1.2 no. 1–11 berjalan lewat dev wallet (smoke, bukan e2e lengkap).

### P9 — MCP
- A10. Semua tool §7.6, kedua mode, stdio + HTTP. Test: client MCP programatik memanggil tiap tool; `build_join` → intent → tx dari `/api/intents/[id]/tx` bisa ditandatangani & sukses; `agent_rebalance` sukses pada index yang menunjuk agent dan gagal pada yang tidak.
- Gate: test hijau; bagian "Connect an AI agent" di `docs/DEMO.md` berisi snippet konfigurasi Claude Desktop/Code yang sama dengan yang dipakai client test.

### P10 — E2E, review visual, dokumentasi
- Playwright e2e untuk skenario §11.1 memakai dev wallet. Review visual §8.8. `README.md` (prasyarat, ≤ 5 perintah dari clone sampai jalan, tabel perintah, port), `docs/DEMO.md` (skenario demo langkah demi langkah), `docs/ARCHITECTURE.md`.
- Gate: e2e hijau; A15-ui-review selesai sesuai aturan §8.8.

### P11 — Devnet
- A13. `bun run deploy:devnet` (deploy program dengan keypair di `anchor/keys/`, init config, bootstrap, `deployments/devnet.json`), `bun run dev:devnet` (worker + web + MCP lokal menunjuk devnet), faucet SOL devnet dari wallet admin, seed devnet ringan (2–3 index contoh agar Explore/Leaderboard tidak kosong). Deployer = `.keys/admin.json` (sudah didanai user sebelum eksekusi). Smoke test otomatis terhadap devnet dengan Dev Wallet: faucet → create → join → redeem. Bila SOL devnet habis/tidak cukup: script tetap selesai & teruji sampai titik deploy, tandai `BLOCKED(eksternal)`.
- Gate: script terdokumentasi; deploy berhasil atau blocked dengan alasan jelas.

### P12 — Verifikasi akhir
- Clone repo ke direktori baru, ikuti README apa adanya, jalankan `bun run verify`. Perbaiki semua kegagalan. Selesaikan item tertunda. Update `STATUS.md` final.
- Gate: seluruh §11 hijau.

### Tambahan (hanya setelah §11 hijau)
- Pool LP share token/USDC (constant product) di `mock_market` + UI "Provide liquidity" di halaman index.
- Performance fee dengan high-water mark.
- Notifikasi in-app (index yang di-follow rebalance, IPO).

Kepemilikan file untuk skrip & paket bersama: `scripts/dev.ts`, `scripts/bootstrap*`, `scripts/price*` → P3 (diperluas P4, P7); `scripts/codegen.ts`, `packages/config/**` (kecuali `deployments/`) → P2; `scripts/seed*`, `scripts/ipo*`, `scripts/warp*` → P7; `scripts/verify*` → P10; `scripts/deploy-devnet*` → P11; `packages/sdk/src/generated/**` → hanya hasil codegen.

---

## 11. Definition of Done

### 11.1 Skenario (otomatis via Playwright + script, di localnet bersih)
1. `bun run setup && bun run dev` menyalakan semua layanan tanpa langkah manual lain.
2. User A (dev wallet): faucet → create index 3 saham + 1 pre-IPO, strategi Threshold 5% dengan `allow_keeper`, mgmt fee 5% → setoran awal via zap ≥ $100k.
3. User B: buka link index A → Join $1,000 via zap → share token & posisi tampil → NAV & chart tampil.
4. User C: Clone index A dengan bobot diubah → setor ≥ $100k → index C mencatat A sebagai induk. User C juga membuat index D yang Follow index A.
5. A menunjuk wallet agent sebagai manager. Test client MCP: `get_leaderboard` → `simulate_rebalance` → `agent_rebalance` sukses; rebalance yang melanggar mandate ditolak dengan pesan manusiawi.
6. `bun run price -- --asset <saham di index A> --pct +30` (D026) → drift melewati ambang → keeper rebalance otomatis → activity tercatat.
7. A mengubah bobot (propose → apply) → index D (follow) tersinkron.
8. `bun run ipo -- --asset <pre-ipo di index A>` → index A, C, D bermigrasi → timeline & badge `ipo_survivor`.
9. `bun run warp -- --days 30` (bila tersedia; bila tidak, tunggu ≥ 60 detik) → A `claim_fees(Creator)` di index A dan `claim_fees(Parent)` di index C → saldo share > 0; platform treasury bisa klaim.
10. B Redeem ke USDC (zap out) → saldo USDC bertambah → posisi hilang dari portfolio.
11. Leaderboard, profil, XP, badge terisi dan konsisten dengan kejadian di atas (termasuk `first_index`, `first_join`, `cloned`, `ai_manager`, `ipo_survivor`).
12. Blink endpoint mengembalikan transaksi valid yang bisa ditandatangani dev wallet; OG image ter-render.

### 11.2 Kualitas
- `bun run verify` hijau: lint, typecheck, test program (LiteSVM), test TS, build, e2e.
- Setiap instruksi program punya test sukses + test gagal untuk tiap error relevan.
- Tidak ada `TODO`/`NotImplemented` tersisa di jalur utama.
- Review visual selesai sesuai §8.8; tidak ada pelanggaran §8.2.
- README memungkinkan orang baru menjalankan project dari clone dalam ≤ 5 perintah (plus prasyarat).
- `STATUS.md` semua centang, item `BLOCKED(eksternal)` hanya untuk hal di luar kendali kode dan ada alasannya.

### 11.4 Siap uji manual user (Phantom, Chrome, devnet)
Target akhir project: user bisa menguji sendiri, tanpa bantuan agent, seluruh alur §1.2 no. 1–12.
- `docs/DEMO.md` berisi panduan uji manual langkah demi langkah: prasyarat (Chrome + Phantom, Developer Settings → Testnet Mode → Solana Devnet), perintah menyalakan stack (`bun run dev:devnet`), dan per flow: apa yang diklik, hasil yang diharapkan, dan perintah admin pendukung (`bun run price`, `bun run ipo`, dll. dengan `--cluster devnet`).
- Semua alur §1.2 bisa dijalankan dengan Phantom di devnet: connect → faucet SOL & USDC → create → share/link → join (zap) → redeem → clone → follow → manage (propose/apply dengan timelock 120 detik) → rebalance (keeper otomatis & via MCP agent) → leaderboard/profil/XP/badge → IPO event → claim fee.
- Transaksi yang dikirim ke Phantom adalah v0 (+ALT bila perlu) dan lolos simulasi Phantom (tidak ada peringatan "transaction may fail" pada alur normal). Diverifikasi agent dengan simulasi RPC devnet atas transaksi yang sama.
- Localnet tetap bisa diuji manual dengan Dev Wallet (`bun run dev`).
- Keterbatasan yang tidak bisa dihilangkan dicatat jelas di `docs/DEMO.md` (mis. `warp` tidak tersedia di devnet → akrual fee terlihat kecil; Blink di X/dial.to butuh URL publik).

### 11.3 Loop penyelesaian
Setelah P12: jalankan ulang §11.1 dan §11.2. Jika ada yang gagal, perbaiki dan ulangi. Berhenti hanya ketika semuanya hijau, lalu tulis ringkasan akhir di `STATUS.md` (apa yang jadi, cara menjalankan, keterbatasan).

---

## 12. Environment variables (`.env.example`)

Satu file `.env` di root, dibaca semua app (lihat §7.9).

```
# cluster
CLUSTER=localnet                 # localnet | devnet
RPC_URL=http://127.0.0.1:8899
WS_URL=ws://127.0.0.1:8900
NEXT_PUBLIC_CLUSTER=localnet
NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8899
NEXT_PUBLIC_WS_URL=ws://127.0.0.1:8900
NEXT_PUBLIC_APP_NAME=Stocklana
WEB_URL=http://localhost:3000

# db
DATABASE_URL=postgres://postgres:postgres@localhost:5434/app

# keys (path ke file keypair lokal, jangan commit)
ADMIN_KEYPAIR_PATH=.keys/admin.json
KEEPER_KEYPAIR_PATH=.keys/keeper.json
AGENT_KEYPAIR_PATH=.keys/agent.json   # kosongkan = MCP hanya mode human-in-the-loop

# harga
PRICE_MODE=random                # live | random
JUPITER_API_KEY=
PYTH_API_KEY=                    # opsional
FINNHUB_API_KEY=                 # opsional, fallback harga saham US
MAINNET_READ_RPC_URL=https://api.mainnet-beta.solana.com   # hanya baca harga (setup: Helius mainnet dari .env.test)
DEVNET_RPC_URL=https://api.devnet.solana.com                # setup: Helius devnet dari .env.test

# worker interval (detik)
PRICE_INTERVAL=15                # devnet disarankan 60
SNAPSHOT_INTERVAL=60
KEEPER_INTERVAL=30
FEES_INTERVAL=300
FOLLOW_INTERVAL=30
GAMIFICATION_INTERVAL=60

# mcp
MCP_HTTP_PORT=3333
MCP_MAX_USDC_PER_ACTION=1000

# faucet SOL (devnet: transfer dari admin)
FAUCET_SOL_PER_REQUEST=0.2
FAUCET_SOL_DAILY_CAP=5

# solana cli lokal project (jangan pakai config global)
SOLANA_CLI_CONFIG=.keys/solana-cli.yml
```

Folder `.keys/` dan `.env` di-gitignore; dibuat otomatis oleh `bun run setup`.

---

## Lampiran A — CLAUDE.md

<!-- CLAUDE.md:start -->
# CLAUDE.md

## Konteks
Platform index saham tokenized di Solana (localnet/devnet, semua aset simulasi). User membuat index, membagikannya; orang lain Join/Clone/Follow; kreator dapat fee; rebalance otomatis lewat vault program; social + gamifikasi; AI agent eksternal lewat MCP. Detail lengkap: `docs/PLAN.md`.

## Wajib dibaca sebelum kerja
1. `docs/PLAN.md` (seluruhnya, terutama §0, §5–§8, §10–§11).
2. `docs/STATUS.md` dan `docs/DECISIONS.md`.
3. Analisis & plan fase yang sedang dikerjakan di `docs/analysis/` dan `docs/plans/`.

## Cara kerja
- Kerjakan fase berurutan sesuai `PLAN.md` §10. Per fase: analisis → plan (template di PLAN.md Lampiran B) → implementasi → gate → update STATUS (tanpa commit; lihat Git).
- Jangan berhenti atau menunggu konfirmasi sampai Definition of Done (`PLAN.md` §11) hijau, termasuk §11.4: user bisa menguji manual semua flow §1.2 di Chrome dengan Phantom (devnet) mengikuti `docs/DEMO.md`.
- Ambiguitas: pilih opsi paling sederhana yang sesuai PLAN, catat di `docs/DECISIONS.md`, lanjut.
- Gagal 3 pendekatan berbeda: pakai fallback, catat, lanjut, kembali di P12.

## Setup & scaffold
- Semua init project memakai command resmi dari docs tool (mis. generator Turborepo, create-next-app, shadcn init/add, anchor init/new, bun init, drizzle-kit, Playwright init). Dilarang membuat file init secara manual.
- Selalu baca dokumentasi resmi terbaru sebelum menjalankan command setup. Jangan memakai command dari ingatan. Catat sumber di `docs/analysis/A01-toolchain.md` dan versi di `docs/VERSIONS.md`.
- Generator yang menolak direktori tidak kosong: jalankan di direktori sementara lalu pindahkan. Matikan git init bawaan generator (tidak boleh ada `.git` bersarang).
- Pakai Bun untuk semua (`bun`, `bunx`, `bun add`). Jangan npm/yarn/pnpm.
- Komponen UI hanya shadcn/ui (tambah via `shadcn add`).

## Stack
Bun + Turborepo + Biome · Anchor (LiteSVM test, Surfpool localnet) · @solana/kit + client Codama · Next.js App Router + Tailwind + shadcn/ui + TanStack Query · @solana/react + kit-plugin-wallet (Wallet Standard) · PostgreSQL + Drizzle (driver postgres.js) · MCP TypeScript SDK · Playwright.
Dilarang: `@solana/web3.js` v1, `@solana/wallet-adapter-*`, `@coral-xyz/anchor`, `@anchor-lang/core`, `bun:sql` di kode yang dipakai Next.js, library UI lain.

## Jaringan
- Default localnet, kedua devnet. Transaksi ke mainnet dilarang.
- Pengecualian: price feeder boleh membaca data harga mainnet (read-only).
- Semua aset & harga diberi label "Simulated" di UI.
- Tahap 1 localnet (test otomatis + Dev Wallet). Tahap 2 devnet (uji manual Phantom oleh user). Phantom tidak mendukung localnet secara resmi.

## Batas sistem lokal (mesin user)
- Hanya menulis di folder repo ini dan `/tmp` (atau scratchpad). Cache standar tool boleh: `~/.cargo`, `~/.cache/solana`, `~/.bun/install/cache`, `~/Library/Caches/ms-playwright`, volume Docker/OrbStack.
- **Jangan pernah mengubah config global Solana** (`~/.config/solana/**`). Setiap perintah `solana`/`solana-keygen`/`spl-token` wajib memakai `-C .keys/solana-cli.yml` dan/atau `-k .keys/<nama>.json` + `-u <url>` eksplisit. Anchor memakai `[provider]` di `Anchor.toml` atau `--provider.wallet`/`--provider.cluster`.
- Keypair project: `.keys/admin.json` (deployer, upgrade authority, market authority, pendana faucet SOL devnet), `.keys/keeper.json`, `.keys/agent.json`. Jangan dibuat ulang bila sudah ada.
- Rust/Anchor/AVM/Agave/Surfpool boleh diubah hanya bila memang diperlukan; catat di `docs/DECISIONS.md` dan `docs/VERSIONS.md`. Jangan menghapus versi/toolchain lain milik user, jangan edit `~/.zshrc`/profil shell.
- Jangan menghentikan/menghapus container, volume, atau proses milik project lain. Port project: web 3000, MCP 3333, RPC 8899, WS 8900, Postgres 5434.

## Kontrak
Kontrak = akun, instruksi, event, error program; skema DB; tool MCP. Beku setelah P2. Mengubahnya:
1. Update `PLAN.md` §5/§7 dulu + catat di `docs/DECISIONS.md`.
2. Update program + `anchor build` + regenerate Codama client dalam satu langkah kerja yang sama.
3. Catat entri log `contract:` di `docs/STATUS.md`.
Jangan mengubah kontrak demi membuat test lolos tanpa alasan yang dicatat.

## Kepemilikan file (bila memakai subagent paralel)
| Area | Pemilik |
|---|---|
| `anchor/programs/*/src/{state,error,events,constants}.rs`, `anchor/crates/index_math/**`, `packages/db/schema*` | kontrak (hanya via Contract change) |
| `scripts/codegen.ts`, `packages/config/**` (kecuali `deployments/`) | P2 |
| `anchor/programs/mock_market/**`, `scripts/{dev,bootstrap,price}*` | P3 (diperluas P4, P7) |
| `anchor/programs/index_vault/src/instructions/**` | P4, P5 |
| `packages/sdk/**` (kecuali `generated/`, hanya hasil codegen) | P6 |
| `apps/worker/**`, `packages/db/queries*`, `scripts/{seed,ipo,warp}*` | P7 |
| `apps/web/**` | P8 |
| `apps/mcp/**`, bagian "Connect an AI agent" di `docs/DEMO.md` | P9 |
| `e2e/**`, `scripts/verify*`, `README.md`, `docs/DEMO.md` (sisanya), `docs/ARCHITECTURE.md` | P10 |
| `scripts/deploy-devnet*` | P11 |
Subagent tidak mengedit file pemilik lain; permintaan ditulis di plan fasenya.

## Aturan program (Rust)
- Checked math, `u128` untuk hitungan antara, tanpa float kecuali membaca multiplier Scaled UI.
- Pembulatan menguntungkan vault.
- Selalu `transfer_checked` dengan program token sesuai mint (Token / Token-2022).
- Validasi setiap akun di `remaining_accounts` (urutan, mint, owner) dan setiap program yang di-CPI (hanya program yang sah di config).
- Saldo vault pakai pembukuan internal (`AssetEntry.balance`), bukan saldo ATA.
- Selama rebalance ticket aktif, semua instruksi index selain `end_rebalance` ditolak.
- Redeem tidak boleh bisa diblokir kreator (fee dicatat sebagai owed, diklaim terpisah).
- Tiap instruksi: test sukses + test gagal per error relevan.

## Aturan TypeScript
- Strict. Env divalidasi zod di `packages/config`.
- Akses chain hanya lewat `packages/sdk`; akses DB hanya lewat `packages/db`.
- Math SDK identik dengan program (ada test paritas).
- Tanpa `any` kecuali di batas generated code.

## UI
- Ikuti `PLAN.md` §8: monokrom + warna bermakna, angka tabular, satu aksi utama per layar, semua state (loading/empty/error) ada.
- Dilarang pola "AI slop" di §8.2.
- Setiap halaman baru: cek light/dark, 375px & 1280px.

## Keamanan
- Jangan commit secret/keypair (`.env`, `.keys/` di-gitignore).
- MCP tidak pernah mengembalikan secret atau isi env.
- Keypair agent/keeper hanya bertindak lewat instruksi yang dibatasi program.

## Konvensi
- Kode & komentar bahasa Inggris; dokumen `docs/` bahasa Indonesia; copy UI bahasa Inggris.
- Semua dokumen proyek (plan, analisis, spec, status, keputusan) ada di `docs/`. Di root hanya `CLAUDE.md` dan `README.md`.

## Git
- **Agent tidak menjalankan `git commit`, `git push`, `git config`, atau perintah git yang mengubah riwayat/konfigurasi.** User yang mengelola git. Perintah baca (`git status`, `git diff`) boleh.
- Pengganti commit: setiap selesai fase/langkah berarti, tambah entri di bagian Log `docs/STATUS.md` (tanggal, fase, ringkasan, gate). Repo harus selalu bisa di-build di akhir setiap fase.
- Generator tetap dijalankan tanpa git init (`--no-git`/`--disable-git`).

## Perintah
Diisi setelah P1 (ganti TBD dengan perintah nyata):
| Tujuan | Perintah |
|---|---|
| Setup awal | `bun run setup` |
| Jalankan semua (localnet) | `bun run dev` |
| Data demo | `bun run seed` |
| Ubah harga | `bun run price -- --asset <SYMBOL> --pct <+/-N>` |
| Time-travel | `bun run warp -- --days <N>` |
| Event IPO | `bun run ipo -- --asset <SYMBOL>` |
| Verifikasi penuh | `bun run verify` |
| Test program | `bun run test:program` |
| Test TS | `bun run test:ts` |
| E2E | `bun run e2e` |
| Deploy devnet | `bun run deploy:devnet` |
| Jalankan stack lokal → devnet | `bun run dev:devnet` |
| Verifikasi kesiapan devnet/Phantom | `bun run verify:devnet` |
<!-- CLAUDE.md:end -->

---

## Lampiran B — Template plan fase (`docs/plans/Pxx-nama.md`)

```
# Pxx — Nama fase

## Tujuan
## Referensi (bagian PLAN.md & analisis terkait)
## Scope (masuk / tidak masuk)
## Desain singkat
## Tugas
- [ ] …
## Gate / kriteria selesai
- [ ] …
## Risiko & fallback
## Catatan untuk fase berikutnya
```
