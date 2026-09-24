# A05 — Batas transaksi & tata letak akun

## Pertanyaan
Jumlah akun per aset per instruksi, ukuran tx dengan N aset, kebutuhan ALT & compute budget, nilai `MAX_ASSETS`, tata letak `remaining_accounts` final.

## Sumber yang dibaca
Format pesan v0 (Solana docs "Versioned Transactions", "Address Lookup Tables"), batas 1232 byte per paket; `research/R1-program.md` §5 (v1 aktif tetapi Phantom belum mendukung → D011); IDL hasil build P2.

## Temuan — perkiraan ukuran tx v0 tanpa ALT (1 penanda tangan, + ix compute budget)
| Instruksi | Akun unik | Perkiraan byte | N maks tanpa ALT |
|---|---|---|---|
| `join` (bukan pertama) | 10 + 3N | ≈ 467 + 107N | 7 |
| `join` (pertama, + oracle) | 10 + 4N | ≈ 467 + 140N | 5 |
| `redeem` | 9 + 3N | ≈ 450 + 107N | 7 |
| `create_index` | 11 + 3N | ≈ 700 + 133N | 4 |
| rebalance sandwich (4 ix) | ≈ 16 + 2N | ≈ 800 + 66N | 6 |

Dengan ALT, setiap akun di tabel memakan 1 byte → N = 10 muat di semua instruksi (< 900 byte). Compute: join/redeem ≈ 25–30k CU per aset (transfer_checked Token-2022), rebalance ≈ 250–400k CU untuk N = 10 → set limit 600k (rebalance) / 400k (join/redeem N besar).

## Keputusan
- `MAX_ASSETS = 10` dipertahankan.
- SDK membuat **Address Lookup Table per index** berisi: program-program (index_vault, mock_market, Token, Token-2022, ATA, System, Compute Budget, instructions sysvar), config, index PDA, share mint, index share ATA, market PDA, dan per aset: mint, oracle, vault ATA. Dibuat sebelum `create_index` bila create tidak muat tanpa ALT (N ≥ 5), atau tepat setelah create; alamat ALT disimpan di DB (`indexes.lookup_table`). ALT butuh 1 slot "warm-up" sebelum dipakai.
- Akun milik user (ATA user) tidak masuk ALT (berbeda per user) → per user 2N kunci penuh; join N=10 dengan ALT ≈ 10 + 64×... tetap < 1232 karena ATA user = 32 byte × N = 320 byte.
- Pembuatan ATA user (idempotent) dikirim di transaksi terpisah bila tidak muat.
- Semua tx v0; tx server (keeper/agent/script) juga v0 demi satu jalur kode.

## Tata letak akun final (kontrak)
`fixed` = akun bernama di IDL; `rem` = `remaining_accounts`.

| Instruksi | rem per aset (urutan sama dengan `Index.assets`) |
|---|---|
| `create_index` | `[mint, oracle, vault_ata(w)]` (urutan input `assets`) |
| `join` | `[mint, vault_ata(w), user_ata(w)]` × N, lalu **hanya deposit pertama** `[oracle]` × N |
| `redeem` | `[mint, vault_ata(w), user_ata(w)]` |
| `propose_update` (bila assets diubah) | `[mint, oracle]` (urutan input baru) |
| `apply_update` (bila assets diubah) | `[mint, vault_ata(w)]` per aset **hasil akhir** (setelah aset bobot 0 & saldo 0 dibuang) |
| `sync_targets_from_parent` | `[mint, vault_ata(w)]` per aset hasil: aset induk (urutan induk) lalu aset lokal bersaldo yang tidak ada di induk |
| `begin_rebalance` / `end_rebalance` | `[mint, oracle]` |
| `migrate_ipo_asset` | — (semua akun bernama) |
| `mock_market.set_prices` | `[feed(w)]` per harga (maks 24) |

Validasi di program: kunci mint = `AssetEntry.mint`, oracle = `AssetEntry.oracle`, vault ATA = ATA(Index PDA, mint, token_program aset), user ATA = token account mint itu milik signer dengan owner program = token program aset; pelanggaran → `AccountOrderMismatch`.

## Dampak ke implementasi
- SDK `tx.ts`: builder v0 + ALT opsional, compute budget, pemecahan multi-tx (zap: swap per aset dalam beberapa tx, lalu join).
- Layout di atas disalin ke `docs/ARCHITECTURE.md` di P10.
