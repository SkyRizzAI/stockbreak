/**
 * Agent console (D045): the signed-in wallet's own AI agents.
 * GET  → { agents: [{ wallet, name, createdAt, keys: [{ id, name, prefix, createdAt, lastUsedAt, revokedAt }] }] }
 * POST { name } → { wallet, name } — a fresh server-custodied wallet (seed stored encrypted).
 */
import { randomBytes } from "node:crypto";
import {
  createAgentWallet,
  encryptSecret,
  listOwnerAgents,
  MAX_AGENTS_PER_OWNER,
  registerAgent,
} from "@repo/db";
import { createKeyPairSignerFromPrivateKeyBytes } from "@solana/kit";
import { firstIssue, NameBody, requireAgentSecret, requireOwner } from "@/lib/server/agent-keys";
import { db } from "@/lib/server/ctx";
import { fail, guard } from "@/lib/server/http";
import { requireWriter } from "@/lib/server/session";

export const dynamic = "force-dynamic";

export function GET() {
  return guard(async () => {
    const owner = await requireOwner();
    if (owner instanceof Response) return owner;
    return { agents: await listOwnerAgents(db(), owner) };
  });
}

export function POST(req: Request) {
  return guard(async () => {
    const owner = await requireWriter(req);
    if (owner instanceof Response) return owner;
    const b = NameBody.safeParse(await req.json());
    if (!b.success) return fail(400, firstIssue(b.error));
    const secret = requireAgentSecret();
    if (secret instanceof Response) return secret;
    const seed = new Uint8Array(randomBytes(32));
    const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
    const row = await createAgentWallet(db(), {
      wallet: signer.address,
      owner,
      name: b.data.name,
      secretEnc: encryptSecret(seed, secret),
    });
    seed.fill(0);
    if (!row) return fail(409, `You can have up to ${MAX_AGENTS_PER_OWNER} agents`);
    await registerAgent(db(), row.wallet, row.name);
    return { wallet: row.wallet, name: row.name };
  });
}
