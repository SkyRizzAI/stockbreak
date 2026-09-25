# A17 — Riset hackathon, kompetitor, dan pasar (24–25 Sep 2026)

Riset web oleh tiga agen paralel (web search + fetch sumber asli). Setiap fakta ada sumber dan tanggalnya. Hal yang tidak terverifikasi ditandai ⚠︎. Pelengkap `refs/hackathon.md`.

## 1. Aturan hackathon (resmi)
Sumber: https://hackathons.solana.com/hackathons/stocklana, https://hackathons.solana.com/how-it-works (dibaca 24 Sep 2026).

| Hal | Fakta |
|---|---|
| Tutup | **Jumat 25 Sep 2026, 16:00 ET = Sabtu 26 Sep 03:00 WIB**. Tidak ada submission terlambat. Bisa diedit sampai tutup |
| Penjurian | Sampai 2 Okt. Satu pertanyaan: "could this be a real app that people will actually use?" Yang dinilai: user & masalah nyata, **demo end-to-end yang jalan**, alasan harus di Solana, kualitas eksekusi. Juri main track memberi skor 1–10; bobot kriteria tidak dipublikasikan |
| Hadiah | Total $126k, main track $100k (pembagian per peringkat tidak dipublikasikan ⚠︎) |
| Isi submission | Minimal satu link: GitHub, live demo, atau video. Live demo boleh **devnet atau mainnet**. Pitch video **maks 3 menit**, video teknis **maks 5 menit**. Pilih **maks 3 sponsor track**. Proyek privat sampai penjurian selesai |
| Aset mock | **Tidak dilarang** oleh aturan tertulis. Klaim "wajib transaksi mainnet" yang muncul di hasil search tidak ditemukan di halaman resmi ⚠︎ |
| Statistik | 930 pendaftar, **240 submission** (24 Sep; 16 Sep masih 81) |
| Anjuran panitia | "Pick one wedge and make it excellent." Kalimat "Working code on mainnet beats slides" tertulis di brief bounty Meteora dan dikutip luas; semangatnya berlaku juga ke main track |

Setelah hackathon ada **Colosseum World's Fair** (14 Sep – 12 Okt 2026, $840k + seed funding $2,5 juta). Proyek bisa dilanjutkan ke sana. Versi mainnet akan bernilai di sana. Sumber: https://colosseum.com/worldsfair

Pola pemenang menurut Colosseum: pitch seperti startup dalam ≤3 menit, demo teknis 2–3 menit, bukti traksi/percakapan dengan calon user. Kesalahan yang perlu dihindari: visual mencolok tanpa substansi, buzzword. Sumber: https://blog.colosseum.com/perfecting-your-hackathon-submission/

## 2. Bounty sponsor
Semua dipilih di form submit yang sama (maks 3).

| Bounty | Syarat inti | Cocok? |
|---|---|---|
| **PreStocks** $10k (5k/3k/2k) | "Build your project using PreStocks". Proyek yang memakai token pre-IPO **non-PreStocks** (mis. Tessera) **gugur**. Mainnet/devnet tidak disebut. Banyak peserta memakai data read-only dari API publik | **Ya, prioritas** |
| Tessera $6k | Produk dengan T-Token OpenAI/Kalshi | Tidak (bentrok dengan PreStocks) |
| Clawpump $5k | Launch token dengan pool berpasangan saham lewat Clawpump + Meteora (efektif mainnet) | Tidak |
| Meteora $5k | Dynamic Bonding Curve untuk saham tokenized, kode mainnet diutamakan | Tidak cocok produk |
| Pyth (Pyth Pro 3 bulan, non-tunai) | Data Pyth jadi inti produk | Opsional, lihat di bawah |

**Data PreStocks yang bisa dipakai (tanpa key):**
- `https://prestocks.com/api/prestocks` → 8 token (ANDURIL, ANTHROPIC, FIGUREAI, KALSHI, NEURALINK, OPENAI, POLYMARKET, SPACEX) dengan `contract_address`, `markPrice`, `tokenPrice`, `impliedValuation`, `supply`.
- `/api/stats` untuk volume harian.
- Jupiter `lite-api.jup.ag/price/v3` juga memuat mint PreStocks.

Fakta on-chain mint PreStocks (mainnet):
- Token-2022 dengan **transfer fee 1%** (naik dari 0,5% pada 19 Sep).
- Permanent delegate, pausable, scaled UI, 9 desimal.
- **Tidak ada di devnet.**

**Konversi IPO nyata (SpaceX, 12 Jun 2026)**, sumber: https://x.com/PreStocks/status/2063623768535363940:
- Setelah IPO, $SPACEX bisa dikonversi ke saham publik tokenized (SPCXx) lewat trading on-chain biasa, tanpa KYC. Split 5:1 ikut diperhitungkan.
- Selama lockup 6 bulan diperdagangkan dengan diskon, lalu dikonversi 1:1.
- **Batas akhir 12 Mar 2027 23:59 UTC**. Setelah itu token **hangus**.
- Ini persis mekanisme "sleeve pre-IPO + migrasi IPO otomatis" kita. Ini cerita terkuat untuk bounty PreStocks.

**Pyth:**
- Sejak upgrade Core 26 Agu 2026, Hermes butuh API key: dites, `latest` mengembalikan 401. Key gratis (trial) bisa didapat lewat Pyth Terminal.
- Feed saham di devnet **basi**: AAPL/TSLA terakhir diperbarui 2 Jul, NVDAX 4 Agu. xStock feeds tidak ada di devnet.
- Integrasi Pyth yang layak berarti worker membaca harga off-chain dengan key.

## 3. Pasar saham tokenized (Sep 2026)
- **Solana:** 850 rb holder (ATH), volume $3,3 miliar dalam 30 hari (xStocks $1,6 miliar, Backpack $1,1 miliar, PreStocks $293 juta).
  - Anthropic pre-IPO adalah aset ke-5 terbanyak dipegang (37,6 rb holder).
  - >63% aktivitas terjadi di luar jam bursa AS.
  - Sumber: Solana Compass, 20 Sep.
- **Pangsa volume Solana turun** dari ±96% (Q2) ke **±35% vs Robinhood Chain 39%** (Crypto Briefing, 22 Sep). Tetap unggul dalam jumlah penerbit: xStocks (67% nilainya di Solana), Ondo, Backpack. **Satu-satunya penerbit pre-IPO** (PreStocks, Tessera) juga ada di Solana.
- **Global (rwa.xyz, 24 Sep):** nilai terdistribusi $3,13 miliar (+14,7% dalam 30 hari), 3,89 juta holder.
- **Regulasi:**
  - SEC "Innovation Exemption" (17 Sep 2026, 5 tahun): trading saham NMS tokenized lewat AMM berizin di chain publik.
  - UE: masuk MiFID II/DLT Pilot. ESMA memperingatkan bahwa retail mungkin mengira mereka memiliki saham.
  - Praktiknya semua produk hanya untuk non-AS.
- **Pelajaran IPO SpaceX:** xStocks mengumpulkan pesanan >$1 miliar tetapi tidak mendapat saham, dan beberapa bursa membatalkan penawaran (CoinDesk, 13 Jun). Artinya, "tokenisasi harga" berbeda dari "tokenisasi kepemilikan".

## 4. Produk live yang mirip
| Produk | Fakta | Beda dengan kita |
|---|---|---|
| **Glider** | Portofolio otomatis (crypto + saham Ondo + emas), copy dari Explore, fee 0,30%/0,50%, 94% user non-AS, pendanaan $4 juta dari a16z CSX. **Bitwise ATP** (Mag7X dll., 25 Agu) memakai saham tokenized Coinbase di **Base** | Portofolio disalin ke wallet masing-masing: bukan token, kreator tidak dapat apa-apa, aturan tidak on-chain, tanpa pre-IPO/sosial |
| **Reserve Index DTF** | 5 index AI berisi saham Ondo di **BNB Chain** (Jul 2026), fee mint 0,3% + 0,6%/tahun | Index-token terdekat, tapi bukan Solana, dibuat tim Reserve (belum permissionless), tanpa sosial |
| Symmetry | Vault Solana hingga 100 token, keeper lelang Belanda | Tanpa saham, fee dimatikan, aktivitas 2026 tidak jelas ⚠︎ |
| $INDEX (solindex) | Token meme reflection, volume ±$7/hari | Bukan index sungguhan |
| Aplikasi copy/sosial | eToro 3,8 juta akun berdana; Autopilot AUM $1,3 miliar; Dub >1 juta unduhan, 200+ kreator dapat royalti; Robinhood Social (beta) | Bukti permintaan "ikuti portofolio orang" |

## 5. Kompetitor peserta
Ringkasan per 24 Sep. Tidak ada galeri publik, jadi daftar ini tidak lengkap (240 submission).

| Kompetitor | Kekuatan | Kelemahan | Ancaman |
|---|---|---|---|
| **FolioX/Basalt** | Paling mirip: index token, zap, fee kreator 90/10, clone, feed, leaderboard, test banyak, live Vercel | Demo publik kini "preview tanpa wallet" (data contoh); tanpa rebalance, agent, pre-IPO, Blink | **Tertinggi** |
| **Slyz** | **Mainnet**, xStocks + 8 PreStocks asli via Jupiter, video, fitur gift link | Basket hanya grup swap (bukan token), tanpa kreator/sosial/agent | Tinggi (realisme) |
| **SynthaBasket** | Index pre-IPO dengan share token, user bisa membuat, live devnet, masih aktif | Mint mirror devnet, tanpa rebalance/fee kreator/sosial/agent; memakai Tessera | Tinggi |
| **xorr-solana** | Agent AI paling rapi: delegasi dapat dicabut, batas harian, kill switch, guard Pyth | Trading satu user, bukan index/sosial/MCP | Sedang (pembanding untuk agent) |
| **stocklana-baskets** | Kemasan juri bagus: domain sendiri, 2 video, tx devnet | Akuntansi 1:1, rebalance & NAV masih "future work"; **nama sama dengan kita** | Sedang (kebingungan nama) |
| Pantauan | Quorum (token multi-penerbit + rebalance), prestocks-pulse (**MCP** + index PRE8 data), last-call/holdfill (konversi IPO PreStocks nyata), KEEL (mandate + keeper) | — | — |

**Nama "Stocklana"** dipakai sedikitnya 7 repo lain, dan sama dengan nama hackathon-nya.

**Celah terbesar kita bukan fitur, melainkan kemasan:** belum ada URL publik, belum ada video. Hampir semua pesaing serius sudah punya keduanya.

**Kombinasi yang tidak dimiliki pesaing mana pun:**
1. index sebagai token dengan in-kind mint/redeem + zap;
2. fee kreator + royalti clone;
3. mandate rebalance on-chain (drift/periodik, slippage, timelock, keeper permissionless, instruksi lain dikunci saat rebalance);
4. sleeve pre-IPO dengan migrasi IPO otomatis;
5. agent MCP (18 tool) dengan wallet terbatas + link tanda tangan;
6. Blink + kartu OG;
7. liga Human vs AI.

## 6. Bahan pitch
**Masalah (3 kalimat):**
1. Saham tokenized di Solana sudah punya 850 rb holder dan diperdagangkan 24/7. Tapi semuanya per ticker; tidak ada cara membeli keranjang tematik (apalagi yang mencampur pre-IPO) sebagai satu token self-custody.
2. Finfluencer, yang memengaruhi 61% investor usia 18–34, tidak bisa mengubah tesis mereka menjadi produk yang bisa diinvestasikan dan menghasilkan fee tanpa mendirikan fund.
3. Token pre-IPO menuntut konversi manual dengan tenggat: SpaceX PreStocks hangus setelah 12 Mar 2027. Holder yang lupa kehilangan nilainya.

**Persona:**
- Investor tematik global non-AS (22–35, pengguna Phantom, Asia Tenggara/LatAm).
- Kreator/finfluencer yang menerbitkan index dan mendapat fee + royalti.
- Operator agent AI yang bersaing di liga Human vs AI.

**Why now:**
- 850 rb holder dan $3,3 miliar volume per 30 hari (Solana Compass, 20 Sep 2026).
- 63% aktivitas terjadi di luar jam bursa.
- Anthropic pre-IPO adalah aset ke-5 terbanyak dipegang.
- Model portfolio pihak ketiga $934 miliar (+45% YoY, Morningstar ⚠︎ snippet); dana tematik $982 miliar (+35% YoY ⚠︎ sumber primer tidak jelas).
- FINRA Foundation (Apr 2026): 61% investor 18–34 mengikuti finfluencer.
- Autopilot mencapai AUM $1,3 miliar lewat copy portofolio.
- SEC Innovation Exemption (17 Sep) dan Bitwise ATP (25 Agu).

**Why Solana:**
- Fee ±$0,001 membuat basket 10 aset praktis.
- Transaksi atomik memungkinkan flash rebalance sandwich dan zap.
- Transaction v1 (SIMD-0385, 15 Sep) menaikkan ukuran tx maksimum ke 4 KB.
- Token-2022 Scaled UI Amount menangani split/dividen.
- Semua penerbit pre-IPO ada di Solana.
- Blink memungkinkan join satu klik dari X.
- Phantom/Backpack sudah mendukung saham.
- Likuiditas dan kolateral tersedia di Jupiter, Raydium, dan Kamino.

**Keberatan juri & jawaban:**
| Keberatan | Jawaban |
|---|---|
| "Glider/Bitwise sudah ada" | Mereka menyalin ke wallet, fee per trade, saham di Base/BNB. Kita menerbitkan satu token vault yang bisa dipakai dan dibagikan (Blink), dengan ekonomi kreator, mandate on-chain, pre-IPO + migrasi, dan loop sosial |
| "Asetnya mock" | Demo di devnet; mock mengikuti mekanik xStocks/PreStocks asli (Token-2022, `transfer_checked`). Harga dibaca dari sumber mainnet nyata (Jupiter/PreStocks, read-only). Go-live = mengganti daftar mint di config + routing Jupiter/Raydium |
| "Index saham = fund, regulasi?" | Hanya non-AS seperti semua penerbit, label "Simulated", non-kustodial, fee ditegakkan program. Jalur produksi: model portfolio berlisensi (pola Bitwise ATP) atau sponsor teregulasi; SEC Innovation Exemption membuka jalur AMM berizin |
| "Likuiditas rebalance" | In-kind mint/redeem menghindari slippage untuk holder besar; rebalance atomik gagal total bila slippage melebihi mandate; mandate bisa dibatasi ke aset likuid |
| "Pre-IPO berisiko" | Sleeve memegang token berbasis SPV (bukan alokasi IPO); migrasi otomatis mencegah tenggat terlewat; bobot pre-IPO bisa dibatasi mandate |
| "Solana masih pemimpin?" | Jujur: pangsa volume turun ke ±35% sejak Robinhood Chain. Solana tetap unggul dalam jumlah penerbit, satu-satunya penerbit pre-IPO, DeFi terdalam, dan 850 rb holder |

## 7. Rekomendasi aksi (diurutkan dampak ÷ usaha, sisa ±1 hari)
1. **Submit versi pertama hari ini, lalu terus diedit.** Isi: GitHub, deskripsi, track **PreStocks**. Risiko terbesar adalah terlambat, bukan kurang fitur.
2. **Live demo publik di devnet.** Web di Vercel, Postgres gratis (Neon), worker berjalan di mesin sendiri/VPS selama penjurian. Syarat Blink dan unfurl X. Semua pesaing utama sudah punya.
3. **Video pitch ≤3 menit + video teknis ≤5 menit.**
   - Pitch: satu loop penuh: create → share Blink → wallet lain join → harga bergerak → keeper rebalance → agent MCP → migrasi IPO → leaderboard.
   - Teknis: sandwich rebalance, mandate, pembukuan internal, test.
4. **Integrasi PreStocks yang terlihat** (usaha kecil, nilai bounty tertinggi):
   - label "PreStocks" + link prestocks.com pada aset pre-IPO;
   - harga/`markPrice` dari API PreStocks (read-only, diizinkan aturan proyek);
   - premium/diskon;
   - demo IPO meniru event SpaceX (SPCXx, split, tenggat 12 Mar 2027);
   - pastikan tidak ada token Tessera di mana pun.
5. **Nama/subjudul yang khas di README & video** (mis. "Stocklana — the index launchpad for tokenized stocks") agar tidak tertukar dengan 7+ repo lain. Idealnya nama produk sendiri (sudah didukung `NEXT_PUBLIC_APP_NAME`).
6. **README untuk juri:** masalah, persona, why Solana, tabel pembeda (framing "satu-satunya dengan semua ini", tanpa menyerang pesaing), angka test (38 program, SDK 59, MCP 10, worker 7, 89 e2e), catatan jujur "devnet, aset simulasi, mengapa belum mainnet".
7. **Satu bukti user nyata:** 2–3 kutipan feedback dari orang yang mencoba demo (mentor/teman).
8. Opsional bila semua di atas selesai: sumber harga Pyth (key trial gratis) di worker; atau penanganan transfer fee 1% PreStocks di akuntansi vault.
9. Lewati: Tessera, Clawpump, Meteora.
10. Setelah 26 Sep: lanjutkan ke Colosseum World's Fair (12 Okt) dengan target mainnet.
