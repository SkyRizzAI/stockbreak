/** Node/Bun-only helpers (filesystem keypairs). */
import { readFileSync } from "node:fs";
import { repoPath } from "@repo/config/node";
import { createKeyPairSignerFromBytes, type KeyPairSigner } from "@solana/kit";

export async function loadSigner(path: string): Promise<KeyPairSigner> {
  const bytes = Uint8Array.from(JSON.parse(readFileSync(repoPath(path), "utf8")) as number[]);
  return createKeyPairSignerFromBytes(bytes);
}

/** Signer from a keypair JSON byte array when set (hosted, e.g. Cloudflare), else the file. */
export async function loadSignerFrom(
  json: string | undefined,
  path: string,
): Promise<KeyPairSigner> {
  if (!json) return loadSigner(path);
  return createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(json) as number[]));
}
