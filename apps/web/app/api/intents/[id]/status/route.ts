import { getIntent, setIndexMeta, setIntentParams, updateIntent } from "@repo/db";
import * as z from "zod";
import { db } from "@/lib/server/ctx";
import { fail, guard } from "@/lib/server/http";
import { ensureIndexRow } from "@/lib/server/index-row";
import { paramsOf, progressOf, verifiedSignatures } from "@/lib/server/intents";

const Body = z.object({
  signatures: z.array(z.string()).max(20),
  /** Ignored: completion is derived from verified signatures. */
  done: z.boolean().optional(),
  error: z.string().max(300).nullable().optional(),
});

/**
 * Progress report from /sign. Only signatures that landed on chain, succeeded and
 * were signed by the intent's wallet count; the step cursor advances when every
 * transaction of the built step is confirmed. Nobody can mark an intent executed
 * without the transactions to prove it.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/intents/[id]/status">) {
  const { id } = await ctx.params;
  return guard(async () => {
    const b = Body.safeParse(await req.json());
    if (!b.success) return fail(400, "Invalid request");
    const it = await getIntent(db(), id);
    if (!it) return fail(404, "Intent not found");
    if (it.status === "executed") return { ok: true, status: "executed" };
    if (!it.wallet) return fail(409, "Nothing was requested for signing yet");
    const p = progressOf(it);
    const known = new Set((it.signatures as string[] | null) ?? []);
    const fresh = await verifiedSignatures(
      it.wallet,
      b.data.signatures.filter((s) => !known.has(s)),
    );
    let status = it.status;
    if (p.built) {
      p.built = { ...p.built, sigs: p.built.sigs + fresh.length };
      if (p.built.sigs >= p.built.txs) {
        if (p.built.next === null) status = "executed";
        else p.next = p.built.next;
        p.built = null;
      } else if (b.data.error && p.built.sigs === 0) {
        // Rejected or failed before anything landed: release the lock so a retry rebuilds.
        p.built = null;
      }
    }
    if (b.data.error && status !== "executed") status = "failed";
    else if (status !== "executed") status = "in_progress";
    await setIntentParams(db(), id, paramsOf(p));
    await updateIntent(db(), id, { status, signatures: [...known, ...fresh] });
    // Agent-built creates carry a description; store it once the index exists.
    const created = p.state.index as string | undefined;
    const description = p.rest.description as string | undefined;
    if (status === "executed" && created && description) {
      const row = await ensureIndexRow(created).catch(() => undefined);
      if (row && !row.description)
        await setIndexMeta(db(), created, { description: description.slice(0, 280) });
    }
    return { ok: true, status, accepted: fresh.length };
  });
}
