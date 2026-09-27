/**
 * SQLite helpers that keep every query inside Cloudflare D1's limits (D051):
 * at most 100 bound parameters per statement.
 */
import { getTableColumns, type SQL, sql } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";

/** D1: maximum bound parameters per query. */
export const MAX_PARAMS = 100;

/** Split rows for multi-row INSERTs so one statement binds at most MAX_PARAMS values. */
export function chunkRows<T>(table: SQLiteTable, rows: T[]): T[][] {
  const per = Math.max(1, Math.floor(MAX_PARAMS / Object.keys(getTableColumns(table)).length));
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += per) out.push(rows.slice(i, i + per));
  return out;
}

/**
 * `column IN (values)` with a single bound parameter (a JSON array read by json_each),
 * so long lists never hit the parameter limit.
 */
export function inList(column: SQLiteColumn | SQL, values: readonly (string | number)[]): SQL {
  return sql`${column} in (select value from json_each(${JSON.stringify(values)}))`;
}

/**
 * First column of a raw `db.all()` row. Engines differ in raw row shape (D1: objects,
 * local node:sqlite proxy: arrays); query-builder results are always mapped by Drizzle.
 */
export function firstColumn(row: unknown): unknown {
  if (Array.isArray(row)) return row[0];
  return row && typeof row === "object" ? Object.values(row)[0] : undefined;
}
