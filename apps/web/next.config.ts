import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

const REPO_ROOT = path.resolve(__dirname, "../..");

// Single root .env for the whole monorepo (PLAN §7.9). Hosted builds (Vercel) get
// their env from the platform; a root .env there is never committed anyway.
if (!process.env.VERCEL) loadEnvConfig(REPO_ROOT);

// Vercel: default the public URL (Blinks, OG, metadata) to the production domain.
if (!process.env.WEB_URL && process.env.VERCEL_PROJECT_PRODUCTION_URL)
  process.env.WEB_URL = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;

const nextConfig: NextConfig = {
  agentRules: false,
  transpilePackages: ["@repo/config", "@repo/sdk", "@repo/db", "@repo/mcp"],
  // Self-hosting / local check of the traced file layout (docs/DEPLOY.md). Vercel ignores it.
  output: process.env.NEXT_OUTPUT_STANDALONE ? "standalone" : undefined,
  // Monorepo: trace server files from the repo root so functions (Vercel) ship
  // packages/config/deployments/<cluster>.json, read at runtime via the filesystem.
  // `findRoot()` in @repo/config/node locates the repo root by packages/config/package.json.
  outputFileTracingRoot: REPO_ROOT,
  outputFileTracingIncludes: {
    "/*": ["../../packages/config/package.json", "../../packages/config/deployments/*.json"],
  },
  // `next dev` behind a public tunnel (docs/DEPLOY.md option B).
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;
