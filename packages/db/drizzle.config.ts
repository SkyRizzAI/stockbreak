import path from "node:path";
import { defineConfig } from "drizzle-kit";

// Bun only auto-loads .env from the cwd; load the monorepo root .env explicitly.
const rootEnv = path.resolve(process.cwd(), "../../.env");
if (!process.env.DATABASE_URL) process.loadEnvFile?.(rootEnv);

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  strict: true,
  verbose: true,
});
