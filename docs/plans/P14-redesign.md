# P14 — Redesign "Editorial Minimalist" (D053)

## Latar
User memberi referensi baru `refs/Stockbreak — Editorial Minimalist.html`: 11 layar (Landing, Markets, Explore, Index detail, Leaderboard, Create index, Feed, AI agents, Portfolio, User profile, Faucet), masing-masing dalam versi Light dan Dark. Gaya ini menggantikan tema hijau tua D034.

Catatan user:
- setiap tampilan punya mode dark/light;
- komponen disusun rapi ala shadcn;
- di Settings ada pilihan **App UI**: *navbar* (menu di atas) atau *dashboard* (sidebar);
- saat pertama membuka app muncul alert kecil di pojok untuk memilih layout, dengan tombol silang, dan default *dashboard*.

Keputusan user (2 Okt):
- kerjakan di `main`;
- tema default mengikuti sistem;
- landing ikut didesain ulang.

## Token (diambil dari HTML referensi)
| Token | Light | Dark |
|---|---|---|
| Frame (body, sidebar) | `#f4f3ef` | `#0f0f11` |
| Panel utama (dashboard inset) | `#f4f3ef` | `#141416` |
| Kartu / surface | `#fbfbf9` | `#19191b` |
| Isian halus (raised, input) | `#f7f6f2` | `#151517` / `#17171a` |
| Garis | `#e3e1da`, hairline `#ecebe5` | `#2a2a2e`, hairline `#232326` |
| Teks | `#1f1f1d`, sekunder `#4d4c48`, redup `#7a7974` | `#ececee`, sekunder `#b6b6bc`, redup `#85858c` |
| Aksi utama | gradasi `#4a4a46→#2b2b28`, teks putih | gradasi `#ffffff→#e3e3e6`, teks `#121214` |
| Tombol sekunder | gradasi `#ffffff→#f1f0ec`, garis `#d2d0c7` | gradasi `#37373d→#27272b`, garis `#3f3f45` |
| Naik / turun | `#2f8a43` (latar `#eaf5ec`) / `#b9442d` (latar `#fbecea`) | `#45d79a` / `#ff7388` |
| Alokasi | `#5bb26a`, `#3b6fd6`, `#e39a3c`, `#8cc63f` | `#3ecf8e`, `#5b8cff`, `#e8a64a`, `#b48cff` |

Font:
- Instrument Sans (UI);
- JetBrains Mono (angka, ticker, alamat);
- Instrument Serif (aksen judul landing).

Radius: 6 px (tag), 9–10 px (kontrol), 12–14 px (kartu).

## Desain teknis
- **Tema:** `next-themes` (`attribute="class"`, `defaultTheme="system"`, key `stocklana:theme`; nilai lama `light` tetap terbaca). Variant Tailwind `dark` = `.dark`.
- **Layout:**
  - Disimpan di cookie `sb-layout` (`dashboard` | `navbar`) supaya server langsung merender layout yang benar tanpa kedip. Salinannya ada di `localStorage` `stocklana:layout`, dan `stocklana:layout-asked` menandai alert pertama sudah dijawab.
  - Default `dashboard`.
- **Shell:**
  - `components/shell/app-shell.tsx` memilih salah satu:
    - **Navbar:** top bar + tab bar di HP;
    - **Dashboard:** shadcn `Sidebar` varian `inset`. Isinya logo, Search (⌘K), menu (Dashboard, Explore, Feed, Leaderboard, AI agents, Create index, Portfolio, Settings), *My watchlist* (posisi wallet, atau index teratas bila belum connect), dan kartu "Get devnet USDC" yang bisa ditutup. Header berisi breadcrumb, badge cluster, tema, dan wallet. Di HP sidebar menjadi sheet.
  - Footer disclaimer tetap ada di kedua layout.
- **Settings:** halaman `/settings` baru dengan kartu pilihan App UI (Dashboard/Navbar) dan Theme (System/Light/Dark).
- **Alert pertama:** kartu kecil di pojok kanan bawah, "Choose your layout" (Dashboard default / Navbar), dengan tombol silang. Menutupnya berarti tetap Dashboard.
- **Tombol:** varian `default` dan `outline` memakai gaya taktil referensi lewat utilitas CSS. Komponen tetap shadcn.

## Langkah
1. Font + token `globals.css` (light/dark) + utilitas tombol taktil.
2. `next-themes` provider + theme toggle (System/Light/Dark).
3. Preferensi layout (cookie + localStorage) + `AppShell` (navbar & dashboard) + `/settings` + alert pertama.
4. Penyesuaian per layar mengikuti referensi (Markets/home, Explore, Index detail, Leaderboard, Create, Feed, AI, Portfolio, Profile, Faucet).
5. Landing.
6. Gate.

## Gate
- `bun run lint`, `bun run typecheck`, `bun run verify` hijau (e2e menyesuaikan selector baru bila perlu).
- Cek visual light/dark × 375/1280 × navbar/dashboard di layar utama.
- Commit setelah gate hijau (atas permintaan user, 2 Okt).
