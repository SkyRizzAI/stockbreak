import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// Single root .env for the whole monorepo (PLAN §7.9).
loadEnvConfig(path.resolve(__dirname, "../.."));

const nextConfig: NextConfig = {
  agentRules: false,
  transpilePackages: ["@repo/config", "@repo/sdk", "@repo/db"],
};

export default nextConfig;
