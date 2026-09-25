# A01 — Toolchain & versi

## Pertanyaan
Command init resmi, flag, dan versi terbaru semua tool di PLAN §3, serta jebakan yang harus diantisipasi sebelum P1.

## Sumber yang dibaca
- Anchor: https://www.anchor-lang.com/docs/installation · https://www.anchor-lang.com/docs/references/anchor-toml · CHANGELOG https://github.com/solana-foundation/anchor/blob/master/CHANGELOG.md (1.2.0, 2026-09-04) · `anchor * --help` lokal.
- Agave: https://github.com/anza-xyz/agave/releases · channel `https://release.anza.xyz/stable`.
- Surfpool: `surfpool start --help` 1.6.0 · https://github.com/solana-foundation/surfpool.
- LiteSVM: https://crates.io/crates/litesvm (0.16.0).
- Kit/Codama/wallet: https://github.com/anza-xyz/kit · https://github.com/codama-idl/codama · README `@solana/kit-plugin-wallet` · https://docs.phantom.com/developer-powertools/testnet-mode.
- Transaksi v1: SIMD-0385 · `solana-foundation/transaction-v1-examples` (known-wallets).
- Web/infra: https://turborepo.com/docs · https://nextjs.org/docs/app/api-reference/cli/create-next-app · https://ui.shadcn.com/docs/cli · https://biomejs.dev/guides/getting-started · https://orm.drizzle.team/docs/get-started/postgresql-new · https://playwright.dev/docs/intro · https://github.com/modelcontextprotocol/typescript-sdk · https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr.
- Deploy publik (D038, 2026-09-25): https://vercel.com/docs/package-managers · https://vercel.com/kb/guide/how-to-pin-a-specific-bun-version-for-vercel-builds · https://vercel.com/docs/monorepos · https://vercel.com/docs/functions/runtimes/node-js/node-js-versions · https://vercel.com/kb/guide/how-can-i-use-files-in-serverless-functions · https://nextjs.org/docs/app/api-reference/config/next-config-js/output · https://neon.com/docs/guides/node · https://neon.com/docs/connect/connection-pooling · https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/ · https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/
- Harga: https://developers.jup.ag/docs/price/v3 · https://docs.pyth.network/price-feeds/core/upgrade/preparing · https://finnhub.io/docs/api/quote.
- Laporan riset lengkap (sudah diuji di direktori sementara): `docs/analysis/research/R1-program.md`, `R2-client.md`, `R3-web-infra.md`, `R4-prices.md`; potongan kode teruji di `docs/analysis/research/snippets/`.

## Temuan

### Program (Solana/Anchor)
1. **Anchor 1.2.0** stabil (2.0.0-rc.1 = pre-release). Docs menyarankan anchor 1.2.0 + solana-cli 4.1.x; Agave 4.2.2 (stable) teruji.
2. `anchor init` **menolak** berjalan di dalam Cargo workspace dan nama workspace = nama folder → init di tmp:
   `anchor init index_vault --package-manager bun --no-git --no-install --test-template litesvm` lalu pindahkan isinya ke `anchor/`, kemudian di `anchor/`: `anchor new mock_market`.
3. Template litesvm **rusak apa adanya**: pin `litesvm 0.10` tidak bisa memuat program SBPFv3 (Anchor 1.2 build `--arch v3`). Perbaikan teruji: `litesvm 0.16.0`, `solana-message 4.2.4`, `solana-transaction 4.1.5`, `solana-signer 3.0.1`, `solana-keypair 3.1.2`; `rust-toolchain.toml` → `1.98.1` (1.89 gagal compile). `anchor new` tidak menambah dev-deps/tests → tambah manual.
4. Build pertama mengunduh platform-tools **v1.57** (~290 MB) ke `~/.cache/solana/v1.57`. **Jangan jalankan dua `anchor build` paralel** saat unduhan pertama (saling merusak).
5. Program ID stabil: `anchor keys sync` hanya membaca `target/deploy/<name>-keypair.json`. Pola: keypair program di `anchor/keys/*-keypair.json` (di-commit, hanya program), hook `[hooks] pre-build` menyalin ke `target/deploy/`, `anchor keys sync` (+ `--provider.cluster devnet`), deploy dengan `--program-keypair`.
6. Deploy: `anchor program deploy -p <prog> --provider.cluster <url|devnet> --provider.wallet ../.keys/admin.json --program-keypair keys/<prog>-keypair.json` (`anchor deploy` deprecated). Devnet mengunggah IDL otomatis (Program Metadata) kecuali `--no-idl`.
7. `anchor localnet` **panic bila tanpa TTY** dan meninggalkan Surfpool yatim di 8899 → `scripts/dev.ts` menjalankan `surfpool start --offline --no-deploy --no-tui` langsung lalu deploy dengan `anchor program deploy`. Tanpa `--no-deploy`, Surfpool membuat `txtx.yml`/runbook yang meng-hardcode signer `~/.config/solana/id.json` (dilarang).
8. Surfpool: time travel `surfnet_timeTravel [{"absoluteTimestamp": <ms>}]` (maju saja; +30 hari teruji); `surfnet_setAccount`, `surfnet_setTokenAccount`; Studio port 18488; Token/Token-2022/ATA tersedia offline.
9. Anchor 1.x breaking: `CpiContext::new(program_id, accounts)`; akun mutable duplikat ditolak kecuali `dup`; `AccountInfo` di struct → `UncheckedAccount`; `emit_cpi!` butuh fitur `event-cpi`; IDL spec `0.1.0`, discriminator 8 byte.
10. **Token-2022 ScaledUiAmount**: anchor-spl 1.2 tidak punya helper/constraint. Pakai `anchor_spl::token_2022::spl_token_2022` (re-export `spl-token-2022-interface` 2.1.0): `scaled_ui_amount::instruction::{initialize, update_multiplier}`, baca `ScaledUiAmountConfig` via `token_interface::get_mint_extension_data`. Urutan: create account → init ScaledUiAmount → `initialize_mint2`. Multiplier efektif dihitung sendiri (`new_multiplier` bila `now ≥ new_multiplier_effective_timestamp`). Jangan tambah crate 3.x. Teruji di LiteSVM.
11. Instructions sysvar: tambah `solana-instructions-sysvar = "3"`; `load_current_index_checked`, `load_instruction_at_checked`; top-level via `get_stack_height() == TRANSACTION_LEVEL_STACK_HEIGHT`. Teruji.
12. Biaya devnet: ~0,52 SOL per 100 KiB `.so` (+ buffer sementara sama besar saat deploy). Dua program 200–400 KiB → siapkan 4–8 SOL, ditambah dana faucet SOL tester → target **15 SOL**. faucet.solana.com melarang AI agent → user mendanai admin.

### Client TS
13. `@solana/kit` 8.3.0 plugin client: `createClient().use(signer).use(solanaRpc(...))`. Tanpa `version` → v0.
14. **Transaksi v1** aktif di devnet dan Surfpool, tetapi Phantom/Solflare/Backpack belum bisa menandatangani v1 → **v0 (+ALT) di semua transaksi** (D011). Pembaca RPC tetap memakai `maxSupportedTransactionVersion` yang mencakup v1 agar tidak error membaca tx pihak lain.
15. Codama: `bunx codama run js` dengan `codama.json` membaca IDL Anchor langsung; `kitImportStrategy: "rootOnly"`; output: fetcher/decoder akun, builder instruksi (PDA otomatis), error map, decoder event, plugin Kit. Ekstraksi event dari log (`Program data:`) ditulis sendiri (`snippets/anchor-events.ts.txt`). `anchor codama generate` memakai `npx` → tidak dipakai.
16. `@solana/kit-plugin-wallet` 0.20.0 cukup matang (SSR-safe di file `'use client'`, hooks di `/react`, butuh React ≥ 19.2.8); fallback §3 tidak diperlukan. `client.sendTransaction` = wallet sign + app kirim lewat RPC sendiri.
17. `@solana-program/token-2022` 0.19.0 mendukung ScaledUiAmount (instruksi, decode, konversi). Konversi JS memakai float → paritas pembulatan diuji (A12).
18. Dev wallet Wallet Standard lengkap (connect, signTransaction, signAndSendTransaction, signMessage; chain `solana:localnet`/`solana:devnet`) teruji tipe (`snippets/dev-wallet.ts.txt`).
19. Phantom: Wallet Standard; Testnet Mode resmi hanya Devnet/Testnet → uji manual di devnet (D005).
20. Blinks: `@solana/actions` bergantung web3.js v1 → **dilarang**; implementasi manual dengan tipe `@solana/actions-spec` 2.4.2 (header CORS, `X-Action-Version`, `X-Blockchain-Ids`, chaining `links.next`). dial.to butuh URL HTTPS publik.
21. Log Anchor dibatasi 10 KB per tx → event bisa terpotong pada tx besar; `emit_cpi!` menghindarinya (keputusan di P2/A07).

### Web & infra
22. Turborepo 2.11.3: di tmp `bunx create-turbo@latest stocklana -m bun --skip-install --no-git -e with-biome`, pindahkan; hapus `apps/docs`, `apps/web`, `packages/ui`, prettier; perbaiki `"@repo/biome-config": "^"` → `workspace:*`. Turbo strict env mode → `globalDependencies: [".env"]` + `globalPassThroughEnv`.
23. create-next-app 16.3.6: di tmp `bunx create-next-app@latest web --ts --tailwind --biome --app --no-src-dir --import-alias "@/*" --use-bun --skip-install --disable-git --no-agents-md --yes`. Turbopack default; Tailwind v4; Geist sudah dipasang. `next.config.ts`: `loadEnvConfig(path.resolve(__dirname, "../.."))` dan `agentRules: false` (cegah `next dev` menulis AGENTS.md/CLAUDE.md). Hapus `packageManager` di package nested; pindahkan `trustedDependencies` ke root.
24. shadcn 4.21.0: `bunx shadcn@latest init -d --no-monorepo -c apps/web` lalu `bunx shadcn@latest add -y -c apps/web <komponen>`. Default style `base-nova` (Base UI), base color neutral (tidak bisa diubah setelah init). Chart → recharts 3.8.0.
25. Biome 2.5.14: `bunx biome init` di root; nested config `"extends": "//"`; abaikan `**/generated/**`, `apps/web/components/ui/**`, output drizzle, `docs/**`.
26. Drizzle: **tidak ada command init** → `drizzle.config.ts` ditulis tangan (pengecualian §0.3, D015). Pakai stabil 0.45.3/0.31.11 (docs default 1.0-rc).
27. Playwright 1.63.0: `bun create playwright e2e --quiet --browser=chromium --lang=TypeScript --no-examples` → generator **tetap memakai npm** → hapus `package-lock.json`, `bun install` (D017). `bunx playwright install chromium`.
28. MCP: paket split v2 `@modelcontextprotocol/server`/`client` 2.1.0 = jalur stabil. `registerTool(name, { inputSchema: z.object(...) }, handler)` (zod v4); stdio `serveStdio`, HTTP `createMcpHandler` + `Bun.serve` dibungkus `(req) => handler.fetch(req)` + validasi Host/Origin. Inspector: `bunx @modelcontextprotocol/inspector`.
29. TypeScript 7.0.2 sudah `latest` di npm, tetapi create-next-app menulis `^5` → pin **5.9.x** di root (D016).
30. `bun init` sekarang membuat `CLAUDE.md` + `index.ts` per paket → hapus.
31. Postgres: `postgres:18.6-alpine`, `5434:5432`, healthcheck `pg_isready`, volume di `/var/lib/postgresql` (bukan `/data` sejak 18), `docker compose up -d --wait`.

### Harga
32. Pyth Hermes **wajib API key** sejak 2026-08-26 → opsional saja.
33. Jupiter Price v3 `https://api.jup.ag/price/v3?ids=` tanpa key 30 rpm, dengan key 60 rpm; satu request memuat semua mint (xStocks + PreStocks). Pakai `stockData.price` lalu `usdPrice`. Mint mainnet xStocks & PreStocks terverifikasi di `research/R4-prices.md` → masuk `packages/config/assets.ts` sebagai `mainnetMint`.
34. Finnhub quote (key tersedia) sebagai fallback saham US.

### Lingkungan lokal
35. Symlink global `active_release` Solana sempat berubah kembali ke 3.1.10 oleh proses di luar project ini. Project tidak boleh bergantung pada symlink global (D012).

## Opsi & Keputusan
| Topik | Keputusan | DECISIONS |
|---|---|---|
| Versi Solana di script | Prioritaskan `releases/4.2.2/solana-release/bin` di PATH semua script; `setup` memverifikasi | D012 |
| Validator dev | `surfpool start --offline --no-deploy --no-tui` langsung (bukan `anchor localnet`); fallback `solana-test-validator` | D013 |
| LiteSVM | 0.16.0 + deps selaras; rust-toolchain 1.98.1 | D014 |
| Drizzle config | ditulis tangan (tidak ada init resmi) | D015 |
| TypeScript | 5.9.x dipin di root | D016 |
| Playwright | generator npm → hapus lockfile, `bun install` | D017 |
| Versi tx | v0 + ALT | D011 |
| Harga | Jupiter v3 → Finnhub → random walk; Pyth opsional | D010 |

## Dampak ke implementasi
- P1 mengikuti resep command di atas persis (flag sudah diverifikasi); penyimpangan wajib dicatat.
- `scripts/setup.ts` memeriksa: `solana --version` 4.2.x (via PATH project), `anchor --version` 1.2.0, `surfpool --version` ≥ 1.6, `bun` ≥ 1.4, docker berjalan, `.keys/*` ada; menyalin key dari `.env.test` ke `.env` bila ada.
- Semua perintah Solana di script: `-C .keys/solana-cli.yml` / `-u` + `-k` eksplisit. Anchor: `--provider.wallet ../.keys/admin.json`.
- A03/A04 tidak perlu riset ulang dari nol: pola ScaledUiAmount & instructions sysvar sudah teruji (`snippets/scaled-ui-*.rs.txt`).
