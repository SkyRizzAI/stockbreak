# P11 — Devnet

## Tujuan
Program berjalan di devnet; `bun run dev:devnet` menyalakan worker + web + MCP lokal yang menunjuk devnet; faucet SOL/USDC devnet; data contoh; verifikasi otomatis agar user bisa menguji manual dengan Phantom (PLAN §11.4).

## Referensi
PLAN §10 P11, §11.4 · A13 · D030 · D031.

## Desain singkat
- `scripts/deploy-devnet.ts`: guard RPC devnet (genesis hash), deploy idempoten (byte on-chain dibandingkan dengan build lokal), buffer persisten `.keys/deploy-buffer-<program>.json` + 4 percobaan (RPC/TPU bergantian) sehingga upload yang gagal bisa dilanjutkan, cek saldo (`BLOCKED(eksternal)` bila kurang), bootstrap, pendanaan keeper/agent 0,5 SOL, seed ringan (MAG4, MEGA, ATLS).
- `scripts/dev.ts --cluster devnet`: DB `app_devnet`, `DEVNET_RPC_URL`, interval worker lebih hemat (harga 60 dtk, indexer 6 dtk, resync 300 dtk, snapshot 120 dtk, keeper/follow 60 dtk).
- SDK: transport RPC dengan retry + backoff untuk HTTP 429; estimasi CU/ukuran data dengan margin (eksekusi devnet bisa sedikit lebih mahal dari simulasi).
- `scripts/verify-devnet.ts`: stack devnet sementara (web produksi) → Playwright `flows` (termasuk timelock 120 dtk), `blinks` (simulasi RPC devnet), `agent` (MCP → `/sign`); klaim faucet milik wallet test dilepas dari kuota harian setelahnya.

## Hasil deploy (2026-09-24)
- `mock_market` 9WK7engPUC9pegD4wfJN4tCDPcZGxERVifRNHxsehqX8, `index_vault` 4XaBXM6jZKj3mrQcezjA74ydDEBwiq1amzDtY7ZMc6me (upgrade authority `.keys/admin.json`).
- Upload `index_vault` pertama gagal ("Max retries exceeded", rate limit RPC); buffer ditutup (SOL kembali), deploy dibuat resumable, percobaan berikutnya sukses.
- Seed pertama gagal "Computational budget exceeded" pada create index 5 aset + ALT → margin estimasi CU di SDK; seed ulang sukses.
- Saldo admin setelah deploy + seed: ±9 SOL.

## Gate (dijalankan 2026-09-24)
- [x] `bun run deploy:devnet` sukses & idempoten (run ulang: kedua program "already up to date")
- [x] `bun run verify:devnet` PASS 10/10 terhadap devnet: MCP `build_join`/`build_create_index` → `/sign` → executed; Blink GET/POST + `simulateTransaction` di RPC devnet; OG; faucet SOL+USDC; join/redeem zap; create → manage (propose, timelock 120 dtk, apply, manager, pause); clone + follow; follow sosial
- Perbaikan yang ditemukan selama gate: HTTP 429 (retry transport SDK), websocket subscription ditolak RPC (konfirmasi via polling `getSignatureStatuses`), margin estimasi CU, kesegaran oracle sebelum zap, interval worker devnet, race saldo share di test.
- Catatan: debugging memakai ±7,8 SOL admin (wallet test didanai 0,2 SOL/run × 5 run + rent). Saldo admin devnet sekarang ±1,25 SOL; wallet test kini 0,1 SOL. User dapat memakai faucet.solana.com untuk Phantom (DEMO.md).
