/**
 * bun run dev — one command for the whole local stack (PLAN §7.9).
 *
 *   bun run dev                 localnet: Postgres + Surfpool (offline) + deploy + bootstrap + worker + web + MCP
 *   bun run dev -- --ci         same, non-interactive (used by verify); web runs `next start` after a build
 *   bun run dev:devnet          worker + web + MCP on this machine pointed at devnet (no validator)
 *   flags: --no-web --no-worker --no-mcp --chain-only
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { writeShocks } from "@repo/config/node";
import type { Subprocess } from "bun";
import { chainCtx, clusterFromArgs, ensureSol, rpcUrlFor, waitForRpc } from "./lib/chain";
import { resetChainTables } from "./lib/db-reset";
import { log, run } from "./lib/proc";
import { ANCHOR_DIR, ROOT, toolchainEnv } from "./lib/toolchain";

const S = "dev";
const has = (f: string) => process.argv.includes(`--${f}`);
const ci = has("ci");
const cluster = clusterFromArgs();
const chainOnly = has("chain-only");
const children: { name: string; proc: Subprocess }[] = [];
let shuttingDown = false;

const COLORS = ["\x1b[36m", "\x1b[35m", "\x1b[33m", "\x1b[32m", "\x1b[34m", "\x1b[31m"];

async function pipeLines(name: string, color: string, stream: ReadableStream<Uint8Array> | null) {
  if (!stream) return;
  const decoder = new TextDecoder();
  let buf = "";
  for await (const chunk of stream) {
    buf += decoder.decode(chunk, { stream: true });
    let i = buf.indexOf("\n");
    while (i >= 0) {
      console.log(`${color}[${name}]\x1b[0m ${buf.slice(0, i)}`);
      buf = buf.slice(i + 1);
      i = buf.indexOf("\n");
    }
  }
  if (buf) console.log(`${color}[${name}]\x1b[0m ${buf}`);
}

function start(
  name: string,
  cmd: string[],
  opts: { cwd?: string; env?: Record<string, string> } = {},
): Subprocess {
  const color = COLORS[children.length % COLORS.length] ?? "";
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd ?? ROOT,
    env: toolchainEnv(opts.env),
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  children.push({ name, proc });
  void pipeLines(name, color, proc.stdout);
  void pipeLines(name, color, proc.stderr);
  void proc.exited.then((code) => {
    if (!shuttingDown) {
      log(S, `${name} exited with code ${code}`);
      if (ci) void shutdown(1);
    }
  });
  return proc;
}

async function shutdown(code = 0): Promise<never> {
  if (shuttingDown) process.exit(code);
  shuttingDown = true;
  log(S, "shutting down…");
  for (const c of [...children].reverse()) c.proc.kill("SIGTERM");
  await Promise.race([Promise.all(children.map((c) => c.proc.exited)), Bun.sleep(8000)]);
  for (const c of children) if (c.proc.exitCode === null) c.proc.kill("SIGKILL");
  process.exit(code);
}

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

async function waitHttp(url: string, name: string, timeoutMs = 180_000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.status < 500) {
        log(S, `${name} ready at ${url}`);
        return;
      }
    } catch {
      // not up yet
    }
    await Bun.sleep(1000);
  }
  throw new Error(`${name} not ready at ${url}`);
}

async function rpcHealthy(url: string): Promise<boolean> {
  try {
    await waitForRpc(url, 1500);
    return true;
  } catch {
    return false;
  }
}

async function deployPrograms(rpcUrl: string): Promise<void> {
  for (const p of ["mock_market", "index_vault"]) {
    if (!existsSync(path.join(ANCHOR_DIR, `target/deploy/${p}.so`))) {
      await run(["anchor", "build"], { cwd: ANCHOR_DIR });
      break;
    }
  }
  for (const p of ["mock_market", "index_vault"]) {
    log(S, `deploying ${p}`);
    await run(
      [
        "anchor",
        "program",
        "deploy",
        "-p",
        p,
        "--provider.cluster",
        rpcUrl,
        "--provider.wallet",
        path.join(ROOT, process.env.ADMIN_KEYPAIR_PATH || ".keys/admin.json"),
        "--program-keypair",
        path.join(ANCHOR_DIR, `keys/${p}-keypair.json`),
      ],
      { cwd: ANCHOR_DIR, capture: true },
    );
  }
}

function devnetDbUrl(): string {
  const u = new URL(process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5434/app");
  u.pathname = "/app_devnet";
  return u.toString();
}

function appEnv(): Record<string, string> {
  if (cluster === "localnet") return {};
  const { rpcUrl, wsUrl } = rpcUrlFor("devnet");
  return {
    CLUSTER: "devnet",
    RPC_URL: rpcUrl,
    WS_URL: wsUrl,
    NEXT_PUBLIC_CLUSTER: "devnet",
    NEXT_PUBLIC_RPC_URL: rpcUrl,
    NEXT_PUBLIC_WS_URL: wsUrl,
    // Gentler polling: public/free devnet RPCs are rate-limited (429).
    PRICE_INTERVAL: process.env.DEVNET_PRICE_INTERVAL || "30",
    INDEXER_INTERVAL: "6",
    RESYNC_INTERVAL: "300",
    SNAPSHOT_INTERVAL: "120",
    KEEPER_INTERVAL: "60",
    FOLLOW_INTERVAL: "60",
    DATABASE_URL: devnetDbUrl(),
  };
}

async function main(): Promise<void> {
  await run(["docker", "compose", "up", "-d", "--wait"], { capture: true });
  log(S, "postgres ready (5434)");
  // Apply pending migrations (idempotent) so new tables exist without re-running setup.
  await run(["bun", "run", "--cwd", "packages/db", "db:migrate"], {
    capture: true,
    env: cluster === "devnet" ? { DATABASE_URL: devnetDbUrl() } : {},
  });

  if (cluster === "localnet") {
    const { rpcUrl } = rpcUrlFor("localnet");
    let fresh = false;
    if (await rpcHealthy(rpcUrl)) {
      log(S, `reusing validator at ${rpcUrl}`);
    } else {
      start(
        "surfpool",
        [
          "surfpool",
          "start",
          "--offline",
          "--no-deploy",
          "--no-tui",
          "--port",
          "8899",
          "--ws-port",
          "8900",
        ],
        {
          cwd: ROOT,
        },
      );
      await waitForRpc(rpcUrl, 90_000);
      fresh = true;
      log(S, "surfpool ready (8899/8900)");
    }
    const deployed = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getAccountInfo",
        params: ["4XaBXM6jZKj3mrQcezjA74ydDEBwiq1amzDtY7ZMc6me", { encoding: "base64" }],
      }),
    }).then((r) => r.json() as Promise<{ result?: { value: unknown } }>);
    if (fresh || !deployed.result?.value) {
      const c = await chainCtx("localnet");
      await ensureSol(c, c.admin.address, 50);
      await deployPrograms(rpcUrl);
      await resetChainTables();
      writeShocks("localnet", {});
    }
    await run(["bun", "scripts/bootstrap.ts", "--cluster", "localnet"]);
  } else if (!existsSync(path.join(ROOT, "packages/config/deployments/devnet.json"))) {
    throw new Error(
      "packages/config/deployments/devnet.json missing — run `bun run deploy:devnet` first",
    );
  }

  if (chainOnly) {
    log(S, "chain ready (--chain-only)");
    if (ci) return void (await shutdown(0));
  }

  const env = appEnv();
  if (!chainOnly && !has("no-worker") && existsSync(path.join(ROOT, "apps/worker/src/main.ts"))) {
    start("worker", ["bun", "run", "src/main.ts"], { cwd: path.join(ROOT, "apps/worker"), env });
  }
  if (!chainOnly && !has("no-mcp") && existsSync(path.join(ROOT, "apps/mcp/src/http.ts"))) {
    start("mcp", ["bun", "run", "src/http.ts"], { cwd: path.join(ROOT, "apps/mcp"), env });
    await waitHttp(`http://127.0.0.1:${process.env.MCP_HTTP_PORT || 3333}/health`, "mcp");
  }
  if (!chainOnly && !has("no-web")) {
    const webDir = path.join(ROOT, "apps/web");
    if (ci) {
      await run(["bun", "run", "build"], { cwd: webDir, env });
      start("web", ["bun", "run", "start"], { cwd: webDir, env });
    } else {
      start("web", ["bun", "run", "dev"], { cwd: webDir, env });
    }
    await waitHttp(process.env.WEB_URL || "http://localhost:3000", "web");
  }
  log(S, `READY (${cluster}). Ctrl+C to stop.`);
}

main().catch(async (e) => {
  console.error(`[${S}]`, e instanceof Error ? e.message : e);
  await shutdown(1);
});
