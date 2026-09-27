/**
 * bun run db:migrate [-- <file:url> ...]
 *
 * Apply pending migrations to the local SQLite databases (D051). Without arguments:
 * DATABASE_URL (localnet), the devnet file and TEST_DATABASE_URL. Idempotent.
 * Cloudflare D1 is migrated by `wrangler d1 migrations apply` (docs/DEPLOY.md "Opsi C").
 */
import { closeDb, migrateDb } from "@repo/db";
import { devnetDbUrl } from "./lib/devnet-db";
import { log } from "./lib/proc";

const S = "db-migrate";
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const urls = args.length
  ? args
  : [
      process.env.DATABASE_URL || "file:.data/app.db",
      devnetDbUrl(),
      process.env.TEST_DATABASE_URL || "file:.data/app_test.db",
    ];

for (const url of [...new Set(urls)]) {
  await migrateDb(url);
  await closeDb(url);
  log(S, `migrated ${url}`);
}
