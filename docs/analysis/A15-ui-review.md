# A15 — Review visual UI (PLAN §8.8)

Metode: `bun run e2e:visual` (`e2e/tests/visual.spec.ts`) mengambil screenshot full-page 11 halaman + state terhubung (index, wizard 5 langkah, portfolio) di light/dark × 375/1280 dengan data seed → `e2e/visual/` (72 gambar). Tiap screenshot diperiksa terhadap §8.1–8.7 dan daftar larangan §8.2. Catatan: lingkaran "N" di kiri bawah adalah indikator dev Next.js (tidak ada di build produksi); header lengket yang tampak di tengah screenshot full-page adalah artefak capture.

## Putaran 1 (2026-09-24)

### §8.2 anti-"AI slop"
Tidak ada pelanggaran: tanpa gradien/glow/glass, tanpa emoji, tanpa hero marketing, tanpa teks/border gradien, tanpa kartu bersarang, badge hanya bermakna (Pre-IPO, AI, Follows, Clone, Paused, Simulated), semua angka berlabel dan "Simulated" tampil di header halaman data.

### Temuan & perbaikan
| # | Halaman | Temuan | Kategori | Perbaikan |
|---|---|---|---|---|
| 1 | Semua halaman dengan wallet (portfolio, index, faucet, manage, sign) | Hydration mismatch saat wallet sudah terhubung dari sesi sebelumnya (server merender "disconnected", klien "connected") → overlay error dev | fungsional | `useWallet` melaporkan "disconnected" sampai hydrate (`useHydrated` via `useSyncExternalStore`) |
| 2 | `/i/<bukan index>` | Error mentah "Failed to decode account data…" + Retry | fungsional | `fetchMaybeIndex` memeriksa owner program & menangkap decode → 404; `NotFoundState` "Index not found" + tautan Explore |
| 3 | `/sign` (id salah/kosong) | Hanya teks merah "Request not found." tanpa langkah lanjut | fungsional | `NotFoundState` dengan penjelasan + tautan ke `/agents` |
| 4 | Activity index | "Claimed 1 fees" (enum angka) | fungsional | label `creator` / `platform` / `parent royalty` |
| 5 | Home "Human vs AI", portfolio PnL, tabel posisi | Nilai yang tampil 0.00% / +$0.00 diberi warna hijau | warna bermakna §8.1 | helper `toneOf` (netral bila membulat ke nol pada presisi tampil); `Delta` memakai ambang presisi |
| 6 | Wizard 375px | Header 5 langkah terpotong ("4 Fees") | layout mobile | di mobile hanya langkah aktif berlabel (lainnya `sr-only`), `aria-current="step"` |
| 7 | Wizard 375px | Kartu preview di atas judul "Create index" | hierarki | preview dipindah setelah form di mobile (desktop tetap kolom kanan) |
| 8 | Wizard review | Placeholder "Magnificent Four"/"MAG4" tampak seperti nilai terisi | kejelasan | "e.g. Chip Leaders" / "e.g. CHIPS" |
| 9 | Index 375px | Tabel alokasi terpotong; kolom Weight/Target/Drift di luar layar | layout mobile | kolom Price & Value disembunyikan < `sm` |
| 10 | Slider wizard (strategi, fee) | Slider tanpa nama aksesibel (label hanya di group) | aksesibilitas | `aria-label` diteruskan ke thumb (input range) di `components/ui/slider.tsx` |
| 11 | `/agents` | Perintah stdio tanpa `--transport stdio`; config Desktop tanpa `type` | kebenaran konten | disamakan dengan docs Claude Code (lihat A10) |
| 12 | Index baru | Chart kosong sampai 2 snapshot | state | chart menambahkan titik live share price (refetch 30 dtk) |
| 13 | Home "Trending clones" (1280) | Header kolom 30d terpotong di tabel setengah lebar | layout | kolom sparkline disembunyikan pada tabel `compact` |

### Diterima tanpa perubahan
- Daftar Activity panjang di halaman index (≤ 50 baris): informatif, di kolom kiri, tidak mengganggu aksi utama.
- Holder "9e1L…hECh" (treasury platform) tampil sebagai alamat: memang wallet nyata penerima fee platform.

## Putaran 2 (2026-09-24)
Capture ulang 72 screenshot setelah perbaikan (`bun run e2e:visual`, stack bersih + seed). Semua temuan #1–#13 terverifikasi terselesaikan (wizard mobile, placeholder, tabel alokasi mobile, 404/sign not-found, warna netral nol, label sumbu chart). `pages.spec.ts` (10 halaman × light/dark × 375/1280 tanpa error console & overflow, + regresi hydration wallet & 404) hijau. Tidak ada temuan baru; review ditutup tanpa item "diterima" tambahan.
