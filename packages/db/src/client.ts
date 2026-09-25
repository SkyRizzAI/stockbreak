import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;
type PgOptions = postgres.Options<Record<string, postgres.PostgresType>>;

const cache = globalThis as unknown as {
  __stocklanaDb?: Map<string, { db: Db; sql: postgres.Sql }>;
};

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Connection options for a DATABASE_URL (docs/DEPLOY.md, D038).
 * - Local Postgres: unchanged (no TLS, pool of 10).
 * - Hosted Postgres (e.g. Neon): TLS required unless the URL says otherwise.
 * - `channel_binding` is dropped: postgres.js would send it as a server
 *   parameter and the server rejects it.
 * - Pooled endpoints (`-pooler` host, PgBouncer transaction mode): no named
 *   prepared statements.
 * - Serverless (Vercel): a small pool that closes idle connections quickly.
 *   DATABASE_POOL_MAX overrides the pool size everywhere.
 */
export function connectionOptions(raw: string): { url: string; options: PgOptions } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { url: raw, options: { max: 10 } };
  }
  u.searchParams.delete("channel_binding");
  // Bare hostnames (docker service names), private networks and *.local are local too.
  const h = u.hostname;
  const local =
    LOCAL_HOSTS.has(h) ||
    !h.includes(".") ||
    h === "host.docker.internal" ||
    h.endsWith(".local") ||
    /^(10|127)\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h);
  const serverless = !!process.env.VERCEL;
  const envMax = Number(process.env.DATABASE_POOL_MAX);
  const options: PgOptions = {
    max: Number.isInteger(envMax) && envMax > 0 ? envMax : serverless ? 3 : 10,
  };
  if (!local && !u.searchParams.has("sslmode") && !u.searchParams.has("ssl"))
    options.ssl = "require";
  // Transaction-mode poolers (Neon -pooler, Supabase pooler.*, PgBouncer on 6543) can't
  // keep named prepared statements; DATABASE_PREPARE=false forces it off anywhere.
  if (/pooler/.test(h) || u.port === "6543" || process.env.DATABASE_PREPARE === "false")
    options.prepare = false;
  if (serverless) {
    options.idle_timeout = 20;
    options.connect_timeout = 15;
  }
  return { url: u.toString(), options };
}

/**
 * Cloudflare Workers (docs/DEPLOY.md, D046): a socket opened by one request can't be
 * used by another, so the Db handed out there is a proxy that resolves, on each access,
 * to a client owned by the current request. The request scope is the one OpenNext
 * exposes (and apps/worker/src/cf.ts mirrors) on `Symbol.for("__cloudflare-context__")`;
 * the connection string comes from its Hyperdrive binding when present.
 */
interface CfScope {
  env?: { HYPERDRIVE?: { connectionString: string } };
  ctx?: object;
}
const onWorkers = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
const cfScope = (): CfScope | undefined =>
  (globalThis as unknown as Record<symbol, CfScope | undefined>)[
    Symbol.for("__cloudflare-context__")
  ];
const perRequest = new WeakMap<object, { db: Db; sql: postgres.Sql }>();

function requestClient(url: string): { db: Db; sql: postgres.Sql } {
  const scope = cfScope();
  if (!scope?.ctx) throw new Error("Database used outside a Cloudflare request context");
  let hit = perRequest.get(scope.ctx);
  if (!hit) {
    const hyperdrive = scope.env?.HYPERDRIVE?.connectionString;
    const c = connectionOptions(url);
    // Hyperdrive options per its postgres.js guide; without it, one direct connection.
    const sql = hyperdrive
      ? postgres(hyperdrive, { max: 5, fetch_types: false, prepare: true, onnotice: () => {} })
      : postgres(c.url, { ...c.options, max: 1, onnotice: () => {} });
    hit = { db: drizzle({ client: sql, schema }), sql };
    perRequest.set(scope.ctx, hit);
  }
  return hit;
}

/** One pooled client per URL (survives Next.js dev HMR); one per request on Workers. */
export function getDb(url = process.env.DATABASE_URL): Db {
  if (!url) throw new Error("DATABASE_URL is not set");
  if (onWorkers)
    return new Proxy({} as Db, {
      get(_target, prop) {
        const real = requestClient(url).db as unknown as Record<string | symbol, unknown>;
        const v = Reflect.get(real, prop);
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(real) : v;
      },
    });
  cache.__stocklanaDb ??= new Map();
  const hit = cache.__stocklanaDb.get(url);
  if (hit) return hit.db;
  const c = connectionOptions(url);
  const sql = postgres(c.url, { ...c.options, onnotice: () => {} });
  const db = drizzle({ client: sql, schema });
  cache.__stocklanaDb.set(url, { db, sql });
  return db;
}

export async function closeDb(url = process.env.DATABASE_URL): Promise<void> {
  if (onWorkers) {
    const ctx = cfScope()?.ctx;
    const hit = ctx ? perRequest.get(ctx) : undefined;
    if (ctx) perRequest.delete(ctx);
    if (hit) await hit.sql.end({ timeout: 5 });
    return;
  }
  if (!url) return;
  const hit = cache.__stocklanaDb?.get(url);
  if (!hit) return;
  cache.__stocklanaDb?.delete(url);
  await hit.sql.end({ timeout: 5 });
}
