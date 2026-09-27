/**
 * Database driver adapter (D051). Every query in packages/db is written once in the
 * SQLite dialect; only this file knows which engine runs it:
 * - Cloudflare Workers: D1 through the `DB` binding of the current request.
 * - Everywhere else (Bun/Node: dev, worker, MCP, scripts, tests): the runtime's built-in
 *   `node:sqlite` on a local file (`DATABASE_URL=file:.data/app.db`, relative to the repo
 *   root) or `:memory:`, through Drizzle's sqlite-proxy. No native package: nothing for
 *   bundlers (Next.js, OpenNext, wrangler) to trace.
 * Swapping the database means adding a branch here, not rewriting queries.
 */
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { drizzle as drizzleD1 } from "drizzle-orm/d1";
import { drizzle as drizzleProxy, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import { migrate } from "drizzle-orm/sqlite-proxy/migrator";
import * as schema from "./schema";

/**
 * The query API shared by both engines (async SQLite + `batch`). D1 instances are typed
 * as this too: queries never depend on engine-specific result shapes.
 */
export type Db = SqliteRemoteDatabase<typeof schema>;

// ---------------- Cloudflare D1 ----------------

interface CfScope {
  env?: { DB?: object };
  ctx?: object;
}
const onWorkers = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
/** Request scope exposed by OpenNext (web) and apps/worker/src/cf.ts (cron). */
const cfScope = (): CfScope | undefined =>
  (globalThis as unknown as Record<symbol, CfScope | undefined>)[
    Symbol.for("__cloudflare-context__")
  ];
const d1Dbs = new WeakMap<object, Db>();

function d1Db(): Db {
  const binding = cfScope()?.env?.DB;
  if (!binding) throw new Error("D1 binding `DB` is not available in this request");
  let db = d1Dbs.get(binding);
  if (!db) {
    db = drizzleD1(binding as Parameters<typeof drizzleD1>[0], { schema }) as unknown as Db;
    d1Dbs.set(binding, db);
  }
  return db;
}

// ---------------- local node:sqlite ----------------

interface Statement {
  run(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  setReturnArrays(on: boolean): void;
}
interface Connection {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}
type Method = "run" | "all" | "values" | "get";
interface Local {
  db: Db;
  conn: Connection;
}

const cache = globalThis as unknown as { __stocklanaDb?: Map<string, Local> };

/** Repo root: $REPO_ROOT, else the nearest ancestor of cwd holding packages/db. */
function repoRoot(): string {
  if (process.env.REPO_ROOT) return process.env.REPO_ROOT;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, "packages/db/package.json"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return process.cwd();
}

/** `file:` URLs are relative to the repo root (web, worker and scripts run in different cwds). */
export function resolveDbUrl(url: string): string {
  if (url === ":memory:" || !url.startsWith("file:")) return url;
  const p = url.slice("file:".length);
  const abs = path.isAbsolute(p) ? p : path.join(repoRoot(), p);
  mkdirSync(path.dirname(abs), { recursive: true });
  return `file:${abs}`;
}

function openLocal(url: string): Local {
  const resolved = resolveDbUrl(url);
  if (resolved !== ":memory:" && !resolved.startsWith("file:"))
    throw new Error("DATABASE_URL must be file:<path> or :memory: (SQLite, D051)");
  // Looked up at runtime so bundlers never see it (never reached on Workers).
  const sqlite = process.getBuiltinModule?.("node:sqlite") as
    | { DatabaseSync: new (path: string) => Connection }
    | undefined;
  if (!sqlite) throw new Error("node:sqlite is not available (Node ≥ 24 or Bun ≥ 1.4 required)");
  const conn = new sqlite.DatabaseSync(resolved === ":memory:" ? ":memory:" : resolved.slice(5));
  // Web, worker and MCP share the file: WAL + a busy timeout. Foreign keys as on D1.
  conn.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  const exec = (sql: string, params: unknown[], method: Method): { rows: unknown[] } => {
    const st = conn.prepare(sql);
    if (method === "run") {
      st.run(...params);
      return { rows: [] };
    }
    st.setReturnArrays(true);
    if (method === "get") return { rows: (st.get(...params) as unknown[] | undefined) ?? [] };
    return { rows: st.all(...params) };
  };
  const db = drizzleProxy(
    async (sql, params, method) => exec(sql, params, method),
    async (queries) => {
      conn.exec("BEGIN IMMEDIATE");
      try {
        const out = queries.map((q) => exec(q.sql, q.params, q.method));
        conn.exec("COMMIT");
        return out;
      } catch (e) {
        conn.exec("ROLLBACK");
        throw e;
      }
    },
    { schema },
  );
  return { db, conn };
}

/** One connection per URL (survives Next.js dev HMR); the request's D1 database on Workers. */
export function getDb(url = process.env.DATABASE_URL): Db {
  if (onWorkers) {
    // Callers may keep the Db across requests; resolve the binding on every access.
    return new Proxy({} as Db, {
      get(_target, prop) {
        const real = d1Db() as unknown as Record<string | symbol, unknown>;
        const v = Reflect.get(real, prop);
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(real) : v;
      },
    });
  }
  if (!url) throw new Error("DATABASE_URL is not set");
  cache.__stocklanaDb ??= new Map();
  let hit = cache.__stocklanaDb.get(url);
  if (!hit) {
    hit = openLocal(url);
    cache.__stocklanaDb.set(url, hit);
  }
  return hit.db;
}

export async function closeDb(url = process.env.DATABASE_URL): Promise<void> {
  if (onWorkers || !url) return;
  const hit = cache.__stocklanaDb?.get(url);
  if (!hit) return;
  cache.__stocklanaDb?.delete(url);
  hit.conn.close();
}

/** Folder of the SQL migrations (also D1's `migrations_dir`). */
export const migrationsDir = (): string => path.join(repoRoot(), "packages/db/drizzle");

/** Apply pending migrations to a local database (D1 uses `wrangler d1 migrations apply`). */
export async function migrateDb(url = process.env.DATABASE_URL): Promise<void> {
  const db = getDb(url);
  const conn = url ? cache.__stocklanaDb?.get(url)?.conn : undefined;
  if (!conn) throw new Error("migrateDb runs on local databases only");
  await migrate(
    db,
    async (queries) => {
      conn.exec("BEGIN IMMEDIATE");
      try {
        for (const q of queries) conn.exec(q);
        conn.exec("COMMIT");
      } catch (e) {
        conn.exec("ROLLBACK");
        throw e;
      }
    },
    { migrationsFolder: migrationsDir() },
  );
}
