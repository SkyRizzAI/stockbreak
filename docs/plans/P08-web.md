# P08 — Web

## Tujuan
Aplikasi Next.js lengkap untuk alur PLAN §1.2 (connect, faucet, create, share, join, redeem, clone, follow, kelola, social, IPO timeline, sign intent agent) dengan dev wallet di localnet dan Wallet Standard (Phantom) di devnet.

## Referensi
PLAN §1.2, §6, §8 · A08 · A09 · A11 · D019 · D027.

## Desain singkat
- `apps/web/lib`: `wallet.tsx` (kit-plugin-wallet + dev wallet Wallet Standard di `dev-wallet.ts`), `tx.tsx` (`useRun`: toast progres per transaksi, `humanizeError`), `api.ts` (hook TanStack Query), `theme.tsx` (tema tanpa script: `prefers-color-scheme` + kelas `.light/.dark`), `server/*` (data untuk route API, auth tanda tangan pesan, step transaksi untuk intent & Blink, CORS Actions).
- Halaman: `/`, `/explore`, `/i/[pubkey]` (+ `/manage`, `opengraph-image`), `/create` (wizard 5 langkah, clone `?clone=`), `/portfolio`, `/leaderboard`, `/u/[wallet]`, `/faucet`, `/agents`, `/sign?id=`.
- Blink: `/actions.json` + `/api/actions/join/[pubkey]` (GET metadata, POST tx swap → `links.next` tx join).
- Semua state (loading/empty/error), label "Simulated", angka tabular, satu aksi utama per layar.
- Perbaikan saat gate: aset baru di wizard mendapat bobot rata (sebelumnya 0% → Continue terkunci); item grid `min-width: 0` (overflow 375px); wizard dirender setelah mount (hydration mismatch di dalam Suspense); worker price tick melewati feed yang belum ada (target IPO sebelum event IPO); log worker memakai `humanizeError`.

## Gate (dijalankan 2026-09-24)
- [x] `bun run check-types`, `biome check apps/web`, `next build` hijau
- [x] `e2e/tests/pages.spec.ts`: 10 halaman × light/dark × 375/1280 tanpa error console, tanpa overflow horizontal (41 test)
- [x] `e2e/tests/flows.spec.ts` (dev wallet, localnet): faucet USDC/SOL; join $100 + redeem max; create 2 aset + setoran → manage: propose/apply bobot, tambah manager, pause; clone MAG4 dengan Follow parent; follow kreator (5 test)
- [x] `e2e/tests/blinks.spec.ts`: actions.json, GET metadata, POST tx lolos `simulateTransaction`, OG image PNG (3 test)
