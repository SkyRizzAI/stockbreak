# R3 — Web and infra scaffolding research (checked 2026-09-24)

Environment: Bun 1.3.14, Node 24.14.1, macOS arm64, OrbStack (compose v5).
Method: `npm view` for versions. Every generator was run in `/private/tmp/claude-501/research/gen/*` to confirm its flags and output, and that directory was deleted afterwards. Docs were fetched from the official sources given in each section.

## 0. Versions (npm `latest`, 2026-09-24)

| Package | Version | Notes |
|---|---|---|
| create-turbo / turbo | 2.11.3 | |
| create-next-app / next / @next/env | 16.3.6 | the template pins react 19.2.8 (npm latest is 19.3.0) |
| shadcn | 4.21.0 | default style `base-nova` (Base UI) |
| tailwindcss | 4.3.3 | create-next-app writes `^4` + `@tailwindcss/postcss` |
| @biomejs/biome | 2.5.14 | create-next-app pins 2.4.2 and create-turbo pins 2.5.12; bump both to 2.5.14 |
| drizzle-orm / drizzle-kit | 0.45.3 / 0.31.11 (`latest`) | 1.0.0-rc.4 is on the `rc` tag, and the docs now show `@rc` |
| postgres (postgres.js) | 3.4.9 | |
| create-playwright / @playwright/test | 1.17.139 / 1.63.0 | |
| @modelcontextprotocol/server, /client | 2.1.0 | v2 is now the stable line |
| @modelcontextprotocol/sdk | 1.30.1 | v1 is legacy: bug and security fixes only, for at least 6 months after v2 |
| @modelcontextprotocol/inspector | 2.7.0 | needs Node >= 22.19 |
| @tanstack/react-query | 5.103.2 | |
| geist | 1.7.2 | |
| zod | 4.6.5 | |
| recharts | 3.10.1 (the shadcn chart pins **3.8.0**) | |
| sonner 2.0.8, cmdk 1.1.1, vaul 1.1.2 | | the base-nova drawer uses Base UI, not vaul |
| typescript | **7.0.2** is `latest` | create-turbo, bun init and create-playwright now pull TS 7; create-next-app still writes `^5` |
| bun | 1.4.2 on npm | generators write `bun@1.4.2`; local is 1.3.14 (see gotchas) |
| postgres docker | `postgres:18.6-alpine` / `18-alpine` | 19 is beta only |

---

## 1. Turborepo

Source: `bunx create-turbo@latest --help` (checked by running it); https://turborepo.dev/docs ; example list: https://github.com/vercel/turborepo/tree/main/examples

```
Usage: create-turbo <project-directory> [options]
  -m, --package-manager <pm>   npm|yarn|pnpm|bun|nub|aube
  --skip-install
  --skip-transforms
  --turbo-version <version>
  -e, --example <name>|<github-url>
  -p, --example-path <path>
  --no-git                     Skip initializing a git repository
```

The repo is not empty, so run the generator in a temp dir and then move the files:
```bash
cd "$(mktemp -d)" && bunx create-turbo@latest stocklana -m bun --skip-install --no-git -e with-biome
# confirm there is no stocklana/.git, then rsync/cp into the repo root (do not overwrite CLAUDE.md/.gitignore/docs)
```
- There is no "empty" example. Candidates:
  - `basic`: apps/docs, apps/web, packages/{ui,eslint-config,typescript-config}, plus prettier.
  - `with-biome` (recommended): the same apps, but with `packages/biome-config` in place of eslint-config, and a root `biome.json` with `"root": true`.
  - `with-shell-commands`: the most barebones. It has only turbo, dummy packages and no TS config, and it sets `engines.node >= 24.19.0`, which is newer than the local 24.14.1.
- **Delete after generating:** `apps/docs`, and `apps/web`, because create-next-app will regenerate it. Also delete `packages/ui` if shadcn stays inside apps/web, `packages/eslint-config` (basic) or `packages/biome-config` (you can instead keep the Biome root config plus `extends: "//"`), `prettier` in the root devDeps and the `format` script, and `.npmrc` (empty). Keep `packages/typescript-config`; it is useful.
- Generated root `package.json`: `"workspaces": ["apps/*","packages/*"]` (add `"e2e"`), `devEngines.packageManager {name: bun, version: 1.4.2}`, and `engines.node >=24`. Turbo 2.11 accepts `devEngines` instead of `packageManager`. I tested turbo 2.11.3 on bun 1.3.14 with `devEngines` set to 1.4.2 and it worked without error. Still, set the version to the one actually installed (`1.3.14`) or run `bun upgrade`. Also consider adding `"packageManager": "bun@1.3.14"` for other tooling.
- Bug in the with-biome template: `apps/web/package.json` has `"@repo/biome-config": "^"`, an invalid range. Irrelevant if apps/web is regenerated.

turbo.json v2 (generated shape plus env recommendations):
```jsonc
{
  "$schema": "https://turborepo.dev/schema.json",
  "ui": "tui",
  "globalDependencies": [".env"],               // root .env affects every hash
  "globalEnv": ["NODE_ENV", "SOLANA_CLUSTER", "RPC_URL"],        // vars that affect all tasks
  "globalPassThroughEnv": ["DATABASE_URL"],     // available at runtime, not hashed
  "tasks": {
    "build": { "dependsOn": ["^build"], "inputs": ["$TURBO_DEFAULT$", ".env*"],
               "outputs": [".next/**", "!.next/cache/**", "!.next/dev/**", "dist/**"],
               "env": ["NEXT_PUBLIC_*"] },
    "lint": { "dependsOn": ["^lint"] },
    "check-types": { "dependsOn": ["^check-types"] },
    "test": { "dependsOn": ["^build"], "outputs": [] },
    "dev": { "cache": false, "persistent": true }
  }
}
```
- envMode: **Strict is the default.** At runtime a task only sees variables listed in `env`/`globalEnv`/`passThroughEnv`/`globalPassThroughEnv`. You can use `--env-mode=loose` per run or `"envMode": "loose"` at the root. Framework inference automatically includes `NEXT_PUBLIC_*` for Next apps. Source: https://turborepo.dev/docs/crafting-your-repository/using-environment-variables
- **Turbo does not load .env files.** The docs recommend keeping `.env` per application package and treat a root `.env` as tolerated. Stocklana plans a single root .env, so use `globalDependencies: [".env"]` and load it explicitly in each app (see §2).
- Running: root scripts are `"dev": "turbo run dev"` and so on, and you call them with `bun run dev`. Ad hoc: `bunx turbo run build --filter=web`.

## 2. create-next-app (Next 16.3.6)

Source: `bunx create-next-app@latest --help` (checked by running it); https://nextjs.org/docs/app/api-reference/cli/create-next-app

Flags that exist: `--ts --js --tailwind --react-compiler --eslint --biome --app --src-dir --rspack --import-alias --api --empty --use-bun --reset --skip-install --yes -e --agents-md(default) --disable-git`.
- **`--biome` is supported.** It writes `biome.json` (schema 2.4.2) with `css.parser.tailwindDirectives: true`, `linter.domains: {next: recommended, react: recommended}`, `organizeImports`, and `lint: "biome check"`.
- **There is no `--turbopack` flag.** Turbopack is the default bundler in Next 16 (`--rspack` opts out), so passing `--turbopack` is unnecessary.
- `--no-src-dir` / `--src-dir` both work. `--no-agents-md` disables AGENTS.md/CLAUDE.md.

Command I ran (it produced template `app-tw` without prompts):
```bash
cd "$(mktemp -d)" && bunx create-next-app@latest web --ts --tailwind --biome --app --no-src-dir \
  --import-alias "@/*" --use-bun --skip-install --disable-git --no-agents-md --yes
# then move web/ -> <repo>/apps/web
```
Output: `app/{layout.tsx,page.tsx,globals.css,favicon.ico}`, `next.config.ts`, `postcss.config.mjs` (`@tailwindcss/postcss`), `tsconfig.json` (moduleResolution bundler, `@/*` → `./*`), `biome.json`, and `.gitignore` (which ignores `.env*` and `next-env.d.ts`). Tailwind v4 is CSS-first (`@import "tailwindcss"`, no tailwind.config). The layout already uses `next/font/google` Geist + Geist_Mono and types `LayoutProps<"/">`.

Gotchas:
- The nested `package.json` gets `"packageManager": "bun@1.4.2"`, `trustedDependencies`/`ignoreScripts` (sharp, unrs-resolver). Remove `packageManager` from the workspace and move `trustedDependencies` to the root, because Bun reads it from the root.
- The nested `biome.json` has no `"root": false`. Replace it with `{ "extends": "//" }` plus overrides, or delete it and put the Next domains in the root config.
- Dev deps are pinned loosely (`@types/node ^20`, `typescript ^5`). Align them with the repo TS version. **TS 7 (tsgo) is now npm `latest`.** Decide deliberately and pin one TS version repo-wide. TS 5.9 is the safer choice for Next's TS plugin and Anchor/Codama tooling.
- **AGENTS.md auto-regeneration:** `next dev` rewrites AGENTS.md/CLAUDE.md in the app directory when it detects an AI agent. Disable it with `agentRules: false` in `next.config.ts` (source: `next/dist/server/lib/start-server.js`). Otherwise apps/web gains a CLAUDE.md containing `@AGENTS.md`.
- I verified that `bun run build` passes after adding shadcn (Turbopack).

Loading the root `.env` in the monorepo (Next only reads `.env*` from the app directory). Source: https://nextjs.org/docs/app/guides/environment-variables (`@next/env`):
```ts
// apps/web/next.config.ts
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";
loadEnvConfig(path.resolve(__dirname, "../.."));   // root .env; must run before process.env is read
const nextConfig: NextConfig = { agentRules: false, transpilePackages: ["@stocklana/sdk", "@stocklana/config", "@stocklana/db"] };
export default nextConfig;
```
`bun add @next/env --cwd apps/web`. Existing process env takes precedence over .env. `NEXT_PUBLIC_*` values loaded this way are inlined at build time because next.config runs first. Also validate them with zod in `packages/config`. `transpilePackages` is needed for workspace packages that ship TS source.

## 3. shadcn CLI 4.21

Source: `bunx shadcn@latest init --help` (checked by running it); https://ui.shadcn.com/docs/cli.md , /docs/installation/next.md , /docs/monorepo.md , /docs/components-json.md

The init flags have changed: **there is no `--base-color` flag anymore.** Configuration comes from presets (`-p/--preset <code>`, built at ui.shadcn.com/create) plus `-b/--base base|radix|aria`, `-t/--template`, `--monorepo/--no-monorepo`, `-d/--defaults` (= `--template=next --preset=base-nova`), `--css-variables`, `--rtl`, `--pointer`, `-f`, `-c/--cwd`.

Recommended (simplest): keep shadcn inside apps/web, not in monorepo mode.
```bash
bunx shadcn@latest init -d --no-monorepo -c apps/web
bunx shadcn@latest add -y -c apps/web card dialog tabs table badge skeleton input chart sonner drawer command \
  dropdown-menu tooltip select separator sheet avatar progress alert
```
Checked result: `components.json` = style `base-nova`, `baseColor: "neutral"`, cssVariables true, `tailwind.config: ""` (Tailwind v4), iconLibrary lucide, aliases `@/components`, `@/components/ui`, `@/lib`, `@/lib/utils`, `@/hooks`. Deps added: `@base-ui/react ^1.8`, `class-variance-authority`, **`cn ^0.4`** (`lib/utils.ts` is now `export { cn } from "cn"`, replacing clsx + tailwind-merge), `lucide-react ^1.47`, **`shadcn` as a runtime dep** (globals.css `@import "shadcn/tailwind.css"`), `tw-animate-css`. The components pull in `recharts 3.8.0` (pinned), `sonner ^2.0.8` + `next-themes`, `cmdk ^1.1.1`. **The drawer now uses `@base-ui/react/drawer` (no vaul).**
- Base color: neutral is the default and fits the monochrome UI plan. `baseColor` options are neutral|stone|zinc|mauve|olive|mist|taupe and **cannot be changed after init**. For zinc or Radix primitives, build a preset at ui.shadcn.com/create and run `init --preset <CODE>`, or use `-b radix`.
- Monorepo mode (`--monorepo`) scaffolds a whole new repo (apps/web + packages/ui `@workspace/ui` + turbo). Use it only for a fresh repo. Adapting it to an existing one requires two `components.json` files with identical style/iconLibrary/baseColor. It is not worth the complexity here.
- Sonner: add `<Toaster />` in the root layout. It uses `next-themes`, so add a `ThemeProvider` (class attribute) for light/dark.
- **Biome vs shadcn code:** `biome check` on the generated components reports about 32 errors. Most are formatting/semicolon issues fixed by `--write`. What remains after that: `noArrayIndexKey` and `noDangerouslySetInnerHtml` (chart.tsx), and `useSemanticElements`/`useKeyWithClickEvents` (input-group.tsx). Exclude `components/ui/**` from the linter (or turn those rules off in an override), and format those files, or also exclude them from the formatter to keep `shadcn add --overwrite` diffs clean.

## 4. Biome 2.5

Source: `bunx @biomejs/biome init --help` (flag: `--jsonc` only); https://biomejs.dev/guides/big-projects/ ; https://biomejs.dev/reference/configuration/

```bash
bun add -d -E @biomejs/biome@2.5.14   # at root
bunx biome init                       # writes biome.json at root
```
Monorepo model (v2): one root config (`"root": true`, which is the default) and nested configs that use `"extends": "//"` (this implies `root: false`). Nested configs are optional. Suggested root `biome.json`:
```jsonc
{
  "$schema": "https://biomejs.dev/schemas/2.5.14/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "ignoreUnknown": true,
    "includes": ["**", "!**/node_modules", "!**/.next", "!**/dist", "!**/.turbo",
                 "!anchor/target", "!**/generated/**", "!packages/db/drizzle/**", "!**/next-env.d.ts",
                 "!e2e/playwright-report", "!e2e/test-results"] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "css": { "parser": { "tailwindDirectives": true } },
  "linter": { "enabled": true, "rules": { "recommended": true, "suspicious": { "noExplicitAny": "error" } } },
  "assist": { "actions": { "source": { "organizeImports": "on" } } },
  "overrides": [
    { "includes": ["apps/web/**"], "linter": { "domains": { "next": "recommended", "react": "recommended" } } },
    { "includes": ["apps/web/components/ui/**"], "linter": { "enabled": false } }
  ]
}
```
- `!**/generated/**` covers the Codama client (`packages/sdk/src/generated`). Negated `includes` patterns replace v1's `ignore`.
- Domains: `next`, `react`, `test`, `solid`, `vue`, `qwik`, `project`. Values: `recommended|all|none`.
- Scripts: root `"lint": "biome check ."`, `"format": "biome check --write ."`. Keep per-package `lint` scripts only if Turbo caching of lint matters. A single root Biome run is faster and simpler.

## 5. Drizzle (postgres.js)

Sources: https://orm.drizzle.team/docs/get-started/postgresql-new , /docs/get-started-postgresql (postgres.js section), /docs/drizzle-config-file , /docs/migrations ; `bunx drizzle-kit --help`.
- **There is no init command.** drizzle-kit commands: `generate, migrate, introspect(pull), push, studio, up, check, drop, export`. `drizzle.config.ts` is written by hand following the docs (log this as an exception in DECISIONS).
- Versions: the docs pages now default to `drizzle-orm@rc drizzle-kit@rc` (1.0.0-rc.4). npm `latest` is still 0.45.3 / 0.31.11. **Recommendation: use stable `latest`** (0.45/0.31) and pin with `-E`. Note that 1.0 changes the migration folder layout and relational queries v2, so upgrade deliberately later.

```bash
bun add --cwd packages/db drizzle-orm postgres
bun add --cwd packages/db -d drizzle-kit
```
```ts
// packages/db/drizzle.config.ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL! },   // load root .env first (Bun auto-loads .env only from cwd)
  strict: true, verbose: true,
});
```
```ts
// packages/db/src/client.ts
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";
const client = postgres(process.env.DATABASE_URL!, { max: 10 });
export const db = drizzle({ client, schema });
// migrate programmatically:
import { migrate } from "drizzle-orm/postgres-js/migrator";
await migrate(db, { migrationsFolder: "./drizzle" });
```
Commands (package scripts in packages/db): `"db:generate": "drizzle-kit generate"`, `"db:migrate": "drizzle-kit migrate"`, `"db:push": "drizzle-kit push"`, `"db:studio": "drizzle-kit studio"`. Run them with `bun run --cwd packages/db db:generate` or via turbo. The docs show `bunx drizzle-kit generate --config=...`.
- Gotchas: Bun auto-loads `.env` from the **cwd**, not the repo root. Use `bun --env-file=../../.env drizzle-kit ...` or a small loader in config. Do not use `bun:sql` in code that Next imports (CLAUDE.md rule), so keep `postgres`. postgres.js in Next dev: cache the client on `globalThis` to avoid too many connections during HMR.

## 6. Playwright

Source: `bunx create-playwright@latest --help` (checked by running it); https://playwright.dev/docs/intro ; https://playwright.dev/docs/chrome-extensions

Flags: `--browser <list>`, `--no-browsers`, `--no-examples`, `--install-deps`, `--next`, `--beta`, `--ct`, `--quiet`, `--gha`, `--lang js|TypeScript`, `[rootDir]`.
```bash
bun create playwright e2e --quiet --browser=chromium --lang=TypeScript --no-examples --gha=false
# or: bunx create-playwright@latest e2e --quiet --browser=chromium --lang=TypeScript --no-examples
bunx playwright install chromium   # add --with-deps only on Linux CI
```
- **Big gotcha:** create-playwright does **not support bun**. It detects only yarn/pnpm from `npm_config_user_agent` and otherwise uses **npm** (I confirmed it wrote `package-lock.json` even when launched with `bunx` or `bun create`). Workaround: run it, then `rm e2e/package-lock.json && rm -rf e2e/node_modules && bun install` at the root. Record this in DECISIONS as the fallback (it violates "no npm" indirectly). Alternatively use `--no-browsers` and install browsers with `bunx playwright install chromium`.
- With `--no-examples` it still writes `playwright.config.ts` (chromium project only, other projects commented out), the `.gitignore` entries and devDeps `@playwright/test ^1.63`, `@types/node`. Set `testDir: "./tests"`, `baseURL: "http://localhost:3000"`, `webServer: { command: "bun run --cwd ../apps/web start", url: "http://localhost:3000", reuseExistingServer: !process.env.CI }`.
- Running: `bunx playwright test`. The CLI has a node shebang, so it runs under Node, which is the officially supported runtime. Don't use `bun test` for these files.
- `bun init` (if used to create e2e/packages first) now writes a **CLAUDE.md** with Bun guidance plus `index.ts`, and pulls in TS ^7. Delete those files or pass flags accordingly.
- Extensions: supported **only in Chromium with `launchPersistentContext`**, with `channel: 'chromium'` for headless, args `--disable-extensions-except=<path> --load-extension=<path>`. Chrome and Edge removed side-loading flags, so use Playwright's bundled Chromium. Wallet (Phantom) e2e is technically possible but needs an unpacked extension. Not required: use a test wallet stub or Wallet Standard mock instead.

## 7. MCP TypeScript SDK

Sources: https://github.com/modelcontextprotocol/typescript-sdk (README on main), docs `docs/{get-started/packages,serving/stdio,serving/web-standard,serving/http,serving/legacy-clients,servers/tools,servers/resources,testing,get-started/real-host}.md`, https://ts.sdk.modelcontextprotocol.io/v2/ ; Inspector README.

- **Recommended now: v2 split packages `@modelcontextprotocol/server` + `@modelcontextprotocol/client` 2.1.0.** The README says: "v2 is the stable release line, released alongside the 2026-07-28 spec". `@modelcontextprotocol/sdk` 1.x is legacy and maintenance-only.
- Schemas: Standard Schema (Zod v4, Valibot, ArkType). `server` depends on `zod ^4.2`. The docs import `* as z from 'zod/v4'`, and plain `'zod'` (v4) also works. `inputSchema` takes a **`z.object(...)`**, not the v1 raw shape.
- Runs on Node, Bun and Deno. I verified it under Bun 1.3.14 with an in-process client (tools, structuredContent and resources all work).

```bash
bun add --cwd apps/mcp @modelcontextprotocol/server zod
bun add --cwd apps/mcp -d @modelcontextprotocol/client   # tests
```
```ts
// apps/mcp/src/server.ts — one factory for both transports
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
export function createServer() {
  const s = new McpServer({ name: "stocklana", version: "0.1.0" });
  s.registerTool("get_index", {
    description: "Get an index by id",
    inputSchema: z.object({ indexId: z.string() }),
    outputSchema: z.object({ name: z.string(), nav: z.number() }),
    annotations: { readOnlyHint: true },
  }, async ({ indexId }) => {
    const r = { name: "X", nav: 1 };
    return { content: [{ type: "text", text: JSON.stringify(r) }], structuredContent: r };
  });
  s.registerResource("index", new ResourceTemplate("stocklana://index/{id}", { list: undefined }),
    { mimeType: "application/json" }, async (uri, { id }) => ({ contents: [{ uri: uri.href, text: JSON.stringify({ id }) }] }));
  return s;
}
// apps/mcp/src/stdio.ts
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server";
const h = serveStdio(createServer);            // replaces v1 StdioServerTransport + connect
console.error("stocklana MCP on stdio");       // NEVER console.log (stdout = JSON-RPC)
process.on("SIGINT", () => void h.close());
// apps/mcp/src/http.ts (Streamable HTTP, web-standard fetch handler)
import { createMcpHandler, hostHeaderValidationResponse, localhostAllowedHostnames } from "@modelcontextprotocol/server";
const handler = createMcpHandler(createServer);   // stateless per request; legacy 2025 clients served by default
Bun.serve({ port: 3001, hostname: "127.0.0.1",
  fetch: (req) => hostHeaderValidationResponse(req, localhostAllowedHostnames()) ?? handler.fetch(req) });
```
- **Gotcha:** don't pass `handler.fetch` directly as Bun's `fetch`, because Bun calls `fetch(req, server)` and the second argument of `handler.fetch` is `{ authInfo }`. Wrap it as shown. `createMcpHandler` does no Host/Origin validation on bare runtimes, so add the guard above (DNS rebinding). I verified that a 2025-06-18 `initialize` POST to Bun.serve returns 200 with an SSE `message` event.
- Legacy: `createMcpHandler(f, { legacy: 'stateless' | 'reject' })`, default stateless. `serveStdio` defaults to `'serve'`. The v2 server has no SSE transport (only `@modelcontextprotocol/server-legacy/sse`). Current Claude clients still speak 2025 revisions, so keep the defaults.
- Testing (no socket):
```ts
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
const handler = createMcpHandler(createServer);
const t = new StreamableHTTPClientTransport(new URL("http://test.local/mcp"), { fetch: (u, i) => handler.fetch(new Request(u, i)) });
const c = new Client({ name: "test", version: "1" }, { versionNegotiation: { mode: "auto" } });
await c.connect(t); await c.callTool({ name: "get_index", arguments: { indexId: "a" } });
await c.close(); await handler.close();
```
  Also: `InMemoryTransport.createLinkedPair()` (2025-era only), and `StdioClientTransport` from `@modelcontextprotocol/client/stdio` to spawn `bun src/stdio.ts`. Minor: under `@types/bun`, `new Request(u, i)` in the fetch shim fails a type check (overload on `string|URL`). Cast it or use `new Request(u.toString(), i)`. It works at runtime.
- Inspector v2 (2.7.0, Node >= 22.19): `bunx @modelcontextprotocol/inspector bun apps/mcp/src/stdio.ts` (web UI). CLI: `bunx @modelcontextprotocol/inspector --cli bun apps/mcp/src/stdio.ts --method tools/list`, `--method tools/call --tool-name get_index --tool-arg indexId=a`. HTTP: `--cli http://127.0.0.1:3001/mcp --method tools/list` (the transport is auto-detected from `/mcp`), and there is also `--tui`. v1 is available as `@modelcontextprotocol/inspector@v1-latest`.
- Host configs:
  - Claude Code stdio: `claude mcp add stocklana -- bun /abs/path/apps/mcp/src/stdio.ts` (add `-e KEY=VAL` for env; `--scope project` writes `.mcp.json`).
  - Claude Code HTTP: `claude mcp add --transport http stocklana http://127.0.0.1:3001/mcp`.
  - `.mcp.json`: `{"mcpServers":{"stocklana":{"type":"stdio","command":"bun","args":["apps/mcp/src/stdio.ts"]}}}` or `{"type":"http","url":"http://127.0.0.1:3001/mcp"}`.
  - Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`): `{"mcpServers":{"stocklana":{"command":"/abs/path/bun","args":["/abs/path/apps/mcp/src/stdio.ts"]}}}`. Use absolute paths, because Desktop has no shell PATH. Desktop adds remote HTTP servers through Settings → Connectors (custom connector URL), not this JSON. For a localhost HTTP server, the common bridge is `npx mcp-remote http://127.0.0.1:3001/mcp` as a stdio command. These host snippets are from my general knowledge of the hosts plus the SDK's real-host guide; re-check the Claude Code docs when writing DEMO.md.

## 8. TanStack Query v5 + Next App Router; Geist

Source: https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr (raw md on GitHub main)
```bash
bun add --cwd apps/web @tanstack/react-query && bun add --cwd apps/web -d @tanstack/react-query-devtools
```
```tsx
// apps/web/lib/query-client.ts
import { QueryClient, defaultShouldDehydrateQuery, environmentManager } from "@tanstack/react-query";
function make() { return new QueryClient({ defaultOptions: {
  queries: { staleTime: 60_000 },
  dehydrate: { shouldDehydrateQuery: q => defaultShouldDehydrateQuery(q) || q.state.status === "pending", shouldRedactErrors: () => false } } }); }
let browser: QueryClient | undefined;
export function getQueryClient() { if (environmentManager.isServer()) return make(); return (browser ??= make()); }
// apps/web/app/providers.tsx
"use client";
import { QueryClientProvider } from "@tanstack/react-query";
export function Providers({ children }: { children: React.ReactNode }) {
  const qc = getQueryClient(); return <QueryClientProvider client={qc}>{children}</QueryClientProvider>; }
```
- The docs now use `environmentManager.isServer()`, which exists in 5.103.2. The older `isServer` export is still present. Don't create the client with `useState` in a provider that sits above a suspense boundary; follow the pattern above. Server prefetch works with `HydrationBoundary` + `dehydrate(qc)`.
- Geist: create-next-app already wires `Geist`/`Geist_Mono` from `next/font/google` (CSS vars `--font-geist-sans`/`--font-geist-mono`). shadcn init rewrites `@theme` to `--font-sans: var(--font-sans)`, so point the font `variable` at `--font-sans`/`--font-mono`. The `geist` package (1.7.2: `import { GeistSans } from "geist/font/sans"`, `GeistMono` from `geist/font/mono`) is an alternative that works offline at build time, since `next/font/google` downloads at build. Pick one; keeping the create-next-app default is simplest. For tabular numbers use the Tailwind `tabular-nums` class.

## 9. Docker compose Postgres

Source: https://hub.docker.com/_/postgres (docs repo `postgres/content.md`)
```yaml
services:
  postgres:
    image: postgres:18.6-alpine          # 18-alpine; 19 only beta
    environment: { POSTGRES_USER: stocklana, POSTGRES_PASSWORD: stocklana, POSTGRES_DB: stocklana }
    ports: ["5434:5432"]
    volumes: ["pgdata:/var/lib/postgresql"]   # PG18+: mount the parent dir, NOT /var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 2s
      timeout: 3s
      retries: 30
volumes: { pgdata: {} }
```
- PG 18 changed `PGDATA` to `/var/lib/postgresql/18/docker`, and the VOLUME is now `/var/lib/postgresql`. Mounting `/var/lib/postgresql/data` (the old habit) makes 18 fail or not persist.
- Wait for readiness with `docker compose up -d --wait`. `DATABASE_URL=postgres://stocklana:stocklana@localhost:5434/stocklana`.

## 10. Zod 4

Source: https://zod.dev (library-authors / versioning pages)
- `zod@4.6.5`. `import { z } from "zod"` or `import * as z from "zod"` gives Zod 4 Classic. `"zod/v4"` is a permanent alias to v4 and is what the MCP docs use. `"zod/mini"` is the tree-shakable variant, `"zod/v4/core"` is for library authors, and `"zod/v3"` is legacy.
- Use one zod version repo-wide (root catalog or the same range everywhere). The MCP server requires `^4.2`.
- Z4 API differences to keep in mind: `z.email()`/`z.url()` top-level formats, `error` replaces `message`/`errorMap`, `z.record` requires 2 args, `.strict()` → `z.strictObject`. For env validation: `z.object({...}).parse(process.env)`, and `z.stringbool()` for boolean env values.

---

## Risks / decisions to log
1. create-playwright installs with npm and cannot use Bun. Workaround: delete the lockfile and run `bun install`.
2. TS 7 is now npm `latest` and generators disagree (TS 7 vs `^5`). Pin one version (TS 5.9.x is safest with the Next plugin).
3. Bun 1.4.2 is written by generators but 1.3.14 is installed. Fix `devEngines`/`packageManager`, or upgrade bun.
4. shadcn 4 defaults to Base UI (`base-nova`), the `cn` package and a `shadcn` runtime dep. There is no `--base-color` flag, neutral is the default, and the choice is irreversible.
5. The Biome recommended rules flag generated shadcn code. Exclude `components/ui/**` and generated folders.
6. The Drizzle docs push 1.0 RC. Use 0.45 stable, which has no init command, so `drizzle.config.ts` is written by hand.
7. MCP: v2 is stable. Wrap `handler.fetch` under Bun.serve and add Host validation.
8. `next dev` writes AGENTS.md/CLAUDE.md into apps/web. Set `agentRules: false`.
9. The PG18 volume path changed.
10. The create-turbo `with-biome` template has an invalid `"@repo/biome-config": "^"` range.
