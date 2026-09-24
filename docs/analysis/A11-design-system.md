# A11 — Design system & wireframe

## Token
- shadcn `base-nova`, base color neutral (monokrom). Aksen tunggal = `--primary` (hampir hitam / hampir putih di dark). Warna makna: `--up` (hijau), `--down` (merah), `--warn` (kuning) — didefinisikan sekali di `globals.css`, dipakai via kelas `text-up/down/warn`.
- Font: Geist Sans (UI), Geist Mono (angka, alamat, ticker) + `tabular-nums`.
- Skala teks 12/13/14/16/20/24/32/48; spasi kelipatan 4; radius 10px; border 1px; tanpa shadow berat.
- Lebar konten 1200px (data), 640px (form).

## Komponen (shadcn + komposisi lokal)
Button, Card (jarang, tanpa nesting), Table, Tabs, Badge (hanya makna: Simulated, AI, Pre-IPO, Follows), Skeleton, Input, Slider, Switch, Select, Drawer (aksi mobile), Sheet, Dialog, Command (⌘K), Tooltip, Sonner (toast tx + link explorer), Chart (Recharts), Progress/Stepper (multi-tx), Empty.
Lokal: `Num` (angka tabular + satuan redup), `Delta` (naik/turun berwarna), `AllocationBar` (bar bertumpuk), `IndexGlyph` (glyph deterministik dari pubkey + bobot), `TickerMono` (monogram ticker), `Addr` (alamat terpotong + salin), `TxStepper`.

## Wireframe teks
- `/`: strip ticker aset · "Top indexes" (tabel: glyph, nama, harga share, 7d, AUM, sparkline) · "Trending clones" · "Human vs AI" (dua angka median return 7d) · satu CTA "Create index".
- `/explore`: filter (All/Human/AI, Pre-IPO, strategi), sort (return, AUM, holders, newest), cari; tabel (desktop) / list (mobile).
- `/i/[pubkey]`: header (glyph, nama, simbol, kreator, badge) · harga share besar + delta · chart 1D/1W/1M/ALL + toggle vs SPYx · panel kanan sticky Join/Redeem (Drawer di mobile) · Allocation (bar + tabel bobot vs target + drift) · Strategy & guards (daftar kunci–nilai) · Fees · Managers · Holders · Activity · Timeline · aksi Clone, Share (salin link, Blink, kartu).
- `/create`: wizard 5 langkah + preview kartu live (desktop kanan).
- `/i/[pubkey]/manage`: pending update + countdown timelock, managers, pause, fee (claim), riwayat.
- `/portfolio`, `/leaderboard`, `/u/[wallet]`, `/faucet`, `/sign?id=`, `/agents` sesuai PLAN §8.5.

## Pemetaan error → UI
`packages/sdk/src/errors.ts::humanizeError` (dipakai toast & MCP).
