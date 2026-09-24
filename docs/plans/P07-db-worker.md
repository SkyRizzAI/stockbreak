# P07 — DB & worker

## Tujuan
Cache + histori + sosial di Postgres; worker menjalankan harga, indexing, snapshot, keeper, fee, follow, gamifikasi; script demo.

## Referensi
PLAN §7.3, §7.4, §7.7, §7.9 · A06 · A07 · D026 · D027.

## Desain singkat
- `packages/db/src/queries.ts`: semua query (web/worker/MCP).
- `apps/worker`: satu proses, loop independen (`main.ts`), `ctx.ts` (env zod, signer admin untuk harga, keeper), `sync.ts` (index & posisi), `loops/{price,indexer,chain-jobs,gamification}.ts`. Waktu keeper/fees memakai jam validator (`chainNow`) agar `warp` bekerja.
- Script: `seed` (3 wallet demo + agent, 7 index: pre-IPO, clone, follow, agent, ALT 5 aset; join; profil; follow sosial; histori sintetis 30 hari), `ipo`, `warp` (Surfpool `surfnet_timeTravel`), `gate-worker`.
- DB per cluster: `app` / `app_devnet` / `app_test` (D027).

## Gate (dijalankan 2026-09-24)
- [x] `bun run dev -- --no-web --no-mcp` + `bun run seed` → semua tabel terisi (users 4, indexes 7, snapshots, positions 12, events, prices, xp, badges, follows)
- [x] `bun scripts/gate-worker.ts`: snapshot bertambah; `price --pct +30` → keeper rebalance ≤ 2 interval; `ipo --asset SPACEX-pre` memigrasi 4 index pemegang + sync 1 follower → PASS
- [x] `bun run warp -- --days 30` memajukan jam validator
