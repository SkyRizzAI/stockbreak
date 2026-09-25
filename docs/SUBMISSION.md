# Paket submission hackathon

Dokumen kerja untuk mengisi form di https://hackathons.solana.com/hackathons/stocklana. Batas: **Jumat 25 Sep 2026 16:00 ET = Sabtu 26 Sep 03:00 WIB** (tidak ada submission terlambat; bisa diedit sampai tutup). Dasar riset: `docs/analysis/A17-riset-hackathon.md`.

## Checklist
- [ ] Submit versi pertama **secepatnya** (GitHub + teks di bawah), lalu edit.
- [ ] Sponsor track: **PreStocks** saja. Jangan Tessera, karena memakai token pre-IPO non-PreStocks membuat kita gugur.
- [ ] Repo GitHub publik; README sudah versi juri. Pastikan `.env`, `.env.test`, dan `.keys/` tidak ter-push (sudah di-gitignore; cek dengan `git status` sebelum push).
- [ ] Live demo devnet publik (lihat `docs/DEPLOY.md`), lalu isi URL di README dan form.
- [ ] Rekam video pitch (≤3 menit) dan video teknis (≤5 menit), unggah (YouTube unlisted/Loom), isi link di README dan form.
- [ ] Minta 2–3 orang mencoba demo; kutip feedback singkat di form (juri menghargai bukti user).
- [ ] Sebelum rekam: `bun run verify:devnet` PASS, harga worker berjalan, seed devnet ada.

## Teks form (English)

**Project name:** Stockbreak — the index launchpad for tokenized stocks

**One-liner:** Turn a stock thesis into an index token on Solana: others join in one click or one Blink, the vault program enforces rebalancing, PreStocks pre-IPO sleeves migrate automatically at IPO, creators earn fees and clone royalties, and AI agents manage indexes over MCP without being able to touch the money.

**Description:**
Tokenized stocks on Solana have 850K+ holders, but each token is a single ticker. Stockbreak lets anyone package a thesis as a real index token (in-kind mint/redeem with a USDC zap) that others can Join, Clone (the original creator earns a royalty) or Follow (targets sync automatically).

Rebalancing is an on-chain mandate, not a promise:
- drift or periodic triggers, a slippage cap, a cooldown and a timelock on changes;
- a permissionless keeper runs a flash rebalance in one atomic transaction, and `end_rebalance` reverts unless every weight moved closer to target;
- redeem can never be blocked by the creator.

A PreStocks pre-IPO sleeve converts into the listed stock inside the vault when the company IPOs, the way the SpaceX PreStocks → SPCXx conversion works, so no holder misses the deadline.

AI agents connect over MCP (18 tools). They either prepare requests the user signs (resumable, verified on-chain) or act as managers that can rebalance within the mandate but never withdraw. They compete with humans on a Human vs AI leaderboard.

Everything is shareable: a feed with index cards, OG images and Solana Blinks.

Built with Anchor 1.2 (38 LiteSVM tests), @solana/kit + Codama, Next.js, and 93 Playwright end-to-end tests. Runs on devnet with simulated assets that mirror the real token mechanics; prices are read from real sources (PreStocks API, Jupiter).

**Why Solana:**
- $0.001 fees and atomic multi-instruction transactions make 10-asset baskets and flash rebalances practical.
- Solana has the most tokenized-stock issuers and the only pre-IPO issuers.
- Token-2022 handles corporate actions.
- Blinks let an index be joined from X.

**PreStocks track:**
- Pre-IPO sleeves use PreStocks assets only (SpaceX, OpenAI, Anthropic, Anduril).
- Prices, mark price, implied valuation and premium come from the PreStocks API (read-only).
- Our IPO migration reproduces the real SpaceX conversion at index level, automatically, for every holder.

## Naskah video pitch (≤3 menit, English)
Rekam di devnet dengan Phantom, atau di localnet dengan dev wallet kalau devnet lambat (localnet lebih mulus untuk harga, IPO, dan warp). Siapkan dua jendela browser: kreator dan investor.

| Waktu | Layar | Narasi |
|---|---|---|
| 0:00–0:15 | Home (Markets) | "850,000 people hold tokenized stocks on Solana. But every token is one ticker. If you believe in AI infrastructure plus Anthropic and SpaceX, you're managing ten positions by hand." |
| 0:15–0:40 | Create wizard: pick NVDAx, MSFTx, ANTHRP-pre (PreStocks tag), weights, Drift 5%, fees, Create | "Stockbreak turns that thesis into one index token. Pick assets — including PreStocks pre-IPO names — set weights and the rules. The vault program enforces them, not us." |
| 0:40–1:00 | Index page → Share → Post to feed as a card; copy Blink link | "Share it as a card on the feed or as a Blink. Anyone on X can join in one click." |
| 1:00–1:20 | Second wallet: Join $100 (sign), position appears | "A follower joins with USDC. They get index shares. They can redeem any time. The creator can't block that." |
| 1:20–1:45 | Terminal `bun run price -- --asset NVDAx --pct +30` → activity "rebalanced … drift 12% → 0%" | "NVIDIA jumps 30%. The index drifts past its rule. A permissionless keeper rebalances in one atomic transaction, and the program checks slippage and that every weight moved toward target, or it all reverts." |
| 1:45–2:10 | `bun run ipo -- --asset SPACEX-pre` → MAG4 shows SPCXx | "When SpaceX listed, PreStocks holders had to swap into SPCXx before a deadline or lose everything. Inside a Stockbreak index, the vault migrates for every holder automatically." |
| 2:10–2:35 | Claude Desktop/Code prompt: "Create an AI-infra index with $50" → /sign link → sign → index appears; leaderboard Human vs AI | "AI agents plug in over MCP. They can build and manage indexes, but they're managers: they can rebalance within the mandate and can never withdraw. Humans and agents compete on one leaderboard." |
| 2:35–2:55 | Portfolio + creator fees / clone royalty | "Creators earn management fees and a royalty every time someone clones their index. That's a creator economy for investing, on-chain." |
| 2:55–3:00 | Logo + URL | "Stockbreak. The index launchpad for tokenized stocks." |

## Naskah video teknis (≤5 menit, English)
| Waktu | Isi |
|---|---|
| 0:00–0:30 | Arsitektur (diagram di README): 2 program Anchor, SDK kit/Codama, worker, web, MCP; on-chain adalah sumber kebenaran, Postgres hanya cache |
| 0:30–1:30 | `index_vault`: vault PDA + share mint; join/redeem in-kind tanpa oracle setelah setoran pertama; pembukuan `AssetEntry.balance` internal (donasi token tidak berpengaruh); fee sebagai owed shares; checked `u128`, pembulatan menguntungkan vault |
| 1:30–2:30 | Flash rebalance: `begin_rebalance` → swap → transfer → `end_rebalance`; tunjukkan tx di explorer; ticket mengunci semua instruksi lain; validasi program CPI dan `remaining_accounts`; pemicu mandate dicek on-chain |
| 2:30–3:15 | Migrasi IPO (`migrate_ipo_asset`, CPI ke market, verifikasi PDA konversi); integrasi harga PreStocks (API → worker → oracle) |
| 3:15–4:00 | MCP: 18 tool, dua mode; intent `/sign` dengan progres di server dan verifikasi signature on-chain; agent sebagai manager |
| 4:00–4:40 | Kualitas: `bun run verify` (38 test program, SDK 59 dengan paritas math, MCP 10, worker 7, 93 e2e termasuk skenario kegagalan A16 + A18) |
| 4:40–5:00 | Jalur ke mainnet: ganti daftar mint, routing Jupiter, transfer fee Token-2022 PreStocks |

## Klip demo otomatis
`bun run demo:record` menyalakan localnet bersih, lalu memainkan alur pitch dengan browser otomatis dan menyimpan satu klip 1280×720 per adegan di `e2e/demo/` (di-gitignore). Durasi total sekitar 3 menit, belum termasuk menunggu stack.

| Klip | Isi | Baris naskah |
|---|---|---|
| `01-markets.webm` | Markets → MAG4, panel PreStocks | 0:00–0:15 |
| `02-create.webm` | Buat "AI Infra + Anthropic" (NVDAx, MSFTx, ANTHRP-pre), setor $2.000 | 0:15–0:40 |
| `03-share.webm` | Share → kartu (ganti gaya) → posting ke feed | 0:40–1:00 |
| `04-join.webm` | Wallet lain join $100 | 1:00–1:20 |
| `05-keeper.webm` | NVDA +30% → keeper rebalance (aktivitas "Rebalanced") | 1:20–1:45 |
| `06-ipo.webm` | IPO: ANTHRP-pre → ANTHRPx di dalam index | 1:45–2:10 |
| `07-agent.webm` | Agent MCP menyiapkan index → user tanda tangan di `/sign` → leaderboard | 2:10–2:35 |
| `08-portfolio.webm` | 30 hari kemudian: portfolio + fee kreator | 2:35–2:55 |

Gabungkan di editor mana saja (CapCut, iMovie), potong bagian menunggu (terutama klip 05), lalu tambahkan voice-over dari kolom Narasi. Untuk bukti Phantom/devnet, sisipkan rekaman layar singkat manual (connect Phantom + join) bila sempat.

## Tips rekaman
- Resolusi 1280×720 atau 1920×1080, tema dark (default), zoom browser 110%.
- Sebelum rekam: `bun run dev` + `bun run seed`; siapkan terminal kecil di pojok untuk perintah `price`/`ipo`.
- Potong jeda menunggu konfirmasi; fokus pada hasil.
- Jangan tampilkan `.env`, `.keys/`, atau URL RPC berisi API key di layar.
