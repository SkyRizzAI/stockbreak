# A16 — Matriks skenario QA

Tujuan: menguji semua alur dengan banyak variasi (jalur normal, nilai batas, input salah, urutan tak biasa, multi-user, gagal di tengah) untuk menemukan cacat alur dan bagian yang belum mulus. Otomatisasi: `e2e/tests/scenarios/*.spec.ts` (Playwright + API) di localnet bersih. Hasil & perbaikan di bagian "Temuan".

Legenda status: ✅ lolos · 🐞 cacat ditemukan (lihat Temuan) · 🔧 diperbaiki · ⏭ tidak diotomatisasi (alasan).

## Onboarding & wallet (ONB)
| ID | Skenario | Harapan |
|---|---|---|
| ONB1 | Dev wallet baru → connect | Didanai SOL + 10k USDC, alamat tampil |
| ONB2 | Reload setelah connect | Wallet tetap terhubung, tidak didanai ulang |
| ONB3 | Disconnect | Tombol Connect kembali; aksi meminta connect |
| ONB4 | Faucet USDC 3 nominal; faucet SOL saat saldo ≥ 1 SOL | USDC bertambah; SOL ditolak dengan pesan jelas |
| ONB5 | Toggle tema light → reload | Pilihan bertahan |

## Create (CRE)
| ID | Skenario | Harapan |
|---|---|---|
| CRE1 | Index 1 aset 100% + setoran | Berhasil |
| CRE2 | Index 10 aset (jalur ALT) + setoran | Berhasil, beberapa tanda tangan dengan progres |
| CRE3 | Memilih aset ke-11 | Ditolak di UI |
| CRE4 | Nama > 32, simbol huruf kecil/simbol/> 10 | Tidak bisa lanjut, pesan jelas |
| CRE5 | Setoran > saldo | Tombol nonaktif + pesan |
| CRE6 | Tanpa setoran | Index dibuat dengan NAV 0, bisa di-join kemudian |
| CRE7 | Setoran sangat kecil ($0.5) | Ditolak sebelum tanda tangan atau pesan jelas |
| CRE8 | Fee maksimum (5%/1%/1%), index hanya pre-IPO | Berhasil |
| CRE9 | Manager alamat tidak valid | Tidak bisa lanjut |
| CRE10 | Klik Create dua kali cepat | Hanya satu index |

## Join (JOIN)
| ID | Skenario | Harapan |
|---|---|---|
| JOIN1 | $1, $100, desimal panjang "1.1234567" | Berhasil / dibulatkan jelas |
| JOIN2 | Jumlah > saldo | Nonaktif "Not enough USDC" |
| JOIN3 | 0 / kosong / teks | Nonaktif |
| JOIN4 | Index paused | Nonaktif "Index is paused" |
| JOIN5 | Index 10 aset | Berhasil, progres k/n |
| JOIN6 | Tanpa SOL | "Get SOL for fees" |
| JOIN7 | Join dua kali | Posisi & cost basis terakumulasi |

## Redeem (RED)
| ID | Skenario | Harapan |
|---|---|---|
| RED1 | Redeem 50% | Posisi sisa 50%, cost basis proporsional |
| RED2 | Redeem ke aset (Receive USDC off) | Aset diterima, tidak ada swap |
| RED3 | Redeem saat paused | Diizinkan |
| RED4 | Redeem > share | Nonaktif |
| RED5 | Redeem dengan exit fee | Estimasi mencakup fee |
| RED6 | Redeem debu (0.000001) | Ditolak jelas atau berhasil tanpa error mentah |

## Kelola (MAN)
| ID | Skenario | Harapan |
|---|---|---|
| MAN1 | Propose saat masih ada pending | Pesan jelas / menggantikan |
| MAN2 | Cancel pending | Pending hilang |
| MAN3 | Manager ke-4 | Ditolak di UI |
| MAN4 | Hapus aset yang masih bersaldo | Diblokir dengan penjelasan |
| MAN5 | Non-kreator membuka Manage | Pesan akses |
| MAN6 | Pause → join diblokir, redeem jalan → unpause | Sesuai |
| MAN7 | Edit deskripsi/thesis | Tersimpan, tampil |
| MAN8 | Klaim fee saat 0 owed | Tidak error mentah |

## Clone & follow (CLN)
| ID | Skenario | Harapan |
|---|---|---|
| CLN1 | Clone tanpa perubahan | Nama "… Remix", induk tercatat |
| CLN2 | Clone dari clone | Berhasil, royalti ke induk langsung |
| CLN3 | Follower: induk ubah bobot → tersinkron | Ya |
| CLN4 | Follower: kreator mencoba ubah bobot sendiri | Diblokir/penjelasan |

## Keeper & IPO (KEEP/IPO)
| ID | Skenario | Harapan |
|---|---|---|
| KEEP1 | Shock harga: Threshold+keeper → rebalance; Manual → tidak; allow_keeper off → tidak; paused → tidak | Sesuai mandate |
| IPO1 | Setelah IPO: join, clone, create dengan aset hasil IPO | Berhasil; aset pre-IPO lama tidak bisa dipilih |

## Sosial (SOC)
| ID | Skenario | Harapan |
|---|---|---|
| SOC1 | Ganti wallet setelah sign-in lalu post | Post atas nama wallet yang terhubung (bukan sesi lama) |
| SOC2 | Komentar pada post yang dihapus | Ditolak |
| SOC3 | Pagination feed (banyak item, timestamp sama) | Tanpa duplikat/hilang |
| SOC4 | Edit profil: handle sudah dipakai/format salah | Pesan jelas |
| SOC5 | Follow/unfollow kreator | Konsisten di profil & Following |

## MCP / Blink / navigasi (EXT)
| ID | Skenario | Harapan |
|---|---|---|
| EXT1 | Blink amount 0 / negatif / teks | 400 dengan pesan |
| EXT2 | Blink dari akun tanpa USDC | Pesan jelas |
| EXT3 | Intent kedaluwarsa / sudah dieksekusi / wallet salah | Pesan jelas, tidak bisa dieksekusi ulang |
| EXT4 | Deep link index baru tepat setelah create | Tidak 404 (atau state menunggu) |
| EXT5 | Search palette: index, aset, kreator | Hasil & navigasi benar |

## Metode
1. **Audit alur** oleh 3 agen baca-saja (create/manage/clone; join/redeem/tx/wallet; sosial/MCP/Blink/data), total 70 temuan dengan repro dan file:line.
2. **Probe API** 58 kasus tepi (input salah, pemalsuan, urutan) ke stack localnet: 11 jawaban salah, misalnya 500 mentah, 200 untuk input tidak sah, atau transaksi dibangun untuk dompet tanpa saldo.
3. **Perbaikan** dibagi per kepemilikan file (SDK+trade, wizard+manage, worker, server/sosial/MCP).
4. **Tes skenario permanen**:
   - `e2e/tests/scenarios-api.spec.ts`: 8 tes, puluhan variasi.
   - `e2e/tests/scenarios-ui.spec.ts`: 7 tes UI end-to-end.
   - `apps/worker/test/positions.test.ts`.
   - `packages/sdk/test/errors.test.ts` (+3).

## Temuan & perbaikan (ringkas)
Keparahan: T = tinggi, S = sedang, R = rendah. Semua 🔧 kecuali yang ditandai.

### Transaksi multi-langkah (paling berbahaya bagi user)
| # | Temuan | Kep. | Perbaikan |
|---|---|---|---|
| J1/J2 | Join gagal setelah swap (atau redeem gagal saat swap balik): aset tertinggal di wallet, retry menukar USDC lagi | T | `PartialZapError` + toast persisten; pemulihan "Finish join" (`joinWithHeld`) & "Swap to USDC" (`swapToUsdc`); kartu "Loose assets" di Portfolio |
| J3 | Swap tetap jalan walau index paused / rebalance aktif | T | `assertJoinable`/`assertRedeemable` sebelum transaksi pertama |
| J4/C2 | Setoran pertama $1 selalu gagal on-chain (buffer+spread < $1) | T | Minimum $1,10 di wizard, panel, SDK, Blink, intent |
| J5 | Aset <1bp NAV → ZeroShares setelah swap | T | Pembagian presisi 1e9 + tiap aset bersaldo dapat leg |
| J6 | Error mock_market dilaporkan sebagai error vault ("index is paused") | T | Log transaksi gagal diambil (`TxFailedError`), tidak menebak program |
| C1 | Create sukses tapi deposit gagal → klik ulang membuat index kedua | T | Index yang sudah dibuat diingat; panel "Index created. The deposit did not complete." + Retry deposit |
| C3/S6 | ALT index besar tidak tersimpan (wizard, /sign, MCP) → join/redeem terlalu besar | T | `POST /api/indexes/{pk}/lookup-table` (validasi on-chain) + `ensureIndexRow` (sinkron dari chain bila worker tertinggal) |
| S2/S3/S4 | /sign mengulang dari langkah 0 (swap ganda), kedaluwarsa di tengah alur, dua tab bersamaan | T | Kursor langkah di server, laporan per transaksi, kunci 60 s, masa tenggang 1 jam setelah mulai |
| S1 | Status intent bisa dipalsukan (tanpa auth) → agent mengira "executed" | T | Hanya signature yang terkonfirmasi, sukses, dan ditandatangani wallet intent yang dihitung |
| S5 | State Blink berantai bisa diubah (deposit melebihi tampilan) | T | State ditandatangani HMAC, terikat akun+index+jumlah; leg USDC dibatasi jumlah |
| J7–J13 | Cache tidak di-refresh saat gagal, debu Max redeem, redeem 0, ATA redeem berulang, retry harga basi memakai min-out lama, batas SOL terlalu rendah, disconnect di tengah alur | S | Diperbaiki (lihat laporan agen di STATUS) |

### Create / Manage / Clone
| # | Temuan | Kep. | Perbaikan |
|---|---|---|---|
| C4 | Follow parent: bobot bisa diedit lalu ditimpa keeper | T | Langkah aset/bobot read-only saat follow; Manage menjelaskan |
| C5 | Input fee/slippage/drift Manage tanpa batas → gagal setelah tanda tangan | T | Validasi sesuai `constants.rs`, Propose nonaktif |
| C6 | Proposal baru diam-diam mengganti pending & mengulang timelock | S | Konfirmasi "Replace scheduled update" |
| C7/C9 | Apply gagal (aset bersaldo hilang dari pending / migrasi IPO) | S | Apply nonaktif + penjelasan cancel & re-propose |
| C10 | Clone dari alamat tidak valid diam-diam jadi create biasa | S | State error + "Create from scratch" |
| C12 | Batas nama dihitung karakter, program menghitung byte | S | Validasi byte UTF-8 |
| C13 | Perubahan terjadwal tidak terlihat investor | S | Banner "Scheduled change" di halaman index |
| C15 | URI metadata berdasar simbol (tidak unik) | S | URI berdasar alamat index (web, /sign, MCP) |
| C8 | Follower dengan parent 10 aset tidak bisa sinkron | S | ⏭ Butuh perubahan program; worker kini backoff + log jelas |
| C16–C22 | Loncat langkah, progres salah, validasi manager, prefill clone, copy, aset 0%, jam timelock | R | Diperbaiki |

### Data / worker / sosial / API
| # | Temuan | Kep. | Perbaikan |
|---|---|---|---|
| S7/S8 | Indexer melewati tx yang gagal diambil; replay menggandakan cost basis | S | Kursor per tx dalam satu transaksi DB; delta hanya untuk event baru |
| J16/J17 | Cost basis bisa jatuh ke 0; transfer share tak terlacak | S | Posisi dari data event + rekonsiliasi saldo on-chain (sebagian) |
| S10 | INSERT XP raksasa bisa gagal tiap tick | S | Chunk 1000 baris, badge independen |
| S16 | Return 7d/30d index muda memakai snapshot pertama | S | "—" bila riwayat kurang |
| S9 | Pagination feed menghilangkan item ber-timestamp sama | S | Keyset cursor (post id; ts+signature+ix) |
| S13 | Lag indexer: posting/Blink/metadata untuk index baru gagal | S | `ensureIndexRow` fallback chain |
| S15 | Disconnect tidak mengakhiri sesi sosial | S | Sesi dihapus saat wallet disconnect/ganti |
| API | Body JSON rusak → 500; `limit=abc` → list kosong; Blink amount 0.001/1e12/Infinity; Blink ke wallet tanpa USDC | S | 400 jelas; param disanitasi; batas $1–$1jt; cek saldo |
| S17–S24, J14–J24 | Leaderboard error/rentang/tie, explore debounce & batas 100, thread tanpa "Load more", race like, handle dicadangkan/race, komentar post terhapus, race faucet devnet, dev wallet funding, klaim 0, durasi toast | R | Diperbaiki |

### Ditemukan saat eksekusi e2e (putaran 1)
| # | Temuan | Perbaikan |
|---|---|---|
| E1 | Feed "All" dipenuhi event otomatis (IPO, rebalance keeper). Post kreator terdorong keluar dari halaman pertama. | Event dibatasi ⅓ per halaman (kursor per sumber tetap konsisten). Deretan aktivitas panjang dilipat ("Show N more updates"). |
| E2 | Event tanpa wallet (IPO migration, update diterapkan) diberi label "Keeper", padahal kreator yang menerapkan | Ditampilkan sebagai kalimat netral tanpa pelaku |
| E3 | Blink POST ke alamat bukan index menghasilkan 500 di build produksi | Cek keberadaan index dulu, 404 |

### Ditemukan saat eksekusi e2e (putaran 2–3)
| # | Temuan | Perbaikan |
|---|---|---|
| E4 | Clone dari alamat tak dikenal menawarkan "Retry" yang tidak akan pernah berhasil | Retry hanya untuk error server |
| E5 | Wallet baru langsung masuk tab Following yang kosong, tanpa jalan ke konten | Tombol "See all posts" di empty state |

## Hasil eksekusi
`bun run verify` pada localnet bersih: **ALL GREEN**.
- lint, typecheck;
- 38 test program;
- SDK 59, MCP 10, worker 7;
- build;
- **89 e2e**, termasuk 8 skenario API dan 7 skenario UI baru.

Butuh empat putaran verify. Putaran 1–3 menemukan E1–E5 (di atas) dan beberapa asumsi tes (urutan IPO, role tombol), semuanya sudah diperbaiki.
