# A18 — QA putaran 2 (kode baru + skenario on-chain)

Lanjutan A16, atas permintaan user "analisis lagi semuanya, buat banyak scenario". Fokusnya kode yang berubah sejak A16 (integrasi PreStocks D037, persiapan deploy D038) dan area yang belum tercakup A16: keeper/mandate, IPO, clone/follow, fee, tool MCP, tampilan mobile.

## Metode
1. Dua audit baca-saja:
   - kode baru: 21 temuan;
   - skenario negatif on-chain/MCP: 18 temuan + 22 usulan tes.
2. Review screenshot visual (375/1280, light/dark).
3. Perbaikan. Agen paralel terhenti karena error akses API, jadi semua perbaikan dikerjakan langsung.
4. Tes permanen baru `e2e/tests/scenarios-chain.spec.ts` (4 tes) + test unit client DB.

## Temuan & perbaikan
| # | Temuan | Kep. | Perbaikan |
|---|---|---|---|
| N1 | Ganti sumber harga (PreStocks token vs Jupiter mark, selisih ±20%) melompatkan oracle dalam 1 tick → NAV/return palsu & rebalance keeper karena noise | T | Harga live dibatasi maks 5%/tick (shock manual tetap instan) |
| F2 | Skrip IPO menulis deployment paling akhir; satu kegagalan → mint baru tak pernah diberi harga (OracleStale di semua index yang termigrasi) | T | Mint/feed/record IPO ditulis segera setelah registrasi; kegagalan per index dikumpulkan; exit ≠ 0 + bisa diulang |
| F1 | Race follow loop vs IPO: follower disinkronkan ke parent yang sudah termigrasi → migrasi follower gagal (DuplicateAsset) | T | Follower dimigrasi sebelum parent, state dibaca ulang per index; follow loop menahan follower yang IPO-nya sedang berjalan |
| F3 | IPO memakai harga default tetap → NAV melompat (arbitrase join-sebelum/redeem-sesudah) | S | Harga saham baru = harga pre-IPO × den/num (menyesuaikan desimal); menjalankan ulang tidak mereset harga |
| F5 | Tidak ada rebalance manual di web: index Hold, keeper-off, dan fase-out ke 0% tidak bisa diselesaikan | T | Seksi **Rebalance** di Manage (`rebalance-now`): preview jual/beli + drift, direncanakan ulang saat tanda tangan |
| F6 | Keeper meninggalkan debu pada aset bertarget 0% → aset tidak pernah bisa dihapus | S | Planner menjual seluruh saldo saat target 0% |
| F4 | Tool tulis MCP menerima aset yang sudah IPO / benchmark (SPYx) | S | `investableMint`; `build_clone` memetakan aset yang sudah IPO ke saham tercatatnya |
| F8 | `agent_propose_update`: pemotongan fee dilaporkan "applied after 1970"; update lama yang ter-pending ikut di-apply; kegagalan apply tidak dijelaskan | S | Membandingkan pending sebelum/sesudah; hanya menerapkan proposal miliknya sendiri; pesan jelas |
| F9 | Agent tidak bisa mengeluarkan aset yang masih bersaldo | S | Aset bersaldo yang tidak disebut otomatis dipertahankan di 0% |
| F10/F14 | MCP menerima setoran < $1,10 / join < $1; alamat hanya dicek regex (`../x` menembus path) | R | Batas minimum; `isAddress` |
| F11 | Leaderboard kreator ikut menghitung klaim fee platform (enum dibandingkan dengan string) | R | `feeKindName` |
| F12 | Tombol klaim "Nothing to claim" padahal fee sedang terakru | R | Aktif bila fee > 0 dan vault berisi (klaim mengakru dulu) |
| F13/F16/F17 | ALT basi setelah aset berubah; fee loop mengirim tx untuk vault kosong; satu index rusak menghentikan run keeper | R | Cek cakupan ALT; lewati vault kosong; try/catch per index |
| D1 | `PRICE_MODE` default random → PreStocks tidak pernah dipakai pada clone baru | S | Default `live` (PreStocks tanpa key) |
| D2 | Skrip devnet memakai DB berbeda (Neon vs lokal); `verify:devnet` bisa mengotori DB demo publik | S | `scripts/lib/devnet-db.ts` bersama; `verify:devnet` menolak jalan saat `DEVNET_DATABASE_URL` diset |
| D3 | `db:remote` bisa mencetak URL berpassword; restore gagal tetap dilaporkan sukses | S | Hanya kata perintah yang dikenal; cek jumlah index setelah restore |
| D4 | Host Postgres privat (192.168.*, host.docker.internal, *.local) dipaksa TLS; pooler Supabase/6543 memakai prepared statement | S | Deteksi host privat; `prepare:false` untuk pooler/6543/`DATABASE_PREPARE=false` |
| D5 | `metadataBase` di Vercel tanpa `WEB_URL` → OG image mengarah ke localhost | S | Fallback `VERCEL_PROJECT_PRODUCTION_URL` |
| D6 | Halaman faucet menjanjikan SOL walau kunci admin tidak ada | S | `/api/config.faucetSol`; halaman menampilkan faucet.solana.com + alamat |
| D7 | Validasi PreStocks terlalu ketat (baris dibuang bila mark kosong); ticker menampilkan aset yang sudah IPO; tag bisa terbungkus di 375px | R | Mark/valuasi opsional; ticker menyaring aset delisted; `whitespace-nowrap` |
| V1 | Tabel Allocation terpotong di 375px; drift "-0%" | R | Ticker glyph disembunyikan di mobile, nama dipotong; nol tanpa tanda |
| V2 | Screenshot "light" ternyata gelap (spec memakai `prefers-color-scheme`, app sengaja gelap default D034) | R | Spec visual menyetel preferensi tema tersimpan |
| C1 | **Ditemukan oleh tes MAN9 di run penuh:** `chainClock` memakai `Buffer`, yang tidak ada di browser. Di klien fungsi ini diam-diam memakai jam komputer, sehingga setelah warp cooldown/timelock yang dihitung di browser salah ("next rebalance in 30d") | T | Decode base64 dengan `atob` + `DataView` (jalan di server dan browser) |
| C2 | **Ditemukan oleh dod no. 10 di run penuh:** tepat setelah warp, join/redeem langsung gagal "Prices are updating… retry" (regresi dari pengecekan kesegaran A16), sehingga user harus mengulang manual | S | `waitForFreshPrices`: menunggu feeder hingga 45 s dengan status "Waiting for fresh prices" sebelum menyerah |
| E2E | `vercel:env` sempat menulis file dengan mode default | R | `mode: 0o600` saat menulis |

**Susulan (dikerjakan setelah putaran utama):**
- F7: `simulate_rebalance` merencanakan dengan aturan keeper (tanpa pre-IPO) untuk eksekutor keeper. `agent_rebalance` hanya untuk index yang dibuat atau dikelola agent. Swap kustom memberi pesan jelas bila sell = buy atau jumlah melebihi saldo vault.
- Panel PreStocks:
  - menampilkan "Read-only · HH:MM" atau "Stale · as of HH:MM" (lebih dari 10 menit);
  - membedakan "tidak bisa dihubungi" (dengan tombol Retry) dari "tidak lagi di-listing";
  - teks sumber harga jujur.
- `list_assets` tidak menunggu PreStocks lebih dari 1,5 s.
- `ADMIN_KEYPAIR_JSON` divalidasi saat dipakai. Nilai rusak hanya mematikan faucet SOL; load yang gagal tidak di-cache.
- Wizard memberi peringatan saat Follow dipakai bersama Hold/keeper-off (target tersinkron, saldo tidak bergerak).
- `.env.example` mendokumentasikan `DEVNET_PRICE_INTERVAL`, `ADMIN_KEYPAIR_JSON`, `DATABASE_POOL_MAX`, `DATABASE_PREPARE`.

- **Ditemukan saat `verify:devnet`:**
  - Error jaringan sesaat ke RPC devnet ("Cannot reach the Solana RPC") tidak di-retry, sehingga join putus di tengah. Transport RPC kini me-retry 502/503/504 dan koneksi terputus (maks. 3 kali). Aman karena transaksi yang sama menghasilkan signature yang sama.
  - Setelah deposit wizard gagal *setelah* swap, tombol "Retry deposit" menjalankan zap ulang (swap dua kali). Kini tombolnya menjadi **Finish deposit with swapped assets** (`joinWithHeld`).
  - Tes Blink tahan terhadap rate limit RPC publik.

- **Ditemukan saat merekam demo (`bun run demo:record`):**
  - **Setoran pertama sensitif waktu.** Program menuntut nilai setoran pertama cocok dengan bobot target (toleransi 2%) pada harga saat join, padahal swap terjadi lebih awal. Flow `/sign` dari agent (beberapa tanda tangan berurutan) gagal dengan `InitialWeightMismatch` setelah swap berjalan.
    - Kini zapIn, `joinWithHeld`, dan join server memangkas jumlah ke bobot target pada harga terbaru (`fitInitialAmounts`); sisa kecil tetap di wallet.
    - Setoran pertama dari server tidak lagi memakai `minShares` perkiraan sebelum pemangkasan.
  - **`joinWithHeld` menolak index kosong**, sehingga tombol "Finish deposit with swapped assets" di wizard pasti gagal. Kini didukung (dipangkas ke target, minimal $1).

**Tetap di luar cakupan:**
- C8 (follower dengan parent >10 aset): butuh perubahan program.
- F18: risiko yang diterima (A14 #12).

## Skenario baru (otomatis, `scenarios-chain.spec.ts`)
| ID | Skenario | Hasil |
|---|---|---|
| KEEP1 | Shock AAPLx +40%: Threshold+keeper di-rebalance; Manual & keeper-off tidak disentuh (diamati satu interval keeper tambahan) | ✅ |
| MAN9 | Index Hold → target MSFTx 0% → apply → Rebalance now → saldo MSFTx tepat 0 | ✅ |
| IPO1 | IPO: NAV sebelum/sesudah dalam ±3%; aset lama `listed:false`; index memegang saham tercatat; MCP menolak membuat index dengan token lama | ✅ |
| EXT6 | MCP: setoran $0,50, simbol ganda beda huruf, SPYx, join $0,50, alamat `../indexes`, redeem 0 share → error jelas | ✅ |
