# Landing page Stockbreak — brief konten & desain

Dokumen ini adalah referensi tunggal untuk designer dan copywriter yang membuat landing page **Stockbreak**. Isinya: ringkasan produk, arah visual, lalu setiap section dari atas ke bawah dengan copy final (bahasa Inggris, siap pakai), arahan visual, dan sumber faktanya di repo.

- Bahasa: penjelasan untuk designer ditulis dalam bahasa Indonesia. Semua teks di dalam blok **Copy** adalah teks final untuk halaman (bahasa Inggris, sesuai konvensi UI).
- Semua angka di copy punya sumber (tabel "Sumber fakta" di akhir). Jangan menambah angka yang tidak ada di sana.
- Diperbarui: 25 Sep 2026, dari kondisi repo saat itu (README, `docs/PLAN.md`, `docs/DECISIONS.md` sampai D044, `refs/hackathon.md`, `docs/analysis/A17-riset-hackathon.md`, kode `apps/*`).

---

## 0. Ringkasan untuk designer (baca dulu)

### 0.1 Produk dalam satu paragraf
Stockbreak adalah **launchpad index untuk saham tokenized di Solana**. Siapa pun bisa mengubah tesis saham ("AI infrastructure + Anthropic + SpaceX") menjadi **satu token index**. Orang lain bisa **Join** (masuk pakai USDC, sekali klik atau lewat Blink di X), **Clone** (kreator asli dapat royalti), atau **Follow** (bobot ikut induk secara otomatis). Aturan rebalance ditegakkan oleh **program vault on-chain** (bukan janji tim). Sleeve **pre-IPO PreStocks** bermigrasi sendiri ke saham listing saat IPO. Kreator dapat fee. **AI agent** bisa mengelola index lewat MCP, tapi secara teknis tidak bisa menarik dana. Semuanya dibungkus feed sosial dan leaderboard **Human vs AI**.

### 0.2 Konteks hackathon (kenapa halaman ini ada)
- Dibuat untuk hackathon **Stocklana** (Solana Foundation, tema saham tokenized, total hadiah $126.000, tutup 25 Sep 2026 16:00 ET). "Stocklana" adalah nama event; nama produk adalah **Stockbreak** (D040). Jangan pakai kata "Stocklana" sebagai nama produk di landing.
- Pertanyaan juri: *"Could this be a real app that people will actually use?"* Yang dinilai: user dan masalah nyata, demo end-to-end yang jalan, alasan harus di Solana, kualitas eksekusi. Landing harus menjawab keempatnya.
- Sponsor track yang diambil: **PreStocks** (pre-IPO). Jangan menyebut Tessera atau penerbit pre-IPO lain di mana pun (bisa menggugurkan bounty).
- Kondisi jujur: berjalan di **devnet/localnet**, semua aset **simulasi** on-chain, harga mengikuti data pasar nyata (read-only dari PreStocks API dan Jupiter). Ini wajib terlihat di landing (lihat §0.5).

### 0.3 Istilah (pakai kata yang persis sama)
| Istilah | Arti singkat untuk copy |
|---|---|
| Index | Keranjang hingga 10 saham tokenized dengan bobot target, disimpan di satu vault |
| Share token | Token milik index; memegangnya = memegang bagian vault |
| Join | Masuk ke index dengan USDC, terima share token |
| Redeem | Bakar share token, terima bagian aset (atau USDC) |
| Clone | Salin komposisi index lain jadi index milik sendiri; kreator induk dapat royalti |
| Follow | Index sendiri yang bobotnya otomatis mengikuti index induk |
| Mandate | Aturan yang ditegakkan program: pemicu rebalance, slippage maks, cooldown, keeper, timelock |
| Manager | Wallet (biasanya AI agent) yang boleh rebalance tapi tidak bisa menarik dana |
| Keeper | Bot permissionless yang menjalankan rebalance saat aturan terpicu |
| Zap | Join/Redeem pakai USDC: swap ke setiap aset lalu deposit, otomatis |
| Pre-IPO sleeve | Porsi index berisi token pre-IPO PreStocks (SpaceX, OpenAI, Anthropic, Anduril) |

### 0.4 Arah visual ("quiet green desk", D034)
Landing harus terasa satu keluarga dengan aplikasinya. Referensi rasa: Linear, Stripe, Vercel, Robinhood. Tenang, presisi, data dulu.

**Warna (dark = default)**
| Token | Hex | Pakai untuk |
|---|---|---|
| Ground | `#06140E` | Background halaman |
| Surface | `#0B1C15` | Kartu, panel |
| Raised | `#12271E` | Elemen yang terangkat, hover |
| Line | `#1C3329` | Border 1px |
| Hairline | `#15291F` | Pemisah tabel |
| Muted | `#9BB3A7` | Teks sekunder, satuan |
| Text | `#E8F3EC` | Teks utama |
| Mint | `#4BF0A9` | **Hanya** CTA utama (pill), logo, return positif |
| Coral | `#FF8A7A` | Angka negatif, gagal |
| Amber | `#F4C65A` | Peringatan, paused |
| Index mark | `#D6F5E6` `#8FDDB8` `#4FB58A` `#2A7A5C` | Glyph index (bar bobot bertumpuk) |

Ada varian light dari keluarga hijau yang sama (warna data digelapkan agar kontras cukup). Landing boleh dark-only; bila ada toggle, ikuti token aplikasi di `apps/web/app/globals.css`.

**Tipografi**: Manrope (teks dan angka, `tabular-nums`), IBM Plex Mono hanya untuk ticker (`NVDAx`, `SPACEX-pre`) dan alamat/program ID. Angka adalah pahlawan: besar, tabular, satuan kecil dan redup.

**Bentuk**: radius tag 6, mark 8, kontrol 10, kartu 16. Hanya CTA utama berbentuk pill. Border 1px, tanpa shadow berat. Glass (blur) hanya untuk top bar yang sticky.

**Aset visual yang sudah ada (pakai, jangan diganti ilustrasi)**
- Screenshot asli: `docs/media/dark-1280-home.png`, `dark-1280-index.png`, `dark-1280-feed.png`, `dark-1280-leaderboard.png`, `dark-1280-create-5-review.png`, `dark-375-index.png` (mobile).
- Index mark: glyph bar bobot bertumpuk 4 hijau (dipakai di header index & kartu).
- Kartu index untuk feed dalam 3 variasi header: `mark` (pola index mark), `tokens` (tile token sebesar bobotnya), `chart` (kurva performa) — D035. Ini aset paling "shareable" untuk landing.
- Logo token resmi (xStocks, PreStocks, USDC) lewat `/api/token-logos`; logo penerbit dianggap informasi, bukan dekorasi (D041).
- Overlay progres transaksi (progress ring + daftar tahap) — D042. Bagus untuk section "How it works".
- Klip demo 1280×720 per adegan dari `bun run demo:record` (`e2e/demo/01-markets.webm` … `08-portfolio.webm`). Bisa dipotong jadi loop pendek tanpa suara untuk section fitur.

**Dilarang (PLAN §8.2, tetap berlaku di landing)**: gradien ungu-biru, glassmorphism di mana-mana, glow/neon, emoji, ilustrasi 3D/stok, background animasi, teks/border gradien, semua elemen di-center, kartu di dalam kartu di dalam kartu, ikon di setiap label, badge warna-warni tanpa makna, kata "Revolutionize / Unlock / Seamless / Next-gen", lorem ipsum, angka palsu tanpa label. Pola "hero + 3 kartu fitur ber-ikon" juga dihindari: tunjukkan produk asli (screenshot, kartu index, angka) sebagai gantinya.

**Gerak**: halus dan fungsional saja (tick angka, garis chart tergambar sekali saat masuk viewport, hover). Tanpa parallax atau animasi dekoratif terus-menerus. Hormati `prefers-reduced-motion`.

### 0.5 Aturan kejujuran (wajib tampil)
- Label **"Simulated"** atau **"Devnet"** dekat setiap angka harga/return yang berasal dari demo.
- Disclaimer di hero (baris kecil) dan footer: *"Runs on Solana devnet. Every asset is simulated on-chain; prices follow real market data. Not investment advice."*
- Angka pasar (850K holders, $3.3B) adalah data industri dengan sumber, bukan traksi Stockbreak. Beri keterangan sumber kecil.

### 0.6 Placeholder yang harus diisi sebelum publish
| Placeholder | Isi dengan |
|---|---|
| `{LIVE_DEMO_URL}` | URL demo devnet publik (lihat `docs/DEPLOY.md`) |
| `{PITCH_VIDEO_URL}` | Video pitch ≤3 menit |
| `{TECH_VIDEO_URL}` | Video teknis ≤5 menit |
| `{GITHUB_URL}` | Repo publik (`viandwi24/stocklana`) |
| `{MCP_URL}` | `https://<web>/api/mcp` (D043) |
| `{X_URL}` | Akun X bila ada; bila tidak, hapus ikonnya |

### 0.7 Struktur halaman (urutan)
1. Top bar
2. Hero
3. Market proof strip
4. Problem
5. How it works (4 langkah)
6. Feature: Index as a token
7. Feature: Rules on-chain (mandate + flash rebalance)
8. Feature: Pre-IPO sleeve + IPO migration (PreStocks)
9. Feature: Creator economy (fees, clone royalty, follow)
10. Feature: AI agents over MCP
11. Feature: Social loop (feed, index cards, Blinks) + Human vs AI league
12. Who it's for (3 persona)
13. Comparison
14. Why Solana
15. Trust & security
16. Built for real (quality + stack)
17. Try it in 60 seconds
18. FAQ
19. Final CTA
20. Footer

Setiap section di bawah memakai format: **Tujuan** · **Copy** · **Visual** · **Catatan/Sumber**.

---

## 1. Top bar

**Tujuan**: navigasi cepat + satu CTA yang selalu terlihat.

**Copy**
- Logo: `Stockbreak` (wordmark Manrope bold + mark seperti di aplikasi: kotak mint radius 8 berisi tiga bar naik warna gelap; lihat `apps/web/app/layout.tsx`)
- Link: `How it works` · `Pre-IPO` · `AI agents` · `Creators` · `FAQ` · `GitHub`
- Badge kecil di kanan (outline, amber tipis atau netral): `Devnet`
- CTA pill (mint): `Launch app`

**Visual**
- Sticky, `glass-bar` (Ground 62% + blur 24px), border bawah 1px Line. Tinggi 56–64px.
- Mobile: logo + `Launch app` + tombol menu (sheet).

**Catatan**: `Launch app` → `{LIVE_DEMO_URL}`. Link section memakai anchor (`#how`, `#pre-ipo`, `#agents`, `#creators`, `#faq`).

---

## 2. Hero

**Tujuan**: dalam 5 detik pengunjung paham "ini apa, untuk siapa, kenapa beda", lalu klik Launch app.

**Copy**
- Eyebrow (mono, kecil, Muted): `THE INDEX LAUNCHPAD FOR TOKENIZED STOCKS · ON SOLANA`
- Headline (pilih satu; rekomendasi A):
  - A: **Turn your stock thesis into an index token.**
  - B: **One token. Your whole thesis. Rebalanced by code.**
  - C: **Build the index. Share it. Earn when others join.**
- Subheadline:
  > Pick up to 10 tokenized stocks and pre-IPO names, set the weights and the rules. Others join with USDC in one click or one Blink. A Solana vault program enforces the rebalancing — not us.
- CTA utama (pill mint): `Launch app`
- CTA sekunder (outline): `Watch the 3-min demo`
- Baris bukti di bawah CTA (Muted, 13px, dipisah titik tengah):
  `Self-custodied` · `Redeem anytime` · `Rules enforced on-chain` · `PreStocks pre-IPO`
- Disclaimer (12px, Muted): `Live on Solana devnet. Assets are simulated; prices follow real market data. Not investment advice.`

**Visual**
- Layout rata kiri, dua kolom di desktop (teks 5/12, visual 7/12). Jangan center semua.
- Visual kanan: **kartu index "Magnificent Four" (MAG4)** yang hidup, dibangun dari data asli:
  - Header: index mark + `Magnificent Four` `MAG4` · `by @alice` · tag `Pre-IPO · PreStocks` · tag `Simulated`.
  - Angka besar: share price `$1.0000` + `24h +0.55%` (mint) + `7d +2.38%`.
  - Mini chart garis mint vs garis putus-putus abu `SPYx` (label "Is it beating SPYx?").
  - Bar alokasi bertumpuk: `AAPLx 40%` · `NVDAx 30%` · `TSLAx 20%` · `SPACEX-pre 10%` dengan logo token.
  - Di sudut: panel Join kecil (`Amount (USDC) 1,000` → `Estimated shares 982.09` → pill `Join`).
  - Opsional: kartu kedua di belakang sedikit bergeser (variasi header `tokens`) untuk memberi kedalaman tanpa 3D.
- Animasi sekali saat load: chart tergambar, angka share price tick 1–2 kali.
- Mobile: headline → sub → CTA → kartu (lebar penuh) di bawah.

**Catatan/Sumber**: data MAG4 dari seed (`scripts/seed.ts`) dan screenshot `docs/media/dark-1280-index.png`. Angka di kartu hero adalah contoh simulasi; tag `Simulated` wajib ada.

---

## 3. Market proof strip

**Tujuan**: menunjukkan pasarnya nyata dan besar (bukan traksi Stockbreak).

**Copy**
- Label kiri (Muted): `Tokenized stocks on Solana, Sep 2026`
- 3–4 angka (besar, tabular) dengan label kecil:
  - **850K+** — `holders, all-time high`
  - **$3.3B** — `volume in 30 days`
  - **63%+** — `of activity outside US market hours`
  - **37.6K** — `holders of Anthropic pre-IPO tokens`
- Sumber (11–12px): `Source: Solana Compass, 20 Sep 2026`

**Visual**: satu baris horizontal tipis di bawah hero, dipisah garis vertikal 1px. Bukan kartu. Mobile: grid 2×2.

**Alternatif** (bila ingin produk, bukan pasar): strip ticker aset simulasi seperti di home app (`AAPLx $336.52 +0.4%` · `NVDAx` · `SPACEX-pre` …) dengan label `Simulated prices`.

---

## 4. Problem

**Tujuan**: tiga masalah nyata, satu per persona. Pendek dan konkret.

**Copy**
- Section title: **Tokenized stocks are here. Portfolios aren't.**
- Tiga blok (nomor `01 02 03` mono, bukan ikon):
  1. **Every token is one ticker.**
     If you believe in AI infrastructure plus Anthropic and SpaceX, you're managing ten positions by hand — and rebalancing them yourself, forever.
  2. **Creators can't ship their thesis.**
     61% of investors aged 18–34 act on finfluencer picks, but packaging a thesis into something people can buy still means starting a fund. Copy apps are off-chain, US-only and run on subscriptions.
  3. **Pre-IPO tokens come with deadlines.**
     After the SpaceX IPO, SpaceX PreStocks had to be swapped into SPCXx before 12 Mar 2027 — or they expire. Holders who forget lose everything.

**Visual**: tiga kolom teks rata kiri (desktop), stack (mobile). Pada blok 3 boleh ada elemen kecil "countdown/deadline" bergaya tag amber `Deadline · Mar 12, 2027 23:59 UTC`. Tanpa ilustrasi.

**Sumber**: README "The problem"; FINRA Foundation 2026; pengumuman PreStocks di X (A17 §2).

---

## 5. How it works (4 langkah)

**Tujuan**: alur end-to-end dari kreator ke investor, dengan screenshot asli.

**Copy**
- Section title: **From thesis to token in four steps.**
- Subtitle: `No fund, no paperwork. Just a wallet.`
- Langkah:
  1. **Create** — Pick up to 10 assets, set weights, choose a strategy (Hold, rebalance on drift, or periodic) and your fees. The wizard previews your index card live.
  2. **Share** — Every index gets a link, an OG image, a feed card and a Solana Blink, so it can be joined straight from X or Discord.
  3. **Join** — Investors pay in USDC. Stockbreak swaps into every asset at oracle prices and deposits into the vault. They get share tokens and can redeem anytime.
  4. **Stay balanced** — When weights drift past your rule, a permissionless keeper rebalances in one atomic transaction. If it breaks the rules, it reverts.

**Visual**
- Stepper horizontal (desktop) / vertikal (mobile). Setiap langkah punya panel visual yang berganti saat step aktif (tab/scroll-driven sederhana):
  1. Create → `dark-1280-create-5-review.png` atau klip `02-create.webm`.
  2. Share → kartu index variasi `tokens` + chip `Copy Blink link`.
  3. Join → overlay progres transaksi (ring 60%, tahap: `Swap USDC → AAPLx ✓`, `Swap → NVDAx ✓`, `Deposit to vault · Approve in your wallet`).
  4. Stay balanced → baris aktivitas `Rebalanced · drift 12% → 0%` + mini bar alokasi yang kembali ke target.
- Nomor langkah dalam mono. Garis penghubung 1px Line.

---

## 6. Feature — Index as a token

**Tujuan**: pembeda #1: index adalah token sungguhan, bukan portofolio yang disalin ke tiap wallet.

**Copy**
- Eyebrow: `INDEX = TOKEN`
- Title: **A real index token, not a copied portfolio.**
- Body:
  > Each index is a vault owned by a Solana program plus its own share mint. Joining deposits every asset in the vault's exact ratio and mints shares; redeeming burns shares for the underlying — ETF-style, in-kind. After the first deposit no oracle is needed, which makes it hard to manipulate. The app zaps USDC in and out for you.
- Poin (list pendek, tanpa ikon):
  - `Up to 10 assets per index`
  - `In-kind mint and redeem, USDC zap`
  - `Redeem can never be blocked by the creator`
  - `Fully self-custodied — no one holds your funds`

**Visual**: diagram sederhana (SVG, garis 1px, warna token) — `USDC → [swap ×n] → Vault (PDA) → Share tokens` dan arah sebaliknya untuk redeem. Di sebelahnya tabel Allocation mini (Asset · Weight · Target · Drift) dari screenshot index.

---

## 7. Feature — Rules on-chain (mandate + flash rebalance)

**Tujuan**: pembeda #2 dan #4: aturan ditegakkan program, rebalance atomik yang tidak bisa curang.

**Copy**
- Eyebrow: `THE MANDATE`
- Title: **Rules the program enforces. Not promises.**
- Body:
  > Every index carries a mandate: when to rebalance, how much slippage is allowed, how long to wait between trades, whether a keeper may act, and a timelock on any change to weights or fees — so holders see changes coming and can exit first.
- Sub-block "Flash rebalance":
  - Title kecil: **One transaction. All or nothing.**
  - Body:
    > `begin_rebalance` lends the overweight asset → swap → return the proceeds → `end_rebalance` checks slippage against the oracle and that every weight moved closer to target. If not, the whole transaction reverts. While a rebalance is open, every other index instruction is refused.
- Daftar pengaturan (tampil seperti panel "Strategy & guards" di app, label kiri, nilai kanan):
  | Setting | Example |
  |---|---|
  | Rebalancing | Rebalance when drift > 5% |
  | Max slippage | 1% |
  | Cooldown | 30s |
  | Keeper | Allowed |
  | Update timelock | 120s on devnet |

**Visual**
- Kiri: panel KV "Strategy & guards" (persis gaya app).
- Kanan: diagram urutan 4 langkah dalam satu kotak transaksi bertanda `1 atomic transaction`; langkah terakhir bercabang: ✓ `commit` (mint) / ✕ `revert` (coral). Pakai teks/garis, bukan ikon emoji.
- Opsional: klip `05-keeper.webm` (NVDA +30% → "Rebalanced").

---

## 8. Feature — Pre-IPO sleeve + IPO migration (PreStocks)

**Tujuan**: cerita terkuat untuk bounty PreStocks. Harus menonjol (section penuh, bukan satu kartu).

**Copy**
- Eyebrow: `PRE-IPO · POWERED BY PRESTOCKS DATA`
- Title: **Hold SpaceX before the IPO. Never miss the conversion.**
- Body:
  > Add PreStocks pre-IPO names — SpaceX, OpenAI, Anthropic, Anduril — to any index. When the company lists, the vault converts the pre-IPO token into the listed stock for every holder at once and keeps the weight. It's the SpaceX → SPCXx conversion PreStocks holders had to do by hand before a deadline, done automatically.
- Tiga baris fakta:
  - `Prices, mark price, premium and implied valuation read live from the PreStocks API`
  - `IPO migration keeps value continuous — no gap, no manual swap`
  - `Followers of the index migrate too`
- Microcopy di bawah tabel: `Token = PreStocks on-chain price · Mark = PreStocks reference price · Premium = token ÷ mark − 1`

**Visual**
- Tabel "Pre-IPO · PreStocks" seperti di app: `SPACEX-pre` · Token `$116.87` · Mark `$149.15` · Premium `-21.6%` (coral) · Implied val. `$1.5T`, dengan tag `PreStocks` dan label `Read-only`.
- Timeline horizontal 3 titik: `Pre-IPO: SPACEX-pre 10%` → `IPO event` → `Listed: SPCXx 10%` (bobot tetap). Di bawahnya kontras: "Direct holders: swap before Mar 12, 2027 or tokens expire" (amber) vs "Stockbreak index: migrated automatically" (mint).
- Opsional: klip `06-ipo.webm`.

**Catatan**: logo PreStocks boleh dipakai sebagai atribusi sumber data (bukan kemitraan resmi — jangan tulis "partner" kecuali sudah dikonfirmasi). Jangan menyebut penerbit pre-IPO lain.

---

## 9. Feature — Creator economy (fees, clone royalty, follow)

**Tujuan**: menjawab "kenapa kreator mau membuat index di sini".

**Copy**
- Eyebrow: `FOR CREATORS`
- Title: **Publish a thesis. Earn when people join — and when they remix it.**
- Body:
  > Set your own fees within on-chain limits. When someone clones your index, you earn a royalty on their creator fees. When someone follows it, their vault tracks your weights automatically.
- Fee table:
  | Fee | Range | Paid to |
  |---|---|---|
  | Management | 0–5% / year | Creator |
  | Entry | 0–1% | Creator |
  | Exit | 0–1% | Creator |
  | Clone royalty | 10% of the clone's creator fees | Original creator |
  | Platform | 1% / year | Protocol |
- Kalimat pendek di bawah: `Fees accrue as owed shares and are claimed separately — so a creator can never block a redeem.`
- Tiga kata kerja sebagai sub-block kecil:
  - **Join** — invest in the index as it is.
  - **Clone** — start your own version; the original creator earns a royalty.
  - **Follow** — your own vault that mirrors the parent's weights.

**Visual**
- Kiri: fee table. Kanan: "silsilah" index: `Magnificent Four (MAG4)` → cabang `Mag Four Tilt (MAGT) · Clone` dan `Mag Four Mirror (MAGM) · Follows` (data seed asli), panah royalti bertanda `10%`.
- Opsional: kalkulator mini "estimated earnings per $10k AUM" seperti di step Fees wizard (slider management fee → angka $/tahun). Label `Illustrative`.

---

## 10. Feature — AI agents over MCP

**Tujuan**: pembeda #3: AI boleh mengelola, tidak bisa mencuri. Target: operator agent dan developer.

**Copy**
- Eyebrow: `AI AGENTS · MCP`
- Title: **Let an AI manage the index. It still can't touch the money.**
- Body:
  > Connect Claude, Cursor or any MCP client to Stockbreak's 20 tools. Agents research indexes, simulate rebalances and build transactions. The vault program treats them as managers: they can rebalance within the mandate, but they can never withdraw.
- Dua mode (dua kolom):
  - **You sign** — The agent prepares a request and sends you a link. You review a human-readable summary at `/sign` and approve in your wallet. Resumable, and every step is verified on-chain.
  - **Agent wallet** — The agent holds its own keypair and acts as a manager, bounded by the program. After each rebalance it posts why — the numbers and what's next — to the feed.
- Snippet (code block, mono):
  ```
  claude mcp add --transport http stockbreak {MCP_URL}
  ```
- Contoh prompt (gaya chat, bukan ikon robot):
  > "Create an AI-infra index with $50."
  > → Agent: "Prepared *AI Infra* (NVDAx 40%, MSFTx 35%, ANTHRP-pre 25%, drift 5%). Review and sign: {LIVE_DEMO_URL}/sign?id=…"
- CTA sekunder: `Connect an agent` → `{LIVE_DEMO_URL}/agents`

**Visual**: split — kiri jendela chat minimal (teks saja), kanan halaman `/sign` (ringkasan + tombol Sign + overlay progres). Garis tipis menghubungkan link di chat ke halaman sign. Opsional klip `07-agent.webm`.

**Catatan**: README masih menyebut "18 tools"; jumlah terkini di kode adalah **20** (tambahan `agent_post` dan `get_feed`, D044). Endpoint publik hanya membuka tool riset/simulasi/`build_*`; `agent_*` butuh token operator (D043). Daftar tool untuk halaman detail/FAQ: `list_assets`, `list_indexes`, `get_index`, `get_index_performance`, `get_leaderboard`, `get_portfolio`, `get_feed`, `simulate_rebalance`, `build_create_index`, `build_join`, `build_redeem`, `build_clone`, `get_intent_status`, `agent_info`, `agent_register`, `agent_create_index`, `agent_join`, `agent_rebalance`, `agent_propose_update`, `agent_post`.

---

## 11. Feature — Social loop + Human vs AI league

**Tujuan**: menunjukkan distribusi bawaan (sharing) dan gamifikasi.

**Copy**
- Eyebrow: `SOCIAL`
- Title: **Every index is shareable. Every creator is ranked.**
- Body:
  > Post your index to the feed as a card, discuss it with holders, and turn it into a Solana Blink anyone can join from X. Then see how it stacks up against SPYx — and against the AI agents.
- Sub-block feed: `Feed with Following and All tabs · index cards in three styles · likes and comments · on-chain activity (creates, rebalances, IPO migrations)`
- Sub-block leaderboard:
  - Title kecil: **Human vs AI.**
  - Body: `Indexes and creators ranked by return vs SPYx, AUM, holders, fees earned and clones. Filter humans, AI, or both.`
- Gamifikasi (satu baris): `XP, levels and badges — First index, Ten holders, Cloned, Beat SPY 7d, AI manager, IPO survivor.`
- Anti-spam (baris kecil, Muted): `Posting requires skin in the game: an on-chain join or index on your wallet.`

**Visual**
- Kiri: tiga kartu index berdampingan dengan tiga variasi header (`mark`, `tokens`, `chart`) — ini momen visual paling kaya di halaman; tetap keluarga hijau.
- Kanan: potongan leaderboard (top 3 dengan sparkline 30d + tabel) dengan toggle segmented `All · Human · AI`. Baris agent diberi tag `AI` netral.
- Tambahan kecil: mockup post X yang berisi Blink (tombol `Join $10 / $50 / $100`), dibuat netral tanpa branding X yang meniru persis.
- Sumber screenshot: `dark-1280-feed.png`, `dark-1280-leaderboard.png`.

---

## 12. Who it's for

**Tujuan**: tiga persona dengan satu kalimat nilai dan satu CTA masing-masing.

**Copy**
- Section title: **Built for three kinds of people.**
1. **Investors** — `You want a theme, not ten tickers.`
   Join an index with USDC from Phantom, hold one token, and let the rules keep it balanced. Redeem anytime. → `Explore indexes`
2. **Creators** — `You already have the thesis and the audience.`
   Publish an index, share it as a card or a Blink, and earn fees plus a royalty on every clone. → `Create an index`
3. **AI agent builders** — `You want your agent to trade with guardrails.`
   Plug in over MCP, manage indexes within an on-chain mandate, and compete in the Human vs AI league. → `Connect an agent`

**Visual**: tiga kolom teks dengan garis atas 1px; CTA berupa link teks (bukan tombol ketiga-tiganya — hanya satu aksi utama per layar). Target investor tertulis kecil: `Global retail, outside the US, already holding USDC`.

---

## 13. Comparison

**Tujuan**: posisi jujur vs alternatif, tanpa menjelekkan nama.

**Copy**
- Title: **What makes it different.**

| | Stockbreak | Copy-portfolio apps | Basket apps |
|---|---|---|---|
| Index is a real token (in-kind mint/redeem) | Yes | Copied into each wallet | Some |
| Rebalance rules enforced on-chain | Yes | Off-chain | No |
| Creator fees + clone royalties | Yes | No | Fees only, if any |
| Pre-IPO sleeve that migrates at IPO | Yes | No | No |
| AI managers that cannot withdraw | Yes | No | No |
| Feed, index cards, Blinks, Human vs AI | Yes | Partial | Partial |

**Visual**: tabel hairline. Kolom Stockbreak disorot tipis (Surface), tanda "Yes" pakai teks mint atau titik mint kecil; "No" Muted (bukan coral — ini bukan angka negatif). Mobile: kolom Stockbreak tetap, kolom lain bisa di-scroll horizontal di dalam tabel.

**Catatan**: README menyebut Glider sebagai contoh copy-portfolio app; di landing sebaiknya kategori generik saja.

---

## 14. Why Solana

**Tujuan**: jawab kriteria juri "kenapa harus Solana".

**Copy**
- Title: **Why this only works on Solana.**
- Empat poin (2×2):
  - **~$0.001 per transaction** — A 10-asset join, redeem or rebalance is practical, not a luxury.
  - **Atomic multi-instruction transactions** — The flash-rebalance sandwich and USDC zaps are all-or-nothing.
  - **Where tokenized stocks live** — The widest set of stock issuers (xStocks, Ondo, Backpack) and the only pre-IPO issuers, with Jupiter and Raydium as liquidity.
  - **Token-2022 + Blinks** — Corporate actions handled at the token level, and any index becomes a one-click join from X.

**Visual**: grid 2×2 teks, angka/kata kunci tebal di baris pertama. Logo Solana kecil sekali saja (atribusi), tanpa gradien khas Solana.

---

## 15. Trust & security

**Tujuan**: meyakinkan bahwa "non-custodial" dan "AI tidak bisa mencuri" itu teknis, bukan klaim.

**Copy**
- Title: **Designed so no one can run off with the vault.**
- Daftar (dua kolom, masing-masing judul tebal + satu kalimat):
  - **Program-owned vaults** — Assets sit in accounts owned by a program address. Only a shareholder's redeem moves them out.
  - **Redeem can't be blocked** — Creator fees are booked as owed shares and claimed separately.
  - **Managers can't withdraw** — Agents and managers can only rebalance, within the mandate.
  - **Locked during rebalance** — While a rebalance ticket is open, every other index instruction is refused.
  - **Internal accounting** — Balances are tracked by the program, so tokens sent straight to a vault can't skew the math.
  - **Checked math** — 128-bit checked arithmetic, rounding always in favour of the vault, every CPI and account validated.
- Program ID (mono, kecil, bisa disalin, link ke explorer devnet):
  - `index_vault` `4XaBXM6jZKj3mrQcezjA74ydDEBwiq1amzDtY7ZMc6me`
  - `mock_market` `9WK7engPUC9pegD4wfJN4tCDPcZGxERVifRNHxsehqX8`

**Visual**: daftar rapi dengan garis pemisah hairline. Tanpa ikon gembok/perisai.

---

## 16. Built for real (quality + stack)

**Tujuan**: kualitas eksekusi (kriteria juri) dalam angka.

**Copy**
- Title: **Tested like it holds real money.**
- Angka (besar, tabular):
  - **38** — `program tests (success + failure per error)`
  - **93** — `end-to-end tests, incl. 19 "what can go wrong" scenarios`
  - **59** — `SDK tests, math parity with the program`
  - **20** — `MCP tools`
- Stack (satu baris, mono kecil, dipisah titik tengah):
  `Anchor 1.2 · LiteSVM · Surfpool · @solana/kit + Codama · Wallet Standard · Next.js 16 · shadcn/ui · PostgreSQL + Drizzle · MCP TypeScript SDK · Solana Actions/Blinks · Playwright · Bun + Turborepo`
- Link: `Read the code on GitHub →` `{GITHUB_URL}` · `Technical walkthrough →` `{TECH_VIDEO_URL}`

**Visual**: strip angka seperti §3, lalu baris stack. Tidak perlu logo tiap teknologi.

**Sumber**: README "Quality"; `docs/STATUS.md` (verify ALL GREEN, 93 e2e).

---

## 17. Try it in 60 seconds

**Tujuan**: menurunkan hambatan mencoba demo; menjelaskan setup devnet Phantom.

**Copy**
- Title: **Try it now. No real money involved.**
- Dua jalur (tab atau dua kolom):
  - **With Phantom (devnet)**
    1. Phantom → Settings → Developer Settings → Testnet Mode → Solana Devnet.
    2. Open the app and connect.
    3. Grab SOL and simulated USDC at `/faucet`.
    4. Join *Magnificent Four* with $100.
  - **With the built-in dev wallet**
    1. Open the app → `Connect` → `Dev wallet`.
    2. It's funded automatically.
    3. Join, create, share — everything works.
- CTA pill: `Launch app`
- Link sekunder: `Run it locally →` (ke README) — `Move prices, time-travel 30 days, trigger an IPO.`

**Visual**: dua kolom langkah bernomor mono; screenshot kecil halaman faucet atau tombol Connect. Mobile: tab.

---

## 18. FAQ

**Tujuan**: menjawab keberatan umum secara jujur.

**Copy** (accordion)
- **Is this real money?**
  No. Stockbreak runs on Solana devnet. Every asset is a simulated token that mirrors the real one; prices follow real market data (PreStocks API, Jupiter), read-only.
- **Why not mainnet yet?**
  Buying real tokenized stocks needs jurisdiction checks (issuers serve non-US users only) and real liquidity routing. Going live means swapping in the real mints, routing through Jupiter/Raydium and handling PreStocks' Token-2022 transfer fee.
- **Who holds my funds?**
  You do, until you join. Then a Solana program holds them in the index vault, and only your redeem can take your share out. Not the creator, not an AI manager, not us.
- **Can the creator stop me from redeeming?**
  No. Fees are booked separately, so redeem always works.
- **What happens when a pre-IPO company lists?**
  The vault converts the pre-IPO token into the listed stock token for every holder and keeps the weight. Followers migrate too.
- **What's the difference between Join, Clone and Follow?**
  Join buys into an index as it is. Clone creates your own index from its composition (the original creator earns a royalty). Follow creates your own vault that automatically tracks the parent's weights.
- **How does an AI agent connect?**
  Over MCP. Add the Stockbreak server to Claude, Cursor or any MCP client. By default the agent only prepares requests that you sign; an agent with its own wallet can rebalance as a manager but can never withdraw.
- **Which assets are available?**
  Tokenized US stocks (AAPLx, NVDAx, TSLAx, MSFTx, GOOGLx, AMZNx, METAx), SPYx as the benchmark, and PreStocks pre-IPO tokens (SpaceX, OpenAI, Anthropic, Anduril). Up to 10 per index.
- **Is this investment advice?**
  No.

**Visual**: accordion satu kolom (maks 720px), hairline antar item, chevron kecil (satu-satunya ikon).

---

## 19. Final CTA

**Tujuan**: penutup dengan satu aksi.

**Copy**
- Title: **Your thesis deserves a ticker.**
- Sub: `Create an index in minutes. Share it anywhere. Let the program keep it honest.`
- CTA pill: `Launch app`
- Link: `Watch the demo` · `Read the code`

**Visual**: blok rata kiri di atas Surface dengan index mark besar (glyph bar bobot) di kanan sebagai satu-satunya elemen grafis. Tanpa gradien.

---

## 20. Footer

**Copy**
- Kiri: `Stockbreak` — `The index launchpad for tokenized stocks.`
- Kolom link: **Product** (Launch app, Explore, Leaderboard, AI agents, Faucet) · **Build** (GitHub, MCP docs, Technical video) · **Hackathon** (`Built for Stocklana — Solana Foundation, 2026`, PreStocks track)
- Disclaimer: `Runs on Solana devnet. Every asset and price is simulated on-chain; prices follow real market data (PreStocks, Jupiter). Not investment advice.`
- Badge kecil: `Devnet`

**Visual**: border atas 1px Line, teks 12–13px Muted, 3–4 kolom desktop, stack mobile.

---

## Lampiran A — Alur produk lengkap (untuk referensi visual & copy tambahan)

| # | Alur | Ringkas | Route app |
|---|---|---|---|
| 1 | Onboarding | Connect Phantom/Solflare/Backpack atau dev wallet → faucet SOL & USDC simulasi | `/faucet` |
| 2 | Create | Wizard 5 langkah: Assets → Weights → Strategy → Fees → Details & review, preview kartu live, setoran awal via zap | `/create` |
| 3 | Share | Link, OG image, kartu feed (3 variasi), Blink | `/i/[pubkey]`, `/feed` |
| 4 | Join | USDC → estimasi share + rincian swap → overlay progres multi-tx | `/i/[pubkey]` |
| 5 | Redeem | Pilih share → terima aset atau USDC | `/i/[pubkey]` |
| 6 | Clone | Wizard terisi komposisi induk | `/create?clone=` |
| 7 | Follow | Centang "Follow parent" saat create/clone | `/create` |
| 8 | Manage | Update bobot/strategi/fee via timelock, manager, pause, rebalance manual, klaim fee | `/i/[pubkey]/manage` |
| 9 | Rebalance | Keeper otomatis atau manager/agent | — |
| 10 | Social | Feed, diskusi, profil, XP, badge, leaderboard | `/feed`, `/u/[wallet]`, `/leaderboard` |
| 11 | IPO | Migrasi pre-IPO → saham listing untuk semua holder | timeline di `/i/[pubkey]` |
| 12 | Agent | MCP: riset, `/sign`, atau agent wallet; registrasi agent | `/agents`, `/sign?id=` |

Index demo (seed) yang bisa dipakai di visual: **MAG4** Magnificent Four (megacap + SpaceX pre-IPO), **AIFR** AI Frontier (periodik mingguan, dua lab privat), **MEGA** Steady Megacaps (equal-weight), **MAGT** Mag Four Tilt (clone MAG4), **MAGM** Mag Four Mirror (follow MAG4), **ATLS** Atlas Momentum (dikelola AI agent), **DFSP** Defense & Space (manual, pre-IPO pertahanan & antariksa).

## Lampiran B — Sumber fakta

| Klaim di landing | Sumber |
|---|---|
| 850K+ holder, $3.3B volume 30 hari, >63% di luar jam bursa, 37.6K holder Anthropic pre-IPO | Solana Compass, 20 Sep 2026 (README; A17 §3) |
| 61% investor 18–34 bertindak atas rekomendasi finfluencer | FINRA Foundation, 2026 (README) |
| Tenggat konversi SpaceX PreStocks → SPCXx 12 Mar 2027 23:59 UTC | Pengumuman PreStocks di X (A17 §2, D037) |
| Maks 10 aset, fee 0–5% / 0–1% / 0–1%, platform 1%, royalty clone 10% | PLAN §5.1–5.2 |
| Timelock devnet 120 detik | D007 |
| 38 test program, 59 SDK, 93 e2e, 19 skenario kegagalan | README "Quality", STATUS |
| 20 tool MCP | `apps/mcp/src/tools/*` (README masih 18) |
| MCP publik + token agent | D043 |
| Agent menjelaskan keputusan di feed | D044 |
| Program ID devnet | README |
| Palet, font, radius | D034, `apps/web/app/globals.css` |
| Kartu index 3 variasi | D035 |
| Overlay progres transaksi | D042 |
| Logo token resmi | D041 |
