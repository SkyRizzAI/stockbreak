# R2 — Client stack research (Kit 8, Codama, wallets, Token-2022, Actions)

Date: 2026-09-24. Everything below was checked against npm and the installed package sources/types in a throwaway Bun project (`/private/tmp/claude-501/research/r2`, since deleted). Every snippet in `R2-snippets/` passed `tsc --strict` (moduleResolution `bundler`) against these exact versions. The event parser was also run.

Snippets (copy these, don't retype them): `/private/tmp/claude-501/research/R2-snippets/`
- `codama.example.json`, `demo-anchor-idl.json`, `generated-demo-client/`: real Codama output from an Anchor-format IDL
- `providers.tsx`, `wallet-button.tsx`: Next.js App Router client provider plus a wallet UI
- `dev-wallet.ts`: a Wallet Standard dev wallet backed by a localStorage keypair
- `anchor-events.ts`: decodes Anchor `emit!` events from logs, with CPI-stack awareness
- `manual-v0-alt.ts`: v0, Address Lookup Tables and simulated CU estimation
- `action-route.ts`: a Solana Action (GET/POST/OPTIONS) written by hand with Kit
- The snippets import `../clients/demo/src/generated`. Change these to the real SDK path.

## 0. Version table (npm `latest`, 2026-09-24)

| Package | Version | Key deps / peers |
|---|---|---|
| `@solana/kit` | **8.3.0** | exports `MAX_SUPPORTED_TRANSACTION_VERSION` (=1) |
| `@solana/react` | **8.3.0** | peers: `@solana/kit ^8.3.0`, `react >=18`, optional `swr ^2.5.1`, `@tanstack/react-query ^5` |
| `@solana/kit-plugin-wallet` | **0.20.0** (2026-09-10) | peers: `@solana/kit ^8.2.0`, `@solana/react ^8.2.0`, **`react ^19.2.8`**; deps `@solana/wallet-account-signer`, `@wallet-standard/*` |
| `@solana/kit-plugin-rpc` | 0.19.0 | `solanaRpc`, `solanaLocalRpc`, `solanaDevnetRpc`, … |
| `@solana/kit-plugin-signer` | 0.19.0 | `signer`, `signerFromFile`, `generatedSigner`, `airdropSigner` … (scripts/worker/tests) |
| `codama` (CLI + lib) | 1.11.0 | bundles `@codama/cli` 1.6.3 |
| `@codama/nodes-from-anchor` | 1.5.6 | deps `@solana/codecs ^8.3.0` |
| `@codama/renderers-js` | **2.5.0** | generated package gets peer `@solana/kit ^8.3.0` |
| `@solana-program/system` | 0.15.0 | peer kit ^8.3 |
| `@solana-program/token` | 0.17.0 | peer kit ^8.3 |
| `@solana-program/token-2022` | 0.19.0 | peers kit ^8.3, `@solana/sysvars ^8`, `@solana/zk-sdk ^0.5.1` (zk-sdk is needed only for the `./confidential` subpath) |
| `@solana-program/compute-budget` | 0.19.0 | |
| `@solana-program/address-lookup-table` | 0.15.0 | |
| `@wallet-standard/wallet` | 1.1.1 | `registerWallet` |
| `@wallet-standard/base` / `features` | 1.1.1 | |
| `@solana/wallet-standard-features` | 1.5.0 | `SolanaTransactionVersion = 'legacy' \| 0 \| 1` |
| `@solana/wallet-standard-chains` | 1.1.2 | `solana:mainnet\|devnet\|testnet\|localnet` |
| `@solana/actions-spec` | 2.4.2 (types only, zero runtime deps, last published 2024-10) | |
| `@solana/actions` | 1.6.6 (last published 2024-11) | **depends on `@solana/web3.js ^1.61`, so it is FORBIDDEN** |
| `@dialectlabs/blinks` 0.22.5 / `blinks-core` 0.20.7 | | depend on web3.js v1 + wallet-adapter, so **FORBIDDEN** |

Do not install these deprecated umbrella packages: `@solana/kit-plugins` (0.15.1, pins old plugin versions), `@solana/kit-plugin-payer`, `@solana/kit-plugin-airdrop`, `@solana/kit-client-rpc`. Also avoid `@solana/client` / `@solana/react-hooks` (framework-kit, stale).

---

## 1. Codama: Anchor 1.x IDL to a Kit client

**Recommended approach: the `codama` CLI with `codama.json`.** The CLI reads an **Anchor IDL directly** and converts it automatically with nodes-from-anchor ("`idl`: … can be a Codama IDL or an Anchor IDL which will be automatically converted"). You don't need a hand-written script. A programmatic script is still an option if you need custom visitors, but `before`/`scripts` visitors in the config cover most cases.

Setup (official commands):
```bash
bun add -d codama @codama/renderers-js   # (@codama/nodes-from-anchor is pulled in by codama)
bunx codama init --default               # creates codama.json (js + rust scripts)
bunx codama run js                       # generate
```
Gotchas I hit:
- `codama init --default` still **prompts "Install dependencies? (Y/n)"** and would run **`yarn add @codama/renderers-js @codama/renderers-rust`**, because it detects the package manager and falls back to yarn. Answer `n` (`printf 'n\n' | bunx codama init --default`), then `bun add` yourself. Remove the `rust` script from the generated config.
- `additionalIdls: [...]` lets one config generate several Anchor programs (index_vault + mock_market).

Recommended `codama.json` (tested):
```json
{
  "idl": "anchor/target/idl/index_vault.json",
  "additionalIdls": ["anchor/target/idl/mock_market.json"],
  "before": [],
  "scripts": {
    "js": {
      "from": "@codama/renderers-js",
      "args": ["packages/sdk", { "generatedFolder": "src/generated", "kitImportStrategy": "rootOnly", "syncPackageJson": false }]
    }
  }
}
```
- `kitImportStrategy: "rootOnly"` makes the generated code import only `@solana/kit` and `@solana/kit/program-client-core`. With the default `preferRoot` it imports **`@solana/program-client-core`** (a granular package) as well, and that is only resolvable through hoisting. rootOnly requires `moduleResolution: "bundler"`, which Next.js uses and is fine.
- `syncPackageJson` (default `true`) rewrites or creates the target `package.json` (it added `peerDependencies: { "@solana/kit": "^8.3.0" }`). Turn it off if packages/sdk owns its package.json.
- `deleteFolderBeforeRendering` defaults to true. Keep hand-written code outside `src/generated`.
- **Kit 8 confirmed:** renderers-js 2.5.0 output typechecks under strict TS against `@solana/kit` 8.3.0, and the generated peer range is `^8.3.0`.

What gets generated (checked in the real output, `R2-snippets/generated-demo-client/`):
- **accounts/**: `COUNTER_DISCRIMINATOR`, `getCounterDecoder/Encoder/Codec`, `decodeCounter`, `fetchCounter`, `fetchMaybeCounter`, `fetchAllCounter`, `getCounterSize`
- **instructions/**: `getXInstruction` (sync) and `getXInstructionAsync`. The async version **auto-derives PDAs from the Anchor `pda.seeds`** and defaults known addresses such as system_program. `parseXInstruction` is also generated.
- **pdas/**: `findCounterPda`
- **errors/**: `DEMO_ERROR__OVERFLOW = 0x1770`, `getDemoErrorMessage(code)`, `isDemoError(error, txMessage, code?)`. This is the error map.
- **events/** (new in 2.x): `COUNTER_INITIALIZED_EVENT_DISCRIMINATOR`, `getCounterInitializedEventDecoder/Encoder/Codec`, and `parseCounterInitializedEvent(bytes)`, which checks the discriminator. **programs/** adds `enum DemoEvent` and `identifyDemoEvent(bytes)`.
- **programs/**: `DEMO_PROGRAM_ADDRESS`, `identifyDemoAccount/Instruction`, `parseDemoInstruction`, and a **Kit plugin `demoProgram()`**. With it, `createClient().use(...).use(demoProgram())` gives `client.demo.instructions.initialize({...}).sendTransaction()`, `client.demo.accounts.counter.fetch(addr)` and `client.demo.pdas.counter(...)`.

### Decoding Anchor events with Kit
- `emit!` logs `Program data: <base64(8-byte discriminator || borsh)>` (the discriminator is `sha256("event:<Name>")[..8]` and is included in the IDL).
- Codama gives you the decoders but **not the log extraction**. You write that part: walk `meta.logMessages`, keep a stack from `Program <id> invoke [n]` / `Program <id> success|failed`, and accept `Program data:` lines only while the top of the stack is your program. Otherwise a CPI'd program's data line can be mistaken for yours.
- `R2-snippets/anchor-events.ts` does this and was tested with a nested system-program `Program data:` line, which it correctly ignores. It uses `getBase64Encoder().encode(str)` to get bytes (Kit naming: an encoder turns a value into bytes), then `identifyXEvent` and `parseXEvent`.
- Sources of logs: `rpc.getTransaction(sig, { maxSupportedTransactionVersion: 0, encoding: 'json' })` returns `meta.logMessages`, and live updates come from `rpcSubscriptions.logsNotifications({ mentions: [PROGRAM] }, { commitment: 'confirmed' })`.
- Log truncation risk: logs are capped at 10 KB per tx. If events are critical for the worker, consider `emit_cpi!`. The event then lives in inner-instruction data: an 8-byte `EVENT_IX_TAG` (`e445a52e51cb9a1d`), followed by the event discriminator and borsh. Decode it from `meta.innerInstructions` by stripping the first 8 bytes before calling `parseXEvent`. This needs `#[event_cpi]` in the program, which is a contract decision.

---

## 2. @solana/kit 8: client plus plugins, versions, ALT, compute budget

Plugin client:
```ts
import { createClient, lamports } from '@solana/kit';
import { solanaRpc, solanaLocalRpc, solanaDevnetRpc } from '@solana/kit-plugin-rpc';
import { signerFromFile } from '@solana/kit-plugin-signer';
const client = await createClient()
  .use(signerFromFile('.keys/keeper.json'))                  // payer + identity
  .use(solanaLocalRpc({ transactionConfig: { version: 0 } }))  // rpc, rpcSubscriptions, planner, executor, airdrop
  .use(indexVaultProgram());                                   // Codama plugin
await client.sendTransaction([ix]);          // plan → estimate CU (simulate) → sign → send → confirm
client.rpc; client.rpcSubscriptions;         // plain Kit RPC
```
- `solanaRpc({ rpcUrl, rpcSubscriptionsUrl?, transactionConfig?, maxConcurrency?, skipPreflight? })` requires a `payer` plugin **before** it, and TypeScript enforces the order. `solanaLocalRpc` defaults to `http://127.0.0.1:8899` and includes airdrop.
- **Default tx version: omitting `version` gives v0** (checked in `kit-plugin-rpc` 0.19 types: `version?: 'legacy' | 0 … Defaults to version 0`). v1 must be requested with `{ version: 1 }`. The Solana dev skill recommends v1 for new code, **but that doesn't fit this project** (next point).
- **Phantom and v1:** the official wallet table (`solana-foundation/transaction-v1-examples/ts/wallet-table/src/known-wallets.ts`) lists Phantom, Solflare and Backpack **without** v1 support. Only Jupiter has it (1.18.0). v1 went live on mainnet on 2026-09-15, but the wallet-standard field that advertises it was only merged on 2026-09-10. **v1 also does NOT support Address Lookup Tables**, rejects duplicate addresses, and ComputeBudget instructions are no-ops on it.
  - **Recommendation:** use `transactionConfig: { version: 0 }` everywhere (web, worker, scripts, MCP). Optionally gate with `connected.supportedTransactionVersions.has(0)`. Reads must still pass `maxSupportedTransactionVersion: 0` (or `1` to be safe against third-party v1 txs, using the integer, not a string).
- **To force legacy/v0:** use `transactionConfig: { version: 'legacy' | 0, microLamportsPerComputeUnit? }`, or manually `createTransactionMessage({ version: 0 })`.
- **Compute budget:** the plugin executor estimates the CU limit by simulation (`estimateResourceLimits: true` by default; on v0 it appends `SetComputeUnitLimit`). Set the priority fee on v0 with `microLamportsPerComputeUnit`. For manual pipelines Kit 8 exports `fillTransactionMessageProvisoryResourceLimits`, `estimateResourceLimitsFactory({ rpc })` and `estimateAndSetResourceLimitsFactory(estimator)`. `@solana-program/compute-budget` still has `estimateComputeUnitLimitFactory`, `updateOrAppendSetComputeUnitLimitInstruction` and similar, but prefer the Kit root helpers.
- **ALT:** the plugin planner has **no ALT support**. For large rebalance txs use the manual pipeline in `R2-snippets/manual-v0-alt.ts`: `fetchAddressesForLookupTables(addrs, rpc)`, then `compressTransactionMessageUsingAddressLookupTables(msg, map)`, then estimate, then `signTransactionMessageWithSigners`, then `sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions })`. Create and extend tables with `@solana-program/address-lookup-table` (`getCreateLookupTableInstructionAsync`, `getExtendLookupTableInstruction`, `findAddressLookupTablePda`, `fetchAddressLookupTable`). A new ALT becomes usable one slot after extend, so wait for the next slot before using it.
- Other Kit 8 exports worth knowing: `sendAndConfirmTransactionFactory`, `sendAndConfirmDurableNonceTransactionFactory`, `signAndSendTransactionMessageWithSigners` (for sending-signer wallets), `partiallySignTransactionMessageWithSigners`, `decompileTransactionMessageFetchingLookupTables`, `extendClient`, `createNoopSigner`.

---

## 3. @solana/kit-plugin-wallet 0.20 + @solana/react 8 in Next.js App Router

The plugin is **not immature**: it has a 409-line README, SSR stubs, auto-reconnect, React hooks, and a typed `supportedTransactionVersions`. Use it and don't fall back to `@wallet-standard/react`. `@solana/react`'s old `SelectedWalletAccountContextProvider` and `useWalletAccount*Signer` hooks are being deprecated, so don't use them.

- Plugins: `walletSigner` (payer + identity), `walletPayer`, `walletIdentity`, `walletWithoutSigner`. Config: `{ chain (required), storage = localStorage | null, storageKey = 'kit-wallet', autoConnect = true, filter? }`.
- **SSR:** it's safe to construct at module scope in a `'use client'` file. On the server, `status` stays `'pending'`, actions throw and nothing touches storage or the registry. `client.payer` throws while disconnected, so read it only inside handlers.
- State: `client.wallet.getState()` returns `{ wallets, connected: { wallet, account, signer, supportedTransactionVersions } | null, status, reconnectingTo }`. Actions are `connect(uiWallet)`, `disconnect()`, `selectAccount()`, `signMessage(bytes)` and `signIn(wallet, input)` (SIWS). Double connects reject with `AbortError`, which you can ignore.
- Hooks (`@solana/kit-plugin-wallet/react`, each takes `client`): `useWallets`, `useConnectedWallet`, `useWalletStatus`, `useIsWalletReady`, `useReconnectingAccount`, `useConnect`, `useDisconnect`, `useSignIn`, `useSignMessage` (returns `ActionResult`: `dispatch`, `isRunning`, `error`, `data`), `useSelectAccount`, and `<WalletReadyGate client fallback>`.
- `@solana/react`: `ClientProvider`, `useClient<AppClient>()`, `useAction`, `useRequest`, `useSubscription`, `useTrackedData`, `useSendTransaction`, `useSignTransaction`, and TanStack adapters in **`@solana/react/query`** (`useRequestQuery`, `useSubscriptionQuery`, `useTrackedDataQuery`), which match the project's TanStack Query stack. There is also `@solana/react/swr`.
- **signTransaction vs signAndSend:** the `solanaRpc` executor calls `signTransactionMessageWithSigners`. That means the wallet's **`solana:signTransaction`** (modifying signer) is used and **the app sends through its own RPC**, which is what we want for localnet. `signAndSendTransactionMessageWithSigners` uses the wallet's `solana:signAndSendTransaction`, so the wallet sends to its own cluster. Avoid that on localnet.
- Code: `R2-snippets/providers.tsx` and `wallet-button.tsx` (both typecheck). `app/layout.tsx` (a Server Component) wraps children in `<Providers>`.
- Chain gotcha: the plugin **filters wallets by `uiWallet.chains.includes(chain)`**, and the signer is created for that chain. If Phantom doesn't advertise `solana:localnet`, it disappears from the list on localnet. Mitigation: make the wallet chain configurable (`NEXT_PUBLIC_WALLET_CHAIN`). On localnet, use `'solana:devnet'` as the wallet-side chain while the RPC points at 127.0.0.1. This is harmless because we sign only and the app sends.
- Official refs: README in the package (npm `@solana/kit-plugin-wallet`), https://github.com/anza-xyz/kit-plugins, https://github.com/anza-xyz/kit/tree/main/examples/react-app, https://github.com/anza-xyz/kit/tree/main/packages/react.

---

## 4. Custom dev wallet (Wallet Standard, localStorage keypair)

`R2-snippets/dev-wallet.ts` is complete and typechecks:
- `registerWallet(new DevWallet())` from `@wallet-standard/wallet`. Call it in the browser only, once (`typeof window` guard), before or independently of the client. The plugin discovers late registrations.
- Chains: `['solana:localnet', 'solana:devnet']`. Features: `standard:connect`, `standard:disconnect`, `standard:events` (change listeners), `solana:signTransaction` and `solana:signAndSendTransaction` (both with `supportedTransactionVersions: ['legacy', 0, 1]`), and `solana:signMessage`.
- Signing: `getTransactionDecoder().decode(bytes)`, then `partiallySignTransaction([keyPair], tx)`, then `getTransactionEncoder().encode(...)`. The key is a 32-byte seed in localStorage passed to `createKeyPairFromPrivateKeyBytes(seed)`. The address comes from `getAddressFromPublicKey`, and `WalletAccount.publicKey` is `getAddressEncoder().encode(addr)`. `signMessage` uses `signBytes(privateKey, msg)`. `signAndSend` posts `sendTransaction` (base64) to the chain's RPC and returns base58-decoded 64-byte signature bytes.
- Useful for Playwright E2E (no extension needed) and demos. Enable it only with `NEXT_PUBLIC_DEV_WALLET=1` and never on mainnet. Label it "Dev wallet (Simulated)". The seed is a plaintext secret in localStorage, which is acceptable only for localnet/devnet test funds.
- References: https://github.com/wallet-standard/wallet-standard (`packages/core/wallet`, example `packages/example/wallets`), https://github.com/anza-xyz/wallet-standard (`packages/wallet-standard-features`, `-chains`, `-wallet-adapter` for a reference `SolanaWalletAdapterWallet` implementation).

---

## 5. Token-2022 ScaledUiAmount (`@solana-program/token-2022` 0.19.0): yes, full support

- Instructions: `getInitializeScaledUiAmountMintInstruction({ mint, authority, multiplier })` (pre-InitializeMint) and `getUpdateMultiplierScaledUiMintInstruction({ mint, authority, multiplier, effectiveTimestamp, multiSigners? })`. Parsers exist for both.
- Decoding: `fetchMint` gives `data.extensions` (an Option) containing `{ __kind: 'ScaledUiAmountConfig', authority, multiplier: number(f64), newMultiplierEffectiveTimestamp: bigint, newMultiplier: number }`. Build extension args with `extension('ScaledUiAmountConfig', {...})`. Sizing and setup: `getMintSize([ext])`, `getPreInitializeInstructionsForMintExtensions`, `getPostInitializeInstructionsForMintExtensions`.
- UI math:
  - `amountToUiAmountForScaledUiAmountMintWithoutSimulation(amount: bigint, decimals, multiplier): string` is implemented as `Number(amount) * (multiplier / 10^decimals)`, using f64.
  - `uiAmountToAmountForScaledUiAmountMintWithoutSimulation(ui, decimals, multiplier): bigint` truncates.
  - `amountToUiAmountForMintWithoutSimulation(rpc, mint, amount)` fetches the mint and the Clock sysvar, then picks `newMultiplier` if `clock.unixTimestamp >= newMultiplierEffectiveTimestamp`. Replicate that timestamp rule in the vault program and SDK parity tests.
  - On-chain alternatives: `getAmountToUiAmountInstruction` / `getUiAmountToAmountInstruction` via simulation.
- Plugin: `token2022Program()` adds `client.token2022`. Also available: `findAssociatedTokenPda`, `getCreateAssociatedTokenIdempotentInstruction`, `getTransferCheckedInstruction`.
- Peer warning: `@solana/zk-sdk` is declared as a peer, but the main entry works without it (only `@solana-program/token-2022/confidential` needs it). Bun may print an unmet-peer warning, which is harmless.

---

## 6. Phantom

- Phantom supports Wallet Standard on Solana out of the box (https://docs.phantom.com/developer-powertools/wallet-standard). Their docs warn: "ensure that you are not mutating transactions in place". Kit already works this way.
- Networks: Settings → Developer Settings → **Testnet Mode**. The official docs (https://docs.phantom.com/developer-powertools/testnet-mode, https://help.phantom.com/hc/en-us/articles/5997313271699) list **Solana Devnet and Testnet only**. Localnet/localhost and custom RPC are **not documented**. Older community guides mention a "Localhost" network option in the extension, which is unverified today.
- Transaction versions: legacy and v0 are fine. **v1 is not supported** (see §2).
- **Can Phantom sign a localnet tx?** `solana:signTransaction` signs the bytes it is given, so the app can send them to its own RPC regardless of cluster. Phantom's preview simulates on its selected cluster (mainnet or devnet), so on localnet the preview will fail or warn ("unable to simulate"). The user can usually still approve, but that is **unverified** and Phantom may add warnings. Phantom may also modify a tx it signs (e.g. inserting Lighthouse guard instructions on mainnet). Kit's modifying signer accepts the modified tx.
- **Whether Phantom advertises `solana:localnet` in `wallet.chains` is unverified.** Check it at runtime in the browser console: `(await import('@wallet-standard/app')).getWallets().get().map(w => [w.name, w.chains, Object.keys(w.features)])`. Until you've checked, use the configurable wallet-chain fallback from §3.
- Recommendation: localnet uses the **Dev wallet** (primary, and E2E) plus Phantom best-effort (wallet chain = devnet). Devnet uses Phantom in Testnet Mode (Solana Devnet) as the primary path.

---

## 7. Solana Actions and Blinks

- `@solana/actions` 1.6.6 depends on **web3.js v1**, and Dialect's `@dialectlabs/blinks*` depend on web3.js v1 and wallet-adapter. **Both are forbidden, so implement the spec manually.** Use `@solana/actions-spec` 2.4.2 for **types only** (it has no runtime deps). Import `ActionGetResponse`, `ActionPostRequest`, `ActionPostResponse`, `NextActionPostRequest`, `ActionsJson`, `LinkedAction`, `ActionParameter`, `CompletedAction`.
- **Headers** on every action route and on `actions.json`, including OPTIONS (copied from `@solana/actions` constants, spec v2.4):
  ```
  Access-Control-Allow-Origin: *
  Access-Control-Allow-Methods: GET,POST,PUT,OPTIONS
  Access-Control-Allow-Headers: Content-Type, Authorization, Content-Encoding, Accept-Encoding, X-Accept-Action-Version, X-Accept-Blockchain-Ids
  Access-Control-Expose-Headers: X-Action-Version, X-Blockchain-Ids
  Content-Type: application/json
  X-Action-Version: 2.4
  X-Blockchain-Ids: solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1   (devnet; mainnet 5eykt4Us…, testnet 4uhcVJyU…)
  ```
  OPTIONS should return the same headers. Set `*` CORS **only** on action routes and actions.json.
- **GET** returns `{ type:'action', icon (absolute URL), title, description, label, disabled?, links?: { actions: [{ type:'transaction'|'message'|'post'|'external-link', href, label, parameters?: [{ type?, name, label?, required?, pattern?, min?, max?, options? }] }] }, error?: { message } }`. The `href` uses `{name}` templating for parameters.
- **POST** receives `{ account, data? }`. For `type:'transaction'` it returns `{ type:'transaction', transaction: base64 wire tx (unsigned or partially signed, fee payer = account, recent blockhash), message?, links?: { next } }`. Other response types are `post`, `external-link` and `message` (signMessage data).
- **Chaining:** `links.next` is either `{ type:'inline', action: NextAction }` or `{ type:'post', href }`. The client POSTs `{ account, signature }` to the callback (for message actions: `{ account, signature, state?, data? }`) and gets back a `NextAction`, which is either an `Action` or `{ type:'completed', icon, title, description, label }`.
- **actions.json** at the domain root (`/actions.json`, with CORS `*`): `{ "rules": [{ "pathPattern": "/index/*", "apiPath": "/api/actions/join/*" }] }` (`*` matches one segment, `**` several). In Next.js, create `app/actions.json/route.ts`.
- Build the transaction with Kit (see `R2-snippets/action-route.ts`, which typechecks): `createNoopSigner(account)` as fee payer, then `compileTransaction`, then `getBase64EncodedWireTransaction`. Use **v0 or legacy**. Validate `account` with `address()`, and return 400 with `{ message }` on errors.
- **Testing:**
  - `curl -i` for GET, OPTIONS and POST locally, plus unit tests on the handlers.
  - The Blinks Inspector (https://www.blinks.xyz/inspector) and dial.to (`https://dial.to/?action=solana-action:<url>`) fetch from their own origin, so they need a **public HTTPS URL**. Use a tunnel such as `cloudflared tunnel --url http://localhost:3000` or ngrok. The `@solana/actions` URL helpers also assume `https:`.
  - Blink clients sign with the user's wallet on a real cluster, so **only devnet actions are meaningfully testable**. Localnet Blinks are only practical through our own in-app renderer, which uses the same JSON and the Kit wallet client.
  - Unregistered actions render on dial.to with an "unregistered" badge. X/Twitter unfurling requires Dialect registry approval, so it is out of scope.

---

## Risks / decisions to record (docs/DECISIONS.md)
1. **Tx version = v0, not v1.** Phantom, Solflare and Backpack can't sign v1, and v1 has no ALTs. Plugin clients get `transactionConfig: { version: 0 }`, and reads use `maxSupportedTransactionVersion: 0` (or 1).
2. **Phantom on localnet is unverified.** The primary localnet wallet is the custom Dev wallet. Phantom uses a wallet-chain fallback to `solana:devnet` with app-side sending (signTransaction). Verify `wallet.chains` manually once.
3. **Codama:** use the `codama` CLI with `kitImportStrategy: 'rootOnly'`. `codama init` tries to run yarn, so decline and `bun add`.
4. **Events:** Codama does not extract logs, so write a CPI-stack-aware `Program data:` parser. Consider `emit_cpi!` for truncation-proof indexing (a contract decision).
5. **Actions:** no `@solana/actions` or `@dialectlabs/blinks` (web3.js v1). Hand-roll the spec with `@solana/actions-spec` types. dial.to testing needs a devnet tunnel.
6. **`@solana/kit-plugin-wallet` requires `react ^19.2.8`.** Ensure the Next 16 app is on React ≥19.2.8.
7. **ScaledUiAmount UI math is f64** in the JS lib. The vault program must use checked integer math (e.g. store the multiplier as f64 but compute with fixed-point `u128`, per CLAUDE.md), and SDK parity tests must pin the rounding and timestamp rules.
8. **Plugin planner has no ALT support.** Rebalance txs with many `remaining_accounts` need the manual v0+ALT pipeline in the SDK.

## Sources
- Package READMEs and type definitions installed from npm (listed versions): `@solana/kit-plugin-wallet/README.md`, `@codama/renderers-js/README.md`, `@codama/cli/README.md`, `@solana/kit-plugin-rpc/dist/types/transaction-planner.d.ts`, `@solana-program/token-2022/dist/src/index.mjs`, `@solana/actions-spec/README.md` + `index.d.ts`, `@solana/actions@1.6.6/lib/esm/constants.js`
- https://github.com/codama-idl/codama, https://github.com/codama-idl/renderers-js
- https://github.com/anza-xyz/kit, https://github.com/anza-xyz/kit-plugins
- https://github.com/solana-foundation/transaction-v1-examples (wallet-table/known-wallets.ts)
- https://solana.com/upgrades/larger-transaction-sizes, SIMD-0385
- https://docs.phantom.com/developer-powertools/wallet-standard, https://docs.phantom.com/developer-powertools/testnet-mode, https://help.phantom.com/hc/en-us/articles/5997313271699-About-devnet-and-tesnet-networks
- https://solana.com/docs/advanced/actions, https://github.com/solana-developers/solana-actions, https://www.blinks.xyz/inspector, https://docs.dialect.to/blinks
