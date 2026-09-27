/**
 * The local devnet database every script shares: `.data/app_devnet.db` next to the
 * localnet `.data/app.db` (D051). The hosted demo uses Cloudflare D1, which only the
 * Workers reach (docs/DEPLOY.md "Opsi C").
 */
export function devnetDbUrl(): string {
  const base = process.env.DATABASE_URL || "file:.data/app.db";
  if (!base.startsWith("file:")) return "file:.data/app_devnet.db";
  return base.replace(/([^/]+?)(\.db)?$/, "app_devnet.db");
}
