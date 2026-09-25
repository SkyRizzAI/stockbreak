"use client";
import { humanizeError } from "@repo/sdk";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { KV, NotFoundState, SimulatedBadge } from "@/components/data/states";
import { pendingLines } from "@/components/index/pending-update";
import { openConnect } from "@/components/shell/wallet-button";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { duration, short, usd } from "@/lib/format";
import { txUrl } from "@/lib/solana";
import { signAndSendBase64 } from "@/lib/tx";
import { txOverlay } from "@/lib/tx-overlay";
import type { PendingUpdateJson, StrategyJson } from "@/lib/types";
import { useWallet } from "@/lib/wallet";

interface Intent {
  id: string;
  kind: string;
  params: Record<string, unknown>;
  wallet: string | null;
  createdBy: string;
  status: string;
  signatures: string[];
  expiresAt: string;
  /** Some steps already landed: signing continues from there. */
  resumed?: boolean;
  result?: { index: string } | null;
}

interface Step {
  step: number;
  label: string;
  txs: string[];
  next: number | null;
  summary: string | null;
}

/** Single-step index management intents (D048). */
const MANAGE = new Set([
  "propose_update",
  "apply_update",
  "cancel_update",
  "set_paused",
  "set_managers",
  "claim_fees",
]);

const lines = (pending: unknown): [string, string][] =>
  pending ? pendingLines(pending as PendingUpdateJson).map((l) => [l.label, l.value]) : [];

function describe(it: Intent): { title: string; rows: [string, string][] } {
  const p = it.params;
  const sym = String(p.indexSymbol ?? short(String(p.index ?? "")));
  const list = (xs: unknown) =>
    ((xs as string[] | undefined) ?? []).map((x) => (x.length > 20 ? short(x) : x)).join(", ") ||
    "None";
  switch (it.kind) {
    case "propose_update": {
      const tl = Number(p.timelockSecs ?? 0);
      const assets = p.assets as { mint: string; symbol?: string; weightBps: number }[] | null;
      const kept = (p.kept as string[] | undefined) ?? [];
      return {
        title: `Propose update to ${sym}`,
        rows: [
          ...lines({
            eta: 0,
            assets: assets
              ? assets.map((a) => ({
                  mint: a.mint,
                  symbol: a.symbol ?? short(a.mint),
                  targetWeightBps: a.weightBps,
                }))
              : null,
            fees: p.fees ?? null,
            strategy: (p.strategy as StrategyJson | null) ?? null,
          }),
          ...(kept.length
            ? ([["Kept at 0% until sold", kept.join(", ")]] as [string, string][])
            : []),
          [
            "Applies",
            p.immediate
              ? "Immediately (fee cut)"
              : tl > 0
                ? `After a ${duration(tl)} timelock, then someone applies it`
                : "Right after signing, once applied",
          ],
          ...(p.replacesPending
            ? ([["Replaces", "The current pending update"]] as [string, string][])
            : []),
        ],
      };
    }
    case "apply_update":
    case "cancel_update":
      return {
        title: `${it.kind === "apply_update" ? "Apply" : "Cancel"} the update to ${sym}`,
        rows: [
          ...lines(p.pending),
          ["Scheduled for", p.eta ? new Date(Number(p.eta) * 1000).toLocaleString() : "Unknown"],
        ],
      };
    case "set_paused":
      return {
        title: `${p.paused ? "Pause" : "Resume"} ${sym}`,
        rows: [
          [
            "Effect",
            p.paused
              ? "Stops joins and rebalances. Redeem keeps working."
              : "Joins and rebalances work again.",
          ],
        ],
      };
    case "set_managers":
      return {
        title: `Set managers of ${sym}`,
        rows: [
          ["Before", list(p.before)],
          ["After", list(p.labels ?? p.managers)],
          ["Managers can", "Rebalance only. They cannot change weights, fees or withdraw."],
        ],
      };
    case "claim_fees":
      return {
        title: p.kind === "royalty" ? `Claim royalty from ${sym}` : `Claim creator fees on ${sym}`,
        rows: [
          ["Owed so far", `${(Number(p.owedShares ?? 0) / 1e6).toLocaleString("en-US")} shares`],
          ["Paid as", `${sym} shares (plus fees accrued since)`],
        ],
      };
    case "join":
      return {
        title: `Join ${String(p.indexName ?? p.indexSymbol ?? "index")}`,
        rows: [
          ["Amount", usd(Number(p.usdc))],
          ["Index", String(p.indexSymbol ?? short(String(p.index)))],
        ],
      };
    case "redeem":
      return {
        title: `Redeem from ${String(p.indexName ?? p.indexSymbol ?? "index")}`,
        rows: [
          ["Shares", String(Number(p.shares) / 1e6)],
          ["Receive", p.toUsdc === false ? "Assets" : "USDC"],
        ],
      };
    case "create_index":
    case "clone":
      return {
        title: `${it.kind === "clone" ? "Clone" : "Create"} ${String(p.name)} (${String(p.symbol)})`,
        rows: [
          [
            "Assets",
            ((p.assets as { symbol?: string; weightBps: number }[]) ?? [])
              .map((a) => `${a.symbol ?? "?"} ${(a.weightBps / 100).toFixed(1)}%`)
              .join(", "),
          ],
          ["Strategy", String((p.strategy as { mode?: string })?.mode ?? "")],
          [
            "Management fee",
            `${(Number((p.fees as { mgmtFeeBps?: number })?.mgmtFeeBps ?? 0) / 100).toFixed(2)}% / yr`,
          ],
          ["First deposit", p.depositUsdc ? usd(Number(p.depositUsdc)) : "None"],
          ...(p.parent
            ? ([["Parent", `${short(String(p.parent))}${p.followsParent ? " (follows)" : ""}`]] as [
                string,
                string,
              ][])
            : []),
        ],
      };
    default:
      return { title: it.kind, rows: [] };
  }
}

export function SignView() {
  const id = useSearchParams().get("id") ?? "";
  const w = useWallet();
  const q = useQuery({
    queryKey: ["intent", id],
    enabled: !!id,
    queryFn: () => api<Intent>(`/api/intents/${id}`),
    refetchInterval: 5000,
  });
  const [running, setRunning] = useState(false);
  const [label, setLabel] = useState<string | null>(null);
  const [done, setDone] = useState(0);
  const [sigs, setSigs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  if (!id)
    return (
      <div className="mx-auto max-w-[1280px] px-4 py-8 md:px-8">
        <NotFoundState
          title="No request to sign"
          detail="This page opens a transaction request prepared by an AI agent. Ask the agent for its sign link."
          href="/agents"
          cta="About AI agents"
        />
      </div>
    );
  if (q.isLoading)
    return (
      <div className="mx-auto max-w-[1280px] px-4 py-8 md:px-8">
        <Skeleton className="h-64" />
      </div>
    );
  if (q.isError || !q.data)
    return (
      <div className="mx-auto max-w-[1280px] px-4 py-8 md:px-8">
        <NotFoundState
          title="Request not found"
          detail="This sign link is invalid or was removed. Ask your agent to prepare the request again."
          href="/agents"
          cta="About AI agents"
        />
      </div>
    );
  const it = q.data;
  const d = describe(it);
  const wrongWallet =
    !!it.wallet && !!w.address && it.wallet !== w.address && it.status !== "executed";
  const execute = async () => {
    if (!w.signer || !w.address) return;
    setRunning(true);
    setError(null);
    const all: string[] = [];
    let n = 0;
    const creating = it.kind === "create_index" || it.kind === "clone";
    const manage = MANAGE.has(it.kind);
    const p = it.params;
    // Server steps → overlay phases (same names as the in-app flows).
    const keyOf = (label: string) => {
      if (manage) return "confirm";
      if (/lookup/i.test(label)) return "lookup-table";
      if (/^create/i.test(label)) return "create";
      if (/redeem/i.test(label)) return "redeem";
      if (/swap/i.test(label)) return creating ? "deposit-swap" : "swap";
      return creating ? "deposit-join" : "join";
    };
    txOverlay.start(
      d.title,
      manage
        ? ["confirm"]
        : it.kind === "join"
          ? ["swap", "join"]
          : it.kind === "redeem"
            ? p.toUsdc === false
              ? ["redeem"]
              : ["redeem", "swap"]
            : [
                ...(((p.assets as unknown[]) ?? []).length >= 5 ? ["lookup-table"] : []),
                "create",
                ...(Number(p.depositUsdc ?? 0) > 0 ? ["deposit-swap", "deposit-join"] : []),
              ],
    );
    try {
      // The server tracks progress and hands out the next unfinished step, so a
      // retry or reload continues instead of repeating swaps.
      for (;;) {
        const s: Step = await api<Step>(`/api/intents/${id}/tx`, {
          method: "POST",
          body: JSON.stringify({ account: w.address }),
        });
        setLabel(s.label);
        const key = keyOf(s.label);
        txOverlay.progress({
          step: key,
          done: n,
          total: n + s.txs.length + (s.next === null ? 0 : 1),
        });
        for (const tx of s.txs) {
          const sig = await signAndSendBase64(w.signer, tx);
          all.push(sig);
          setSigs([...all]);
          setDone(++n);
          txOverlay.progress({
            step: key,
            done: n,
            total: n + (s.txs.length - s.txs.indexOf(tx) - 1) + (s.next === null ? 0 : 1),
            signature: sig,
          });
          // Report each landed tx at once: a crash mid-step never loses progress.
          await api(`/api/intents/${id}/status`, {
            method: "POST",
            body: JSON.stringify({ signatures: [sig] }),
          });
        }
        if (s.next === null) break;
      }
      txOverlay.success("Signed. Your agent can take it from here.", all.at(-1));
      await q.refetch();
    } catch (e) {
      const msg = humanizeError(e);
      txOverlay.fail(
        n > 0 ? "partial" : "error",
        msg,
        n > 0
          ? `${n} transaction${n === 1 ? "" : "s"} already went through. Signing again continues from there.`
          : null,
      );
      setError(
        n > 0
          ? `${msg} ${n} transaction${n === 1 ? "" : "s"} already went through; signing again continues from there.`
          : msg,
      );
      await api(`/api/intents/${id}/status`, {
        method: "POST",
        body: JSON.stringify({ signatures: [], error: msg.slice(0, 300) }),
      }).catch(() => {});
      await q.refetch().catch(() => {});
    } finally {
      setRunning(false);
    }
  };
  return (
    <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-6 px-4 py-8 md:px-8">
      <div className="flex flex-col gap-1">
        <span className="text-xs text-muted-foreground">Requested by {it.createdBy}</span>
        <div className="flex items-center gap-2">
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl" data-testid="intent-title">
            {d.title}
          </h1>
          <SimulatedBadge />
        </div>
      </div>
      <KV
        rows={[
          ...d.rows,
          ["Status", it.status],
          ["Expires", new Date(it.expiresAt).toLocaleTimeString()],
        ]}
      />
      {running || done ? (
        <div className="flex flex-col gap-1.5" aria-live="polite">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{label ?? "Preparing"}</span>
            <span className="num">{done} signed</span>
          </div>
          <Progress value={running ? 50 : 100} />
        </div>
      ) : null}
      {sigs.length ? (
        <ul className="flex flex-col gap-1 text-xs">
          {sigs.map((s) => (
            <li key={s}>
              <a
                href={txUrl(s)}
                target="_blank"
                rel="noreferrer"
                className="mono underline underline-offset-2"
              >
                {short(s, 8)}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <p className="text-sm text-down" role="alert">
          {error}
        </p>
      ) : null}
      {it.status === "executed" ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-up">Done. You can return to your agent.</p>
          {it.result?.index ? (
            <Link href={`/i/${it.result.index}`} className="text-sm underline underline-offset-2">
              Open the index
            </Link>
          ) : null}
        </div>
      ) : it.status === "expired" ? (
        <p className="text-sm text-muted-foreground">
          This request expired. Ask the agent to create a new one.
        </p>
      ) : !w.address ? (
        <Button size="lg" onClick={openConnect}>
          Connect wallet
        </Button>
      ) : wrongWallet ? (
        <p className="text-sm text-warn">
          This request was made for {short(it.wallet as string)}. Switch wallets.
        </p>
      ) : (
        <Button
          size="lg"
          disabled={running}
          onClick={() => void execute()}
          data-testid="intent-sign"
        >
          {running
            ? "Signing…"
            : it.resumed || it.status === "failed"
              ? "Continue signing"
              : "Review in wallet and sign"}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        Your wallet signs each transaction; nothing moves without your approval.{" "}
        <Link href="/agents" className="underline">
          About agents
        </Link>
      </p>
    </div>
  );
}
