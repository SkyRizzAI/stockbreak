/** Node/Bun-only helpers (filesystem keypairs). */
import { readFileSync } from "node:fs";
import { repoPath } from "@repo/config/node";
import { createKeyPairSignerFromBytes, type KeyPairSigner } from "@solana/kit";

export async function loadSigner(path: string): Promise<KeyPairSigner> {
  const bytes = Uint8Array.from(JSON.parse(readFileSync(repoPath(path), "utf8")) as number[]);
  return createKeyPairSignerFromBytes(bytes);
}
