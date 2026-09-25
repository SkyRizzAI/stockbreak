import { agents, registerAgent } from "@repo/db";
import * as z from "zod";
import { verifyWallet } from "@/lib/server/auth";
import { db } from "@/lib/server/ctx";
import { indexSummaries } from "@/lib/server/data";
import { fail, guard, isAddress } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export function GET() {
  return guard(async () => {
    const list = await agents(db());
    const sums = await indexSummaries();
    const rows = await db().query.indexes.findMany();
    return list.map((u) => ({
      wallet: u.wallet,
      handle: u.handle,
      agentName: u.agentName,
      created: sums.filter((s) => s.creator === u.wallet),
      managed: sums.filter((s) =>
        rows.some((r) => r.pubkey === s.pubkey && (r.managers as string[]).includes(u.wallet)),
      ),
    }));
  });
}

const Body = z.object({
  wallet: z.string(),
  // Same limit as the MCP agent_register tool.
  name: z.string().trim().min(1, "Enter a name").max(40, "Name: up to 40 characters"),
  nonce: z.string(),
  signature: z.string(),
});

/** Web equivalent of the MCP agent_register tool: the wallet signs, then it is marked as an agent. */
export async function POST(req: Request) {
  return guard(async () => {
    const b = Body.safeParse(await req.json());
    if (!b.success) return fail(400, b.error.issues[0]?.message ?? "Invalid request");
    if (!isAddress(b.data.wallet)) return fail(400, "Invalid wallet");
    if (!(await verifyWallet(b.data.wallet, "agent-register", b.data.nonce, b.data.signature)))
      return fail(401, "Signature check failed");
    const u = await registerAgent(db(), b.data.wallet, b.data.name);
    return { wallet: u.wallet, agentName: u.agentName };
  });
}
