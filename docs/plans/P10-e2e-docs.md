# P10 — E2E, review visual, dokumentasi

## Tujuan
Skenario PLAN §11.1 otomatis di localnet; review visual §8.8 (A15); README, DEMO, ARCHITECTURE; `bun run e2e` dan `bun run verify` nyata.

## Referensi
PLAN §8.8, §10 P10, §11 · A12 · A15 · D032.

## Desain singkat
- `e2e/tests/`:
  - `pages.spec.ts`: 10 halaman × light/dark × 375/1280, tanpa error console, tanpa overflow horizontal.
  - `flows.spec.ts`: flow dev wallet (faucet, join/redeem, create → manage, clone+follow, follow sosial).
  - `blinks.spec.ts`: actions.json, Blink GET/POST + `simulateTransaction`, OG.
  - `agent.spec.ts`: MCP `build_*` → `/sign` → `executed`.
  - `dod.spec.ts`: skenario §11.1 no. 2–11 dengan tiga dev wallet (A/B/C), MCP, dan script admin (`price`, `warp`, `ipo`, `claim:platform`).
  - `visual.spec.ts`: capture review (hanya `bun run e2e:visual`).
- `scripts/e2e.ts`: pakai stack yang sedang jalan, atau nyalakan `dev.ts --ci` (chain baru, web produksi) + seed, lalu tes MCP (`apps/mcp`) + Playwright, lalu hentikan.
- `scripts/verify.ts`: lint → typecheck → test:program → test:ts → build → e2e (`--skip-e2e` tersedia).
- `scripts/claim-platform.ts` (D032).

## Temuan & perbaikan selama gate
- Bootstrap membawa `ipos`/mint IPO dari chain lama setelah reset localnet (SPACEX-pre tidak bisa dipilih): hanya entri yang mint-nya masih ada di chain yang dipertahankan.
- Chart index baru kosong: titik live share price ditambahkan (A15 #12).
- Slider tanpa nama aksesibel (A15 #10); hydration saat wallet tersambung (A15 #1); 404 index/sign (A15 #2–3) dan lainnya di A15.

## Gate (dijalankan 2026-09-24)
- [x] `bun run verify` ALL GREEN pada localnet bersih: e2e 63 test (pages 43, flows 5, blinks 3, agent 2, DoD 10) + MCP 10
- [x] A15 putaran 1 (13 temuan diperbaiki) & putaran 2 (tanpa temuan baru)
- [x] README (≤ 5 perintah), `docs/DEMO.md` (localnet, Phantom devnet, agent), `docs/ARCHITECTURE.md`
