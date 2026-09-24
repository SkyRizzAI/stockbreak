# P05 — Rebalance, IPO, Follow

## Tujuan
Flash rebalance, migrasi IPO, dan follow teruji; checklist A14 terverifikasi.

## Referensi
PLAN §5.3, §6.3, §6.5 · A04 · A14.

## Desain singkat
- `rebalance.rs::check_sandwich` (A04) + guard ticket di semua instruksi.
- Program `anchor/programs/cpi_probe` (khusus test, tidak di-deploy) untuk membuktikan `NotTopLevel`.

## Tugas / bukti (tests/advanced.rs, 9 test)
- [x] keeper rebalance saat Threshold terpicu (drift turun)
- [x] TriggerNotMet (tanpa drift & mode Manual), Unauthorized (allow_keeper false, PreIpo oleh keeper)
- [x] manager kapan saja + WrongDirection
- [x] SlippageExceeded (min_amount_in; executor menahan setengah hasil swap)
- [x] CooldownActive, SameAsset, OracleStale
- [x] MissingEndInstruction, InvalidRebalanceTx (redeem & System di antaranya), NotTopLevel (via CPI)
- [x] RebalanceInProgress (redeem, set_paused, accrue), end oleh executor lain → Unauthorized, NoTicket
- [x] IPO: NoIpoConversion (belum terdaftar), NotPreIpo, InvalidMarketProgram, migrasi rasio 3:2
- [x] Follow: sync bobot induk + aset bersaldo dipertahankan, NotFollowing, InvalidParent

## Gate
- [x] `bun run test:program` 38/38 hijau · [x] A14 kolom Bukti lengkap
