/**
 * The devnet database every script shares: the hosted one when DEVNET_DATABASE_URL is set
 * (public demo, docs/DEPLOY.md), otherwise the local `app_devnet` database.
 */
export const REMOTE_DEVNET_DB = process.env.DEVNET_DATABASE_URL || "";

export function devnetDbUrl(): string {
  if (REMOTE_DEVNET_DB) return REMOTE_DEVNET_DB;
  const u = new URL(process.env.DATABASE_URL || "postgres://postgres:postgres@localhost:5434/app");
  u.pathname = "/app_devnet";
  return u.toString();
}
