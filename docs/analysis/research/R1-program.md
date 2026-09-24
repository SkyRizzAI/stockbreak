# R1 — Program toolchain research (Anchor 1.2 / LiteSVM / Surfpool / Token-2022 ScaledUiAmount)

Tanggal riset: 2026-09-24. Semua yang ditandai **[TESTED]** sudah dijalankan langsung di mesin ini (proyek sementara di `/private/tmp/claude-501/research/`, sudah dihapus). Potongan kode yang lolos test disimpan di:
- `/private/tmp/claude-501/research/keep-second-lib.rs.txt` (program: buat mint ScaledUiAmount lewat CPI, update multiplier, baca multiplier efektif, introspeksi sysvar instructions)
- `/private/tmp/claude-501/research/keep-scaled-test.rs.txt` (test LiteSVM 0.16 + warp clock)
- `/private/tmp/claude-501/research/keep-Anchor.toml.txt`

---

## 0. Keadaan lingkungan (PENTING, berbeda dari asumsi)

| Item | Asumsi | Kenyataan |
|---|---|---|
| `solana` di PATH | Agave 4.2.2 | **3.1.10** (`~/.local/share/solana/install/active_release -> releases/3.1.10`). 4.2.2 sudah terpasang di `~/.local/share/solana/install/releases/4.2.2/solana-release/bin`, tapi belum aktif. Ada juga `~/.local/share/solana-manual/solana-release/bin` = 4.2.0 di PATH. |
| cargo-build-sbf | platform-tools v1.54 | versi 3.1.10 = platform-tools v1.52; versi 4.2.2 = cargo-build-sbf 4.1.0 / v1.54. **Anchor 1.2 memaksa `--tools-version v1.57` + `--arch v3` secara default**, jadi v1.57 diunduh (~290 MB) ke `~/.cache/solana/v1.57` saat `anchor build` pertama. |
| rustc | 1.98.1 | Rust host stable 1.98.1. Template `anchor init` menulis `rust-toolchain.toml` dengan `channel = "1.89.0"` (lihat §3 soal masalahnya). |

Aksi yang disarankan (pengguna yang menjalankan, karena ini mengubah konfigurasi global): `agave-install init 4.2.2`, atau prepend `…/releases/4.2.2/solana-release/bin` ke PATH di script proyek.

Efek samping dari riset ini: `~/.cache/solana/v1.57` sekarang ada (tetap dibutuhkan proyek). cargo-build-sbf juga mengganti link rustup `1.89.0-sbpf-solana-v1.52` dengan `1.95.0-sbpf-solana-v1.57`; cargo-build-sbf 3.1.10 akan membuat ulang linknya sendiri kalau dijalankan lagi. Toolchain rustup `1.98.1` yang sempat terpasang otomatis sudah di-uninstall.

---

## 1. Anchor CLI 1.2.0

Sumber: `anchor * --help` (lokal), CHANGELOG https://github.com/solana-foundation/anchor/blob/master/CHANGELOG.md (1.2.0 dirilis 2026-09-04; repo sekarang juga dipublikasikan sebagai `github.com/otter-sec/anchor`, dan metadata crates.io menunjuk ke sana), https://www.anchor-lang.com/docs/references/anchor-toml, https://www.anchor-lang.com/docs/installation (versi rekomendasi: anchor 1.2.0 + solana-cli 4.1.2). Crate `anchor-lang 2.0.0-rc.1` sudah ada (pre-release), jangan dipakai.

### 1.1 `anchor init` [TESTED]
```
anchor init <NAME> [--package-manager npm|yarn|pnpm|bun] [--no-git] [--no-install]
  [-t single|multiple (default multiple)] [--anchor-version v1|v2 (default v1)]
  [--test-template mocha|jest|rust|mollusk|litesvm (default litesvm)]
  [--force] [--install-agent-skills] [-j/--javascript]
  [--provider.cluster X] [--provider.wallet X]
```
Perintah yang diuji: `anchor init tinit --package-manager bun --no-git --no-install --test-template litesvm`

Hasil yang dibuat (template litesvm, **tanpa package.json/tsconfig/node_modules/tests/ dan migrations/**):
```
.gitignore  (.anchor .DS_Store target **/*.rs.bk node_modules test-ledger .yarn .surfpool)
.prettierignore
Anchor.toml
Cargo.toml              (workspace, members=["programs/*"], resolver 2, edition 2021, rust-version 1.89.0, release: overflow-checks, lto fat, codegen-units 1)
rust-toolchain.toml     (channel "1.89.0", components rustfmt clippy, profile minimal)
programs/<name>/Cargo.toml  (anchor-lang = "1.2.0"; dev-deps litesvm 0.10.0, solana-message 3.0.1, solana-transaction 3.0.2, solana-signer 3.0.0, solana-keypair 3.0.1)
programs/<name>/src/{lib.rs,constants.rs,error.rs,state.rs,instructions.rs,instructions/{initialize,increment}.rs}
programs/<name>/tests/test_initialize.rs   (LiteSVM, include_bytes!(env!("CARGO_TARGET_TMPDIR")/../deploy/<name>.so))
target/deploy/<name>-keypair.json
```
Anchor.toml yang dihasilkan:
```toml
skip_local_validator = true      # template litesvm: `anchor test` TIDAK menyalakan validator
[toolchain]
[features]
resolution = true
skip-lint = false
[programs.localnet]
tinit = "CDPH…"
[provider]
cluster = "localnet"
wallet = "~/.config/solana/id.json"
[scripts]
test = "cargo test"
[hooks]
```
Catatan:
- CHANGELOG 1.2.0 menyebut "security.json template on `anchor init` (`--no-security-metadata`)", tapi flag dan file itu **tidak ada** di binary 1.2.0. Anggap belum dirilis.
- Sejak 1.1.1, `anchor init` **menolak dijalankan di dalam Cargo workspace yang sudah ada**. Monorepo tidak boleh punya `Cargo.toml` workspace di root. Jalankan `anchor init anchor …` dari root repo (membuat `anchor/`), atau init di direktori tmp lalu pindahkan (sesuai CLAUDE.md). Nama workspace = nama folder, jadi program pertama dari template akan bernama `anchor`. Karena itu lebih baik init di tmp dengan nama `index_vault`, pindahkan isinya ke `anchor/`, lalu `anchor new mock_market`.
- Tanpa `--package-manager`, deteksi berjalan pnpm→yarn→npm. Untuk template litesvm tidak ada instalasi JS, jadi `--no-install` hanya pengaman.

### 1.2 `anchor new` [TESTED]
`anchor new mock_market [-t multiple] [--force]` (dijalankan di root workspace Anchor). Perintah ini menambah `programs/mock_market/**`, `target/deploy/mock_market-keypair.json`, dan entri `[programs.localnet]`.
**Gotcha:** program hasil `anchor new` **tidak mendapat dev-dependencies litesvm maupun folder tests/**. Tambahkan manual (lihat §3).

### 1.3 Program ID & keypair
- `anchor keys list`, `anchor keys sync [-p name] [--provider.cluster devnet]`. [TESTED] `keys sync` membaca **`target/deploy/<name>-keypair.json`**, lalu menulis ulang `declare_id!` dan `[programs.<cluster>]` (hanya untuk cluster provider saat itu). Untuk devnet jalankan lagi dengan `--provider.cluster devnet`, atau tulis `[programs.devnet]` manual.
- Tidak ada opsi konfigurasi "folder keypair". Pola yang disarankan:
  1. Simpan `anchor/keys/index_vault-keypair.json` dan `anchor/keys/mock_market-keypair.json`. Karena CLAUDE.md meng-gitignore `.keys/`, pastikan keypair *program* memang boleh di-commit (keypair program bukan secret yang berbahaya setelah deploy, tapi siapa pun yang memegangnya bisa deploy ke address tsb sebelum Anda di cluster baru). Pisahkan dari keypair payer.
  2. Hook `[hooks] pre-build = "mkdir -p target/deploy && cp keys/*-keypair.json target/deploy/"` (hooks tersedia sejak 1.0; key bisa ditulis kebab maupun snake case). Bisa juga lewat script `bun run setup`.
  3. `anchor keys sync` sekali, lalu commit `declare_id!` + Anchor.toml.
  4. Deploy: `anchor program deploy -p index_vault --program-keypair keys/index_vault-keypair.json …`.
- `anchor build` hanya **memperingatkan** (sejak 1.1.1 tidak lagi abort) kalau keypair ≠ `declare_id!`. `--ignore-keys` mematikan cek ini. `anchor clean` mempertahankan keypair, tapi `cargo clean` menghapusnya. Itu alasan keypair perlu disimpan di `keys/`.

### 1.4 Build / IDL [TESTED]
`anchor build [-p name] [--no-idl] [-i <idl dir>] [-t <ts dir>] [--tools-version v1.57] [--arch v3] [--ignore-keys] [-- <cargo-build-sbf args>]`
- Output: `target/deploy/<name>.so`, `target/idl/<name>.json`, `target/types/<name>.ts`, dan (baru di 1.2) `target/types/<name>_errors.ts`.
- IDL: format "new spec" (pasca-0.30): `metadata.spec = "0.1.0"`, `discriminator` 8-byte per instruksi/akun/event. Lokasi bisa diubah di `[workspace] idls = "…" / types = "…"` (sejak 1.1.1).
- ELF hasil build: `e_flags = 3` → **SBPFv3**. Fitur SBPFv3 (`5cC3foj77CWun58pC51ebHFUWavHWKarWyR5UUik7dnC`) **aktif di devnet** (dicek via RPC), dan Surfpool 1.6 menerimanya [TESTED].
- Waktu build pertama sekitar 4,5 menit (unduh v1.57 + compile). Program hitungan kosong berukuran 128 KB, program dengan anchor-spl 200 KB.
- `anchor codama generate <idl> -l js -p <dir>` ada, tapi **memanggil `npx --yes codama`**. Proyek melarang npm, jadi pakai `bunx codama` / skrip `@codama/nodes-from-anchor` + `@codama/renderers-js` sendiri.
- Sejak 1.0 CLI tidak lagi bergantung pada binary `solana` (deploy/airdrop/balance diimplementasi native), tapi IDL build tetap memakai toolchain Rust host dan `cargo-build-sbf` harus ada di PATH.

### 1.5 Anchor.toml `[provider]`, `[surfpool]`, `[toolchain]`
```toml
[provider]
cluster = "localnet"            # localnet|devnet|mainnet|<url>
wallet  = "keys/deployer.json"  # relatif ke folder Anchor.toml; bisa di-override --provider.wallet

[toolchain]
anchor_version = "1.2.0"
solana_version = "4.2.2"        # dipakai avm/verifiable; docs contohkan 4.1.2
package_manager = "bun"

[surfpool]                      # semua opsional
startup_wait = 30000            # ms
shutdown_wait = 2000
rpc_port = 8899
ws_port = 8900
host = "127.0.0.1"
online = false                  # false => --offline (default!)
datasource_rpc_url = "…"
airdrop_addresses = ["<pubkey>"]
runbooks = ["deployment"]
slot_time = 400
log_level = "none"
block_production_mode = "transaction"   # default anchor: "transaction" (bukan "clock")
```

### 1.6 `anchor localnet` / `anchor test` dan Surfpool [TESTED]
- Default `--validator surfpool` (sejak 1.0). Pilihan lain `--validator legacy` = solana-test-validator.
- Flag yang dikirim Anchor (dari source `cli/src/lib.rs` tag v1.2.0, cocok dengan `ps` saat dijalankan):
  `surfpool start --offline --block-production-mode transaction --log-level none --legacy-anchor-compatibility [--anchor-test-config-path …] [--airdrop …] [--rpc-url …] [--port …] [--runbook …] [--slot-time …]`, plus `--no-tui --disable-instruction-profiling --max-profiles 1 --no-studio` kalau bukan "full simnet mode". Dengan `--skip-deploy` ditambah `--no-deploy`. Tanpa itu, `--legacy-anchor-compatibility` membuat Surfpool men-deploy semua program di `target/deploy` lewat runbook in-memory. [TESTED] Kedua program ter-deploy.
- **Gotcha besar:** `anchor localnet` menunggu Enter di stdin (`stdin().lock().lines().next().unwrap()`). Kalau dijalankan non-interaktif (background/turbo/CI) ia **panic** (`cli/src/lib.rs:6900`), dan proses `surfpool` jadi **yatim** di port 8899. Untuk `bun run dev`, panggil `surfpool start` langsung (lihat §4).
- `anchor test` dengan `skip_local_validator = true` (template litesvm) hanya menjalankan `[scripts] test = "cargo test"`.

### 1.7 Deploy dengan payer eksplisit [TESTED di Surfpool]
```bash
# `anchor deploy` masih jalan tapi DEPRECATED ("Use 'anchor program deploy'")
anchor program deploy -p index_vault \
  --provider.cluster devnet \                # atau http://127.0.0.1:8899
  --provider.wallet keys/deployer.json \     # fee payer + upgrade authority default
  --program-keypair keys/index_vault-keypair.json \
  [--upgrade-authority keys/upgrade.json] [--no-idl] [--use-rpc] [--buffer <kp>] [--max-len N] [--final] \
  [-- --with-compute-unit-price 1000]
```
Output yang teruji: `Upgrade authority: …/keys/payer.json … Skipping IDL deployment on localnet … Deploy success`. Di devnet IDL **diunggah otomatis** lewat Program Metadata (sejak 1.0 bukan lagi akun IDL legacy). Pakai `--no-idl` kalau tidak mau. Cara manual: `anchor idl init/upgrade`.

### 1.8 Perubahan penting 0.3x → 1.x (untuk kode program)
- Deps Solana 3.x (`solana-pubkey 3`, `solana-account-info 3`, …). Paket TS `@coral-xyz/anchor` → `@anchor-lang/core` (dilarang di proyek ini, tidak relevan).
- **`CpiContext::new(program_id: Pubkey, accounts)`**: program *AccountInfo* dihapus dari CPI context (#2762). [TESTED] `CpiContext::new(ctx.accounts.system_program.key(), …)`.
- **Akun mutable duplikat ditolak secara default** (1.0), termasuk `init_if_needed`. Kalau memang perlu, gunakan constraint `dup`. Ini relevan untuk vault (mis. user=creator).
- `AccountInfo` di `#[derive(Accounts)]` → warning deprecated, jadi pakai `UncheckedAccount` + `/// CHECK:`.
- Diskriminator: tetap 8 byte `sha256("account:<Name>")[..8]` / `"global:<ix>"` / `"event:<Name>"`. Diskriminator kustom (`#[account(discriminator = …)]`) didukung sejak 0.31. **Diskriminator all-zero ditolak** (1.2).
- `#[event]` + `emit!` (lewat `sol_log_data`, bisa terpotong karena log truncation) vs `emit_cpi!` (feature `event-cpi` di anchor-lang, `#[event_cpi]` pada struct Accounts, menambah akun `event_authority` + `program`). 1.1.1 memperingatkan kalau instruksi event-cpi tidak terjangkau dengan diskriminator kustom. Untuk indexer yang andal (worker P7), pakai `emit_cpi!`.
- `InterfaceAccount<'info, Mint/TokenAccount>` + `Interface<'info, TokenInterface>`: fix substitusi akun (1.0). Constraint token dengan pesan error lebih baik (1.2). Validasi ekstensi mint Token-2022 di `init_if_needed` ada di Unreleased.
- `declare_program!`: modul `utils` → `parsers`, `errors`/`ProgramError` di-rename. Di 1.2 selalu derive `Clone`/`Debug`.
- Dihapus: `#[interface]`, `anchor login/publish`, `[registry]`, opsi `arch` program (1.0; dikembalikan sebagai flag `anchor build --arch` di 1.2), dan multiple `#[error_code]` per program.
- MSRV anchor-lang 1.89.

---

## 2. anchor-spl 1.2.0 & Token-2022 ScaledUiAmount [TESTED end-to-end]

Deps `anchor-spl 1.2.0` (crates.io API): `anchor-lang =1.2.0`, `spl-token-2022-interface ^2` (terresolusi **2.1.0**), `spl-token-interface ^2`, `spl-associated-token-account-interface ^2`, `spl-pod ^0.7`, `spl-token-metadata-interface ^0.8`, `spl-token-group-interface ^0.7`. Features default: `associated_token, mint, token, token_2022, token_2022_extensions`.

- `anchor_spl::token_2022_extensions` **TIDAK** punya ScaledUiAmount (modulnya: cpi_guard, default_account_state, group(_member)_pointer, immutable_owner, interest_bearing_mint, memo_transfer, metadata_pointer, mint_close_authority, non_transferable, pausable, permanent_delegate, token_group, token_metadata, transfer_fee, transfer_hook).
- Constraint `mint::extensions::*` pada `init` hanya mendukung: GroupMemberPointer, GroupPointer, MetadataPointer, MintCloseAuthority, NonTransferable, Pausable, PermanentDelegate, TransferHook. **ScaledUiAmount tidak didukung**, jadi mint dibuat manual.
- **Tidak perlu crate tambahan:** `anchor_spl::token_2022::spl_token_2022` adalah re-export dari `spl_token_2022_interface` 2.1.0, yang sudah punya `extension::scaled_ui_amount::{ScaledUiAmountConfig, instruction::{initialize, update_multiplier}}` dan `ExtensionType::ScaledUiAmount`. Jangan tambahkan `spl-token-2022-interface 3.x`: 3.x memakai `solana-address 2.6` / `MaybeNull<Address>`, tidak cocok dengan tipe `Pubkey` anchor 1.2. Jangan juga pakai `spl-token-2022` (crate program 11.0) di program.
- API (v2.1.0):
  - `initialize(token_program_id: &Pubkey, mint: &Pubkey, authority: Option<Pubkey>, multiplier: f64) -> Result<Instruction, ProgramError>`. Akun: `[writable] mint`. Harus dipanggil **sebelum** `InitializeMint`. Multiplier harus > 0 dan tidak subnormal.
  - `update_multiplier(token_program_id, mint, authority, signers: &[&Pubkey], multiplier: f64, effective_timestamp: i64)`. Akun: `[writable] mint, [signer] authority`. Kalau timestamp ≤ sekarang, langsung berlaku.
  - `ScaledUiAmountConfig { authority: OptionalNonZeroPubkey, multiplier: PodF64, new_multiplier_effective_timestamp: PodI64, new_multiplier: PodF64 }`. **`current_multiplier()` bersifat privat**, jadi replikasi sendiri: `if now >= new_multiplier_effective_timestamp { new_multiplier } else { multiplier }`.
  - Membaca: `anchor_spl::token_interface::get_mint_extension_data::<ScaledUiAmountConfig>(&mint.to_account_info())?`.
  - Ukuran akun: `ExtensionType::try_calculate_account_len::<spl_token_2022::state::Mint>(&[ExtensionType::ScaledUiAmount])?`.
- Urutan CPI yang teruji: `system_program::create_account(space, owner=token_program)` → `invoke_signed(scaled_ui_amount::instruction::initialize(..., Some(pda), 1.0))` → `token_interface::initialize_mint2(CpiContext::new(token_program.key(), InitializeMint2{mint}), decimals, &pda, None)`. Update: `invoke_signed(update_multiplier(..., &pda, &[], m, ts), &[mint, pda], &[&[SEED,&[bump]]])`.
- Test LiteSVM: buat mint (multiplier 1.0) → update ke 2.5 dengan `effective_ts = now+86400` → cek masih 1.0 → `set_sysvar(Clock{unix_timestamp: eff+1})` → cek 2.5. **Lulus.**
- `transfer_checked` lintas Token/Token-2022: `anchor_spl::token_interface::{transfer_checked, TransferChecked, Mint, TokenAccount, TokenInterface}` dengan `CpiContext::new(ctx.accounts.token_program.key(), TransferChecked{from, mint, to, authority})`. Program ID diambil dari `Interface<TokenInterface>` yang sesuai `mint.to_account_info().owner`. Untuk remaining_accounts, validasi `owner == spl_token::ID || owner == spl_token_2022::ID` dan cocokkan dengan akun token program yang dipasok.
- Catatan UI: `amount_to_ui_amount` memakai f64 dan truncation. Aturan proyek membolehkan float hanya untuk membaca multiplier. Konversi ke fixed-point (mis. `(m * 1e9) as u128`) sebaiknya dilakukan di satu fungsi yang sama untuk program dan SDK (paritas).

Dependensi program yang teruji:
```toml
[dependencies]
anchor-lang = "1.2.0"
anchor-spl = { version = "1.2.0", default-features = false, features = ["token", "token_2022", "token_2022_extensions", "associated_token"] }
solana-instructions-sysvar = "3"   # lihat §6
[features]
idl-build = ["anchor-lang/idl-build", "anchor-spl/idl-build"]
```

---

## 3. LiteSVM [TESTED]

- Versi: `litesvm 0.16.0` (2026-08-24, agave 4.2.1 crates; dependensinya `solana-transaction 4.1.5`, `solana-message 4.2.4`, `solana-keypair 3.1.2`, `solana-signer 3.0.1`, `solana-address ~2.6.1`, `solana-instruction ~3.4`). `litesvm-token 0.16.0` tersedia untuk helper SPL.
- **BUG TEMPLATE:** `anchor init` 1.2.0 memasang `litesvm = "0.10.0"` (agave 3.1). Karena `anchor build` menghasilkan SBPFv3, `svm.add_program(...)` gagal dengan **`Instruction(InvalidAccountData)`**. Test bawaan langsung GAGAL [TESTED]. Masalah yang sama tercatat di https://github.com/brimigs/anchor-litesvm/issues/3 ("litesvm ^0.11 / agave 3.1 cannot parse the final v3 ELF format").
- Perbaikan yang teruji:
  ```toml
  [dev-dependencies]
  litesvm = "0.16.0"
  solana-message = "4.2.4"
  solana-transaction = "4.1.5"
  solana-signer = "3.0.1"
  solana-keypair = "3.1.2"
  ```
  **Rust host harus dinaikkan**: dengan `rust-toolchain.toml` 1.89.0, `solana-syscalls` gagal (`E0658 maybe_uninit_write_slice` unstable). Dengan rustc 1.98.1 (stable) semuanya lulus. Set `rust-toolchain.toml` → `channel = "stable"` atau versi eksplisit ≥ yang terpasang (hanya 1.98.1 yang teruji; `cargo-build-sbf` tetap memakai toolchain sbpf sendiri, IDL build ikut toolchain host). `solana-address` 1.1 dan 2.6 hidup berdampingan di Cargo.lock tanpa konflik tipe pada pola template.
- API:
  - `LiteSVM::new()` sudah memuat SPL Token (p-token), **Token-2022 11.0.0**, ATA, Memo, ALT, Stake. Tidak perlu menambahkan Token-2022.
  - `svm.add_program(id, &bytes)` / `add_program_from_file(id, path)`. Template memakai `include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/<name>.so"))`. **Wajib `anchor build` sebelum `cargo test`.**
  - Waktu: `let mut c = svm.get_sysvar::<Clock>(); c.unix_timestamp += N; svm.set_sysvar(&c);` dan `svm.warp_to_slot(slot)`. Clock LiteSVM dimulai dari `unix_timestamp = 0`. Panggil `svm.expire_blockhash()` sebelum mengirim tx identik lagi (kalau tidak, muncul error AlreadyProcessed).
  - `svm.airdrop`, `set_account`, `with_sigverify(false)`, `send_transaction(tx) -> Result<TransactionMetadata{logs,…}, FailedTransactionMetadata{err, meta}>`.
- `anchor-litesvm` 0.4.0 (brimigs, komunitas, **tidak resmi**) masih bermasalah dengan SBPFv3 (issue #3). Tidak direkomendasikan; pakai LiteSVM langsung.

---

## 4. Surfpool 1.6.0 [TESTED]

Sumber: `surfpool start --help`, https://solana.com/docs/tools/surfpool (docs.surfpool.run → redirect 308 ke sini), https://solana.com/docs/tools/surfpool/rpc/cheatcodes.

- `getVersion` → `{"surfnet-version":"1.6.0","solana-core":"4.2.1"}`.
- Offline: `surfpool start --offline`. Token (`Tokenkeg…`, upgradeable/p-token), Token-2022 (`TokenzQd…`), dan ATA tersedia di mode offline [TESTED].
- Flag penting: `-p/--port 8899`, `-w/--ws-port 8900`, `-o/--host 127.0.0.1`, `--no-deploy`, `-m/--manifest-file-path ./txtx.yml`, `-r/--runbook deployment`, `-y/--yes` (buat runbook tanpa prompt), `--watch` (redeploy saat .so berubah), `--artifacts-path target/deploy`, `-a/--airdrop <PUBKEY>`, `-k/--airdrop-keypair-path` (default `~/.config/solana/id.json`), `-q/--airdrop-amount` (default 10_000 SOL; `0` = tanpa airdrop), `--snapshot <json>`, `--db ./x.sqlite --surfnet-id <id>` (state persisten), `--no-tui`, `--no-studio`, `-s/--studio-port 18488`, `--daemon`, `--ci`, `-t/--slot-time 400`, `-b/--block-production-mode clock|transaction`, `-f/--feature`, `--features-all`, `--log-level`, `--log-path .surfpool/logs`.
- **Auto-deploy:** tanpa `--no-deploy`, `surfpool start` di folder yang punya Anchor.toml membuat `txtx.yml` + `runbooks/deployment/{main.tx,signers.localnet.tx,signers.devnet.tx,signers.mainnet.tx}` + `runbooks/README.md` (dengan `-y` tanpa prompt), lalu men-deploy semua program lewat `svm::deploy_program` + `svm::get_program_from_anchor_project("<name>")` [TESTED, sekitar 7 detik untuk 2 program]. Gotcha:
  - `txtx.yml` meng-hardcode `localnet.rpc_api_url: http://127.0.0.1:8899`. Kalau `--port` diubah, deploy gagal ("failed to fetch RPC endpoint version").
  - Signer default `~/.config/solana/id.json`. Ubah `signers.localnet.tx` ke keypair proyek (`keypair_json = "…"`).
  - Opsi `instant_surfnet_deployment = true` di `main.tx` menulis bytes lewat cheatcode (deploy instan).
  - Matikan dengan `--no-deploy`, lalu deploy sendiri: `anchor program deploy --provider.cluster http://127.0.0.1:8899 --provider.wallet keys/deployer.json` [TESTED].
- Rekomendasi untuk `bun run dev`: `surfpool start --offline --no-deploy --no-tui -k anchor/keys/deployer.json` (atau `--airdrop <pubkey>`), tunggu RPC siap, lalu `anchor program deploy` per program. Hasilnya deterministik dan tidak bergantung pada runbook. Alternatif: commit runbook yang sudah diedit dan pakai `-y`.
- Studio: `http://127.0.0.1:18488` (default). Kalau port bentrok, Surfpool hanya memberi WARN lalu lanjut.
- Cheatcodes (JSON-RPC, [TESTED] sebagian):
  - `surfnet_timeTravel` params `[{ "absoluteTimestamp": <ms> }]` **dalam milidetik** (Clock sysvar dalam detik, jadi kalikan 1000), atau `{ "absoluteSlot": n }`, atau `{ "absoluteEpoch": n }`. Tanpa params = maju 1 jam. **Hanya maju.** Target di masa lalu → error `Cannot travel to past timestamp`. [TESTED] +30 hari: `unixTimestamp` naik tepat 2_592_000 detik, slot melompat ke 6_480_000.
  - `surfnet_pauseClock []`, `surfnet_resumeClock []`. Waktu bisa dibaca lewat `getAccountInfo SysvarC1ock… jsonParsed`.
  - `surfnet_setAccount [pubkey, {lamports, data(hex), owner, executable, rentEpoch}]`.
  - `surfnet_setTokenAccount [owner, mint, {amount, delegate, delegatedAmount, state, closeAuthority}, tokenProgram?]` (tokenProgram default SPL Token; isi Token-2022 ID untuk mint 2022).
  - Lainnya: `surfnet_setSupply`, `surfnet_setProgramAuthority`, `surfnet_writeProgram [programId, hexData, offset, authority?]`, `surfnet_cloneProgramAccount`, `surfnet_resetAccount`, `surfnet_resetNetwork`, `surfnet_exportSnapshot`, `surfnet_registerIdl`, `surfnet_getActiveIdl`, `surfnet_profileTransaction`, `surfnet_getTransactionProfile`, `surfnet_getLocalSignatures`, `surfnet_getSurfnetInfo`, `surfnet_streamAccount(s)`, `surfnet_offlineAccount`, `surfnet_registerScenario`, `surfnet_enableCheatcode/disableCheatcode`.
- SDK: `@solana/surfpool` (kit plugin), lihat https://solana.com/docs/tools/surfpool/sdk/kit-plugin. Menurut solana-dev-skill, 1.5.0 masih men-declare peer `@solana/kit ^7`, jadi akan muncul peringatan peer.
- Script warp proyek (`bun run warp -- --days N`): baca `Clock.unixTimestamp` (detik), lalu `surfnet_timeTravel {absoluteTimestamp: (ts + N*86400)*1000}`. Karena waktu tidak bisa mundur, sediakan `reset` (restart surfpool / `surfnet_resetNetwork`) untuk demo ulang.

---

## 5. Transaction v1 (SIMD-0385 / SIMD-0296, 4096 byte)

- Mainnet aktif epoch 1035 (2026-09-15, Agave 4.2.2). Feature `txv1aq4pp281K9um3tnPgkfX8UqtFT6wcVW3hNezGLL`. **Devnet: aktif** (dicek via RPC: akun feature terisi `Some(slot)`, devnet menjalankan 4.3.0-rc.0).
- **Surfpool 1.6 offline: v1 jalan** [TESTED]. Transfer v1 via `@solana/kit 8.3.0` (`createTransactionMessage({version:1})` + `setTransactionMessageConfig({computeUnitLimit, loadedAccountsDataSizeLimit})`) punya byte pertama `129`, dan `getTransaction(maxSupportedTransactionVersion: 1)` → `version: 1, err: null`, `transactionConfig` terisi. (Akun feature di Surfpool bernilai `null`, tapi fitur tetap aktif di runtime internal. Jangan jadikan `getAccountInfo` feature sebagai cek di Surfpool.) solana-test-validator 4.2+ juga mengaktifkan semua fitur di genesis.
- LiteSVM 0.16 (agave 4.2.1) seharusnya mendukung v1; `@solana/kit-plugin-litesvm` ≥0.19 mendukung v1. Belum diuji di Rust.
- Wallet: menurut `solana-foundation/transaction-v1-examples/ts/wallet-table/src/known-wallets.ts`, **Phantom, Solflare, dan Backpack belum punya versi v1** (hanya Jupiter Wallet ≥1.18.0). Deteksi di runtime: `connected.supportedTransactionVersions.has(1)` (`@solana/kit-plugin-wallet` ≥0.20).
- Rekomendasi:
  - Transaksi yang ditandatangani **wallet user** (create/join/redeem/follow): **v0** (tanpa ALT kalau muat di 1232 byte; tambah ALT hanya untuk index dengan banyak aset). Pakai v1 hanya kalau `has(1)` true.
  - Transaksi **server-side** (keeper rebalance, agent MCP, seed/price scripts) yang ditandatangani keypair lokal: **v1** aman di localnet/devnet dan menghindari ALT. Tanpa ALT, maksimal 64 akun inline, **alamat duplikat ditolak**, dan **jangan pakai instruksi ComputeBudget** (tidak berpengaruh di v1; pakai `transactionConfig`).
  - Reader/worker: semua `getTransaction`/`getBlock` wajib memakai `maxSupportedTransactionVersion: 1` (integer), dan fee/CU dibaca dari `transactionConfig`.
  - Instructions sysvar di v1 tetap sama. Validasi begin/end dilakukan per index instruksi top-level.

---

## 6. Instructions sysvar & stack height di Anchor 1.2 [TESTED]

- `anchor_lang::solana_program::sysvar::instructions` **hanya** mengekspor `BorrowedAccountMeta`, `BorrowedInstruction` (+ `construct_instructions_data` off-chain). **Tidak ada** `load_instruction_at_checked` / `load_current_index_checked` / `ID`. Tambahkan dependency langsung **`solana-instructions-sysvar = "3"`** (3.0.1; JANGAN 4.x/5.x yang ada di crates.io, karena beda line `AccountInfo`):
  ```rust
  use solana_instructions_sysvar::{load_current_index_checked, load_instruction_at_checked, get_instruction_relative, ID as IX_SYSVAR_ID};
  use anchor_lang::solana_program::instruction::{get_stack_height, TRANSACTION_LEVEL_STACK_HEIGHT}; // TRANSACTION_LEVEL_STACK_HEIGHT == 1

  #[account(address = solana_instructions_sysvar::ID)]
  /// CHECK: instructions sysvar
  pub instructions: UncheckedAccount<'info>,

  require_eq!(get_stack_height(), TRANSACTION_LEVEL_STACK_HEIGHT);        // bukan dipanggil via CPI
  let ixs = ctx.accounts.instructions.to_account_info();
  let cur = load_current_index_checked(&ixs)? as usize;                   // u16 → usize
  let me  = load_instruction_at_checked(cur, &ixs)?;                      // Instruction { program_id, accounts, data }
  require_keys_eq!(me.program_id, crate::ID);
  ```
  (`anchor_lang::prelude::Instructions` juga di-export sebagai tipe sysvar id.) [TESTED] log: `current index 0`.
- Pola begin/end rebalance: di `begin_rebalance`, iterasi `i = cur+1..` dengan `load_instruction_at_checked(i)` sampai error `InvalidArgument` (akhir tx). Pastikan ada tepat satu `end_rebalance` (cek `program_id == crate::ID` + 8 byte diskriminator `instruction::EndRebalance::DISCRIMINATOR`) dan setiap instruksi di antaranya adalah program/diskriminator yang di-whitelist (mis. `mock_market::swap`). Sysvar ini hanya berisi instruksi **top-level**, jadi CPI di dalamnya tidak terlihat. Karena itu `get_stack_height()==1` wajib di begin/end agar tidak bisa dibungkus program lain.

---

## 7. Biaya deploy devnet & faucet

- Rent terukur (RPC `getMinimumBalanceForRentExemption`, **devnet = mainnet saat ini**): 0 byte = 650_240 lamports; 102_445 byte = 521_070_840; 204_845 byte = 1_041_262_840, yaitu sekitar **5_080 lamports/byte** (lebih rendah dari angka lama 6_960).
- ProgramData = 45 byte header + panjang .so (agave 4.x: `--max-len` default = panjang program, tidak lagi 2x; auto-extend saat upgrade, `--no-auto-extend` untuk mematikan).
  - **Per 100 KiB .so ≈ 0,52 SOL** terkunci permanen (bisa ditarik lewat `anchor program close`).
  - Saat deploy dibutuhkan **buffer sementara dengan ukuran sama**, jadi saldo minimum sekitar **2× (≈1,05 SOL per 100 KiB)**. Buffer dikembalikan setelah deploy sukses. Fee tx write sekitar 100 × 5000 lamports (<0,001 SOL). Upload IDL (program-metadata) kecil.
  - Perkiraan proyek: program dengan anchor-spl sekitar 200–400 KiB per program, jadi 2 program ≈ 2–4 SOL terkunci dan butuh saldo sekitar 4–8 SOL saat deploy pertama. Upgrade membutuhkan buffer baru (2× lagi sementara).
- Faucet:
  - https://faucet.solana.com: "Maximum of 2 requests every 8 hours". Login GitHub membuka limit lebih tinggi. Halaman itu menyatakan agen AI **tidak boleh** memakainya dan mengarahkan ke CLI/`devnet-pow`/local validator. Jadi pengguna yang harus mendanai deployer sendiri.
  - `solana airdrop 2 <PUBKEY> -u devnet`: rate limit tidak dipublikasikan dan sering gagal.
  - `cargo install devnet-pow` (PoW faucet), faucet QuickNode (sekali per 12 jam), Chainstack (sekali per 24 jam), Blueshift, SolFaucet, Discord (The 76 Devs, LamportDAO). Daftar lengkap: https://solana.com/developers/cookbook/development/airdrops-and-faucets.
  - Untuk P11: dokumentasikan bahwa pengguna perlu mengisi `anchor/keys/deployer.json` (pubkey dicetak script) dengan ≥8 SOL devnet sebelum `bun run deploy:devnet`, lalu script memeriksa saldo di awal.

---

## 8. Ringkasan risiko / blocker

1. **PATH memakai solana 3.1.10**, bukan 4.2.2. Pengguna perlu `agave-install init 4.2.2`, atau script proyek harus mem-prepend path 4.2.2.
2. **Template `anchor init` rusak**: litesvm 0.10 tidak bisa memuat SBPFv3. Naikkan ke litesvm 0.16 + solana-message/transaction 4.x, **dan** naikkan `rust-toolchain.toml` (1.89 gagal; stable 1.98.1 lulus).
3. `anchor new` tidak menambah dev-deps/tests. Tambahkan manual.
4. `anchor localnet` panic tanpa stdin dan meninggalkan surfpool yatim. Di dev script, jalankan `surfpool start` langsung.
5. ScaledUiAmount tidak ada di anchor-spl. Pakai re-export `anchor_spl::token_2022::spl_token_2022::extension::scaled_ui_amount` dengan CPI manual. `current_multiplier` privat, jadi replikasi sendiri.
6. `solana-instructions-sysvar = "3"` harus ditambahkan eksplisit.
7. `surfnet_timeTravel` memakai **milidetik** dan hanya maju.
8. v1: jangan jadikan default untuk wallet (Phantom belum mendukung). v1 hanya untuk keypair server.
9. `anchor codama generate` memanggil npx, jadi pakai bunx/codama langsung.
10. Build pertama mengunduh platform-tools v1.57 (~290 MB). **Jangan jalankan dua `anchor build` paralel** saat unduhan pertama karena keduanya saling merusak cache. [TESTED: menimbulkan error `failed to unpack … clang-22` / `Unable to rename`.]

## Sumber
- Anchor CHANGELOG: https://github.com/solana-foundation/anchor/blob/master/CHANGELOG.md ; source CLI tag v1.2.0: https://raw.githubusercontent.com/solana-foundation/anchor/v1.2.0/cli/src/lib.rs
- Anchor docs: https://www.anchor-lang.com/docs/references/anchor-toml , https://www.anchor-lang.com/docs/installation
- crates.io API: anchor-spl/anchor-lang 1.2.0, litesvm 0.16.0, spl-token-2022-interface 2.1.0/3.1.1, solana-instructions-sysvar 3.0.1
- Surfpool: https://solana.com/docs/tools/surfpool , https://solana.com/docs/tools/surfpool/rpc/cheatcodes
- Transaction v1: https://solana.com/upgrades/larger-transaction-sizes , https://github.com/solana-foundation/solana-dev-skill/blob/main/skills/solana-dev/references/transactions-v1.md , https://github.com/solana-foundation/transaction-v1-examples (wallet-table/known-wallets.ts), https://solanacompass.com/news/transaction-v1-simd-0385-is-live-on-solana-mainnet-at-epoch-1035
- SBPFv3: https://app.xroot.dev/upgrades/simd-0178-sbpf-v3-programs , https://github.com/brimigs/anchor-litesvm/issues/3
- Faucet: https://faucet.solana.com , https://solana.com/developers/cookbook/development/airdrops-and-faucets
