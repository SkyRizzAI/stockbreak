import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PostgresJsDatabase<typeof schema>;

const cache = globalThis as unknown as {
  __stocklanaDb?: Map<string, { db: Db; sql: postgres.Sql }>;
};

/** One pooled client per URL (survives Next.js dev HMR). */
export function getDb(url = process.env.DATABASE_URL): Db {
  if (!url) throw new Error("DATABASE_URL is not set");
  cache.__stocklanaDb ??= new Map();
  const hit = cache.__stocklanaDb.get(url);
  if (hit) return hit.db;
  const sql = postgres(url, { max: 10, onnotice: () => {} });
  const db = drizzle({ client: sql, schema });
  cache.__stocklanaDb.set(url, { db, sql });
  return db;
}

export async function closeDb(url = process.env.DATABASE_URL): Promise<void> {
  if (!url) return;
  const hit = cache.__stocklanaDb?.get(url);
  if (!hit) return;
  cache.__stocklanaDb?.delete(url);
  await hit.sql.end({ timeout: 5 });
}
