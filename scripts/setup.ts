/**
 * bun run setup — idempotent first-time setup (PLAN §7.9).
 * Never touches the global Solana config; keys live in .keys/ (gitignored).
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { log, run, tryOutput } from "./lib/proc";
import { KEYS_DIR, ROOT, SOLANA_BIN, SOLANA_CLI_CONFIG, SOLANA_VERSION } from "./lib/toolchain";

const S = "setup";
const skipBrowsers = process.argv.includes("--skip-browsers");

interface Prereq {
  name: string;
  cmd: string[];
  expect?: RegExp;
  install: string;
}

const prereqs: Prereq[] = [
  {
    name: "bun",
    cmd: ["bun", "--version"],
    expect: /^1\.(4|[5-9])/,
    install: "curl -fsSL https://bun.sh/install | bash",
  },
  { name: "rustc", cmd: ["rustc", "--version"], install: "https://rustup.rs" },
  {
    name: "solana (Agave)",
    cmd: ["solana", "--version"],
    expect: new RegExp(`solana-cli ${SOLANA_VERSION.replaceAll(".", "\\.")}`),
    install: `agave-install init ${SOLANA_VERSION}  (installs into ${SOLANA_BIN})`,
  },
  {
    name: "anchor",
    cmd: ["anchor", "--version"],
    expect: /anchor-cli 1\.2\./,
    install: "avm install 1.2.0 && avm use 1.2.0",
  },
  {
    name: "surfpool",
    cmd: ["surfpool", "--version"],
    expect: /surfpool 1\.(6|[7-9])/,
    install: "surfpool update (or https://surfpool.run)",
  },
  {
    name: "docker",
    cmd: ["docker", "info", "--format", "{{.ServerVersion}}"],
    install: "Install Docker Desktop or OrbStack and start it",
  },
];

async function checkPrereqs(): Promise<void> {
  const missing: string[] = [];
  for (const p of prereqs) {
    const out = await tryOutput(p.cmd);
    if (!out || (p.expect && !p.expect.test(out))) {
      missing.push(`  - ${p.name}: found "${out ?? "not installed"}". Install: ${p.install}`);
    } else {
      log(S, `ok  ${p.name}: ${out.split("\n")[0]}`);
    }
  }
  if (missing.length) {
    console.error(`[${S}] Missing prerequisites:\n${missing.join("\n")}`);
    process.exit(1);
  }
}

async function ensureKeys(): Promise<void> {
  if (!existsSync(KEYS_DIR)) mkdirSync(KEYS_DIR, { mode: 0o700 });
  for (const name of ["admin", "keeper", "agent"]) {
    const file = path.join(KEYS_DIR, `${name}.json`);
    if (existsSync(file)) continue;
    await run(["solana-keygen", "new", "--no-bip39-passphrase", "--silent", "-o", file], {
      capture: true,
    });
    chmodSync(file, 0o600);
    log(S, `created .keys/${name}.json`);
  }
  if (!existsSync(SOLANA_CLI_CONFIG)) {
    await run(
      [
        "solana",
        "config",
        "set",
        "--config",
        SOLANA_CLI_CONFIG,
        "--url",
        "localhost",
        "--keypair",
        path.join(KEYS_DIR, "admin.json"),
        "--commitment",
        "confirmed",
      ],
      { capture: true },
    );
    log(S, "created .keys/solana-cli.yml (project-local Solana CLI config)");
  }
}

function parseEnv(text: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const line of text.split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match?.[1]) m.set(match[1], (match[2] ?? "").replace(/\s+#.*$/, "").trim());
  }
  return m;
}

/** Create .env from .env.example; import API keys from .env.test when present (D010). */
function ensureEnv(): void {
  const envPath = path.join(ROOT, ".env");
  if (existsSync(envPath)) {
    log(S, ".env exists (kept)");
    return;
  }
  let text = readFileSync(path.join(ROOT, ".env.example"), "utf8");
  const extraPath = path.join(ROOT, ".env.test");
  if (existsSync(extraPath)) {
    const extra = parseEnv(readFileSync(extraPath, "utf8"));
    const set = (key: string, value: string | undefined) => {
      if (!value) return;
      text = text.replace(new RegExp(`^${key}=.*$`, "m"), `${key}=${value}`);
    };
    set("JUPITER_API_KEY", extra.get("JUPITER_API_KEY"));
    set("FINNHUB_API_KEY", extra.get("FINNHUB_API_KEY"));
    const helius = extra.get("HELIUS_RPC_URL");
    if (helius?.includes("helius-rpc.com")) {
      set("MAINNET_READ_RPC_URL", helius);
      set("DEVNET_RPC_URL", helius.replace("mainnet.helius-rpc.com", "devnet.helius-rpc.com"));
    }
    if (extra.get("JUPITER_API_KEY")) set("PRICE_MODE", "live");
    log(S, "imported API keys from .env.test (values not printed)");
  }
  writeFileSync(envPath, text, { mode: 0o600 });
  log(S, "created .env");
}

async function ensureDatabase(): Promise<void> {
  await run(["docker", "compose", "up", "-d", "--wait"]);
  for (const name of ["app_test", "app_devnet"]) {
    const exists = await tryOutput([
      "docker",
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "postgres",
      "-tAc",
      `SELECT 1 FROM pg_database WHERE datname='${name}'`,
    ]);
    if (exists !== "1") {
      await run(
        [
          "docker",
          "compose",
          "exec",
          "-T",
          "postgres",
          "psql",
          "-U",
          "postgres",
          "-c",
          `CREATE DATABASE ${name}`,
        ],
        {
          capture: true,
        },
      );
      log(S, `created database ${name}`);
    }
  }
  if (existsSync(path.join(ROOT, "packages/db/drizzle"))) {
    await run(["bun", "run", "--cwd", "packages/db", "db:migrate"]);
    for (const name of ["app_test", "app_devnet"]) {
      await run(["bun", "run", "--cwd", "packages/db", "db:migrate"], {
        env: { DATABASE_URL: `postgres://postgres:postgres@localhost:5434/${name}` },
      });
    }
    log(S, "migrations applied (app, app_test, app_devnet)");
  }
}

async function main(): Promise<void> {
  await checkPrereqs();
  await run(["bun", "install"]);
  if (!skipBrowsers)
    await run(["bunx", "playwright", "install", "chromium"], { cwd: path.join(ROOT, "e2e") });
  await ensureKeys();
  ensureEnv();
  await ensureDatabase();
  log(S, "done. Next: bun run dev");
}

await main();
