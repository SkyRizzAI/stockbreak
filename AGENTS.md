# AGENTS.md

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
- Semua dokumen proyek (plan, analisis, spec, status, keputusan) ada di `docs/`. Di root hanya `AGENTS.md` dan `README.md`.

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
