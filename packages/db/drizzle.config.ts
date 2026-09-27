import path from "node:path";
import { defineConfig } from "drizzle-kit";

// SQLite dialect (D051): the same migrations run on local libSQL files and on Cloudflare D1
// (`wrangler d1 migrations apply`, migrations_dir = packages/db/drizzle).
// Bun only auto-loads .env from the cwd; load the monorepo root .env explicitly.
const rootEnv = path.resolve(process.cwd(), "../../.env");
if (!process.env.DATABASE_URL) process.loadEnvFile?.(rootEnv);

const url = process.env.DATABASE_URL ?? "file:.data/app.db";

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  // Relative file URLs are relative to the repo root (see resolveDbUrl).
  dbCredentials: {
    url: url.startsWith("file:") && !url.startsWith("file:/") ? `file:../../${url.slice(5)}` : url,
  },
  strict: true,
  verbose: true,
});
