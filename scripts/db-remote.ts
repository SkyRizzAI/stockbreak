/**
 * bun run db:remote -- <migrate|copy|check> [--url <postgres url>] [--from app_devnet] [--force]
 *
 * Hosted Postgres (Neon) for the public devnet demo (docs/DEPLOY.md, D038).
 * The target URL comes from --url or DEVNET_DATABASE_URL and is never printed.
 *
 *   migrate  apply packages/db/drizzle migrations (drizzle migrator, same table as drizzle-kit)
 *   copy     copy the local devnet database (docker, default app_devnet) into the target
 *            with pg_dump/pg_restore run inside the postgres docker image, then migrate.
 *            Refuses a non-empty target unless --force (which drops and recreates the objects).
 *   check    print row counts of the main tables
 */
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDb, getDb } from "@repo/db";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { argValue } from "./lib/chain";
import { log, run } from "./lib/proc";
import { ROOT } from "./lib/toolchain";

const S = "db-remote";
const PG_IMAGE = "postgres:18.6-alpine"; // same image as docker-compose.yml
const COMMANDS = ["migrate", "copy", "check"];
// Only known words count as the command: a stray positional (e.g. a URL) must never be echoed.
const cmd = process.argv.slice(2).find((a) => COMMANDS.includes(a)) ?? "check";
const url = argValue("url") || process.env.DEVNET_DATABASE_URL || "";
const from = argValue("from") || "app_devnet";
const force = process.argv.includes("--force");

function describe(u: string): string {
  try {
    const p = new URL(u);
    return `${p.hostname}${p.pathname}`;
  } catch {
    return "(unparseable url)";
  }
}

let restoreCode = 0;

async function doMigrate(): Promise<void> {
  log(S, `migrating ${describe(url)}`);
  await migrate(getDb(url), { migrationsFolder: path.join(ROOT, "packages/db/drizzle") });
  log(S, "migrations applied");
}

async function tableCount(): Promise<number> {
  const r = await getDb(url).execute<{ n: number }>(
    sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`,
  );
  return r[0]?.n ?? 0;
}

async function doCheck(): Promise<void> {
  const db = getDb(url);
  const tables = ["indexes", "positions", "events", "users", "posts", "prices", "faucet_claims"];
  for (const t of tables) {
    const r = await db
      .execute<{ n: number }>(sql.raw(`select count(*)::int as n from ${t}`))
      .catch(() => null);
    log(S, `${t.padEnd(14)} ${r ? r[0]?.n : "missing"}`);
  }
}

/** libpq URL usable from inside a container (localhost → host.docker.internal). */
function containerUrl(u: string): string {
  const p = new URL(u);
  if (p.hostname === "localhost" || p.hostname === "127.0.0.1") p.hostname = "host.docker.internal";
  return p.toString();
}

async function doCopy(): Promise<void> {
  const existing = await tableCount();
  if (existing > 0 && !force)
    throw new Error(
      `target already has ${existing} tables — pass --force to overwrite them with the local copy`,
    );
  await run(["docker", "compose", "up", "-d", "--wait"], { capture: true });
  const dump = path.join(tmpdir(), `stocklana-${from}-${Date.now()}.dump`);
  try {
    log(S, `dumping local ${from}`);
    const d = Bun.spawn(
      ["docker", "compose", "exec", "-T", "postgres", "pg_dump", "-Fc", "-U", "postgres", from],
      { cwd: ROOT, stdout: Bun.file(dump), stderr: "inherit", stdin: "ignore" },
    );
    if ((await d.exited) !== 0) throw new Error(`pg_dump ${from} failed`);
    log(S, `restoring into ${describe(url)}`);
    const r = Bun.spawn(
      [
        "docker",
        "run",
        "--rm",
        "-i",
        "-e",
        "TARGET_URL",
        PG_IMAGE,
        "sh",
        "-c",
        `pg_restore --no-owner --no-acl ${force ? "--clean --if-exists " : ""}-d "$TARGET_URL"`,
      ],
      {
        cwd: ROOT,
        env: { ...process.env, TARGET_URL: containerUrl(url) },
        stdin: Bun.file(dump),
        stdout: "inherit",
        stderr: "inherit",
      },
    );
    restoreCode = await r.exited;
    if (restoreCode !== 0)
      log(S, `pg_restore exited ${restoreCode} (warnings above; checking the result anyway)`);
  } finally {
    rmSync(dump, { force: true });
  }
  await doMigrate();
  // A failed restore (auth, TLS, wrong host) must not pass as an empty "migrated" database.
  const [row] = await getDb(url).execute<{ n: string }>(
    sql`SELECT count(*)::text AS n FROM indexes`,
  );
  if (restoreCode !== 0 && Number(row?.n ?? 0) === 0)
    throw new Error(
      "restore failed: the target has no indexes after pg_restore (see errors above)",
    );
  await doCheck();
}

let code = 0;
try {
  if (!url) throw new Error("set DEVNET_DATABASE_URL (or pass --url) to the hosted Postgres URL");
  if (cmd === "migrate") await doMigrate();
  else if (cmd === "copy") await doCopy();
  else if (cmd === "check") await doCheck();
  else throw new Error("unknown command (migrate | copy | check)");
} catch (e) {
  console.error(`[${S}]`, e instanceof Error ? e.message : e);
  code = 1;
} finally {
  await closeDb(url).catch(() => {});
}
process.exit(code);
