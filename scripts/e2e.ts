/**
 * bun run e2e [-- --fresh] [-- <playwright args>]
 *
 * Runs the Playwright suite (e2e/tests) against the localnet stack.
 * - Stack already running (web + MCP + RPC reachable): reuse it.
 * - Otherwise (or --fresh on free ports): start `bun scripts/dev.ts --ci`
 *   (fresh chain, production web build), seed demo data, test, then stop it.
 * bun run e2e:visual  → only the visual review screenshots (e2e/visual/).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { log, run } from "./lib/proc";
import { ROOT, toolchainEnv } from "./lib/toolchain";

const S = "e2e";
const WEB = process.env.WEB_URL || "http://localhost:3000";
const MCP = `http://127.0.0.1:${process.env.MCP_HTTP_PORT || 3333}/health`;
const RPC = process.env.RPC_URL || "http://127.0.0.1:8899";
const args = process.argv.slice(2).filter((a) => a !== "--");
const fresh = args.includes("--fresh");
const visual = args.includes("--visual");
const pwArgs = args.filter((a) => a !== "--fresh" && a !== "--visual");

async function up(url: string, init?: RequestInit): Promise<boolean> {
  try {
    const r = await fetch(url, { ...init, signal: AbortSignal.timeout(3_000) });
    return r.ok;
  } catch {
    return false;
  }
}
const rpcUp = () =>
  up(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"jsonrpc":"2.0","id":1,"method":"getHealth"}',
  });
async function stackUp(): Promise<boolean> {
  const [w, m, r] = await Promise.all([up(`${WEB}/api/config`), up(MCP), rpcUp()]);
  return w && m && r;
}

let dev: ReturnType<typeof Bun.spawn> | null = null;
async function stop(): Promise<void> {
  if (!dev) return;
  log(S, "stopping stack");
  dev.kill("SIGTERM");
  await Promise.race([dev.exited, Bun.sleep(20_000)]);
  dev = null;
}
process.on("SIGINT", () => void stop().then(() => process.exit(130)));

let code = 1;
try {
  const full = await stackUp();
  if (full && !fresh) {
    log(S, "reusing the running stack");
  } else {
    const any = await Promise.all([up(`${WEB}/api/config`), up(MCP), rpcUp()]);
    if (any.some(Boolean))
      throw new Error(
        fresh
          ? "--fresh needs free ports: stop the running stack first"
          : "part of the stack is running (web/MCP/RPC); stop it or start everything with `bun run dev`",
      );
    log(S, "starting a fresh localnet stack (bun scripts/dev.ts --ci)");
    const dir = path.join(ROOT, "e2e/.stack");
    mkdirSync(dir, { recursive: true });
    const out = Bun.file(path.join(dir, "dev.log"));
    dev = Bun.spawn(["bun", "scripts/dev.ts", "--ci"], {
      cwd: ROOT,
      env: toolchainEnv(),
      stdout: out,
      stderr: out,
      stdin: "ignore",
    });
    const until = Date.now() + 15 * 60_000;
    while (!(await stackUp())) {
      if (dev.exitCode !== null) throw new Error("stack exited early — see e2e/.stack/dev.log");
      if (Date.now() > until)
        throw new Error("stack not ready after 15 min — see e2e/.stack/dev.log");
      await Bun.sleep(3_000);
    }
    log(S, "stack ready; seeding demo data");
    await run(["bun", "scripts/seed.ts"]);
  }
  if (!visual) {
    log(S, "MCP integration tests");
    const m = await run(["bun", "test"], { cwd: path.join(ROOT, "apps/mcp"), allowFail: true });
    if (m.code !== 0) throw new Error("MCP tests failed");
  }
  const target = visual ? ["tests/visual.spec.ts"] : [];
  const r = await run(["bunx", "playwright", "test", ...target, ...pwArgs], {
    cwd: path.join(ROOT, "e2e"),
    env: visual ? { E2E_VISUAL: "1" } : {},
    allowFail: true,
  });
  code = r.code;
} catch (e) {
  console.error(`[${S}]`, e instanceof Error ? e.message : e);
} finally {
  await stop();
}
log(S, code === 0 ? "PASS" : "FAIL");
process.exit(code);
