import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

/** Repo root (scripts/lib/.. /..). */
export const ROOT = path.resolve(import.meta.dir, "../..");
export const ANCHOR_DIR = path.join(ROOT, "anchor");
export const KEYS_DIR = path.join(ROOT, ".keys");
export const SOLANA_CLI_CONFIG = path.join(KEYS_DIR, "solana-cli.yml");

/** Pinned Agave release (D012). Never rely on the global active_release symlink. */
export const SOLANA_VERSION = "4.2.2";
export const SOLANA_BIN = path.join(
  homedir(),
  ".local/share/solana/install/releases",
  SOLANA_VERSION,
  "solana-release/bin",
);

/** PATH with the pinned Solana release first. */
export function toolchainPath(): string {
  const current = process.env.PATH ?? "";
  if (!existsSync(SOLANA_BIN)) return current;
  return `${SOLANA_BIN}:${current}`;
}

/** Environment for child processes that call solana / anchor / cargo-build-sbf. */
export function toolchainEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  env.PATH = toolchainPath();
  return { ...env, ...extra };
}
