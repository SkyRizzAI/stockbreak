/** Resolve the repo root and load its .env so the server works from any cwd (e.g. Claude Desktop). */
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "../../..");
process.env.REPO_ROOT ??= root;
const envFile = path.join(root, ".env");
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
