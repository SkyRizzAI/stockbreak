/** Node/Bun-only helpers (filesystem). Not for browser bundles. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
// Workers have no repo filesystem: the committed devnet deployment is bundled (D050).
import bundledDevnet from "../deployments/devnet.json";
import type { Cluster } from "./cluster";
import type { Deployment } from "./deployments";

const onWorkers = typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";

/** Repo root: $REPO_ROOT, else the nearest ancestor of cwd containing packages/config. */
function findRoot(): string {
  if (process.env.REPO_ROOT) return process.env.REPO_ROOT;
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, "packages/config/package.json"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return process.cwd();
}

export const REPO_ROOT = findRoot();
export const DEPLOYMENTS_DIR = path.join(REPO_ROOT, "packages/config/deployments");

export function deploymentPath(cluster: Cluster): string {
  return path.join(DEPLOYMENTS_DIR, `${cluster}.json`);
}

export function readDeployment(cluster: Cluster): Deployment | null {
  if (onWorkers) return cluster === "devnet" ? (bundledDevnet as unknown as Deployment) : null;
  const p = deploymentPath(cluster);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as Deployment;
}

export function writeDeployment(d: Deployment): void {
  mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  writeFileSync(
    deploymentPath(d.cluster),
    `${JSON.stringify({ ...d, updatedAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

/** Resolve a repo-relative path (e.g. `.keys/admin.json`). */
export function repoPath(p: string): string {
  return path.isAbsolute(p) ? p : path.join(REPO_ROOT, p);
}

/**
 * Manual price shocks (`bun run price`): symbol → cumulative factor. The price
 * feeder multiplies its source price by this factor so shocks persist.
 */
export function shocksPath(cluster: Cluster): string {
  return path.join(DEPLOYMENTS_DIR, `${cluster}.shocks.json`);
}

export function readShocks(cluster: Cluster): Record<string, number> {
  const p = shocksPath(cluster);
  if (!existsSync(p)) return {};
  return JSON.parse(readFileSync(p, "utf8")) as Record<string, number>;
}

export function writeShocks(cluster: Cluster, shocks: Record<string, number>): void {
  mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  writeFileSync(shocksPath(cluster), `${JSON.stringify(shocks, null, 2)}\n`);
}
