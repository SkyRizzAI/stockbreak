# A07 — Indexing event

## Pertanyaan
Decode event Anchor dengan Kit/Codama; subscribe log vs polling; backfill dengan `indexer_state`; idempotensi.

## Sumber yang dibaca
`research/R2-client.md` §1 (event decoder Codama + `anchor-events.ts`), Kit `getSignaturesForAddress`, `getTransaction`, `logsNotifications`.

## Temuan
- Codama menghasilkan `identifyIndexVaultEvent` + `parseXEvent` per event; baris `Program data: <base64>` diambil hanya saat index_vault adalah program yang sedang berjalan (stack invoke) → `packages/sdk/src/events.ts` (`decodeVaultEvents`), diuji di test SDK (Joined, RebalanceExecuted).
- Log per tx dibatasi 10 KB; transaksi terbesar (rebalance 6 ix) jauh di bawah batas → `emit!` cukup (D023).
- Surfpool/Agave mendukung `logsNotifications`, namun websocket bisa putus; polling signature lebih sederhana & tahan restart.

## Keputusan
- Indexer = polling `getSignaturesForAddress(INDEX_VAULT, { until: last_signature })` tiap 2 dtk (paginasi mundur sampai `until`, lalu proses urut lama → baru), `getTransaction` per signature, decode event → `events` (PK `signature, ix_index` = ordinal event dalam tx; `ON CONFLICT DO NOTHING`), update `indexer_state`. Tx gagal (`meta.err`) diabaikan.
- Setelah event menyentuh index → sinkron akun `Index` → `indexes` (upsert) dan `positions` (saldo share token pemilik).
- Tanpa websocket di v1 (lebih sederhana, deterministik untuk test).

## Dampak ke implementasi
`apps/worker/src/loops/indexer.ts`; test worker memverifikasi idempotensi (menjalankan ulang tidak menggandakan baris).
