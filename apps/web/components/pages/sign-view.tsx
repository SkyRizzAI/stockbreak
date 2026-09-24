"use client";
import { humanizeError } from "@repo/sdk";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { KV, NotFoundState, SimulatedBadge } from "@/components/data/states";
import { openConnect } from "@/components/shell/wallet-button";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { short, usd } from "@/lib/format";
import { txUrl } from "@/lib/solana";
import { signAndSendBase64 } from "@/lib/tx";
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

function describe(it: Intent): { title: string; rows: [string, string][] } {
  const p = it.params;
  switch (it.kind) {
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
      <div className="mx-auto max-w-[640px] px-4 py-8 md:px-8">
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
      <div className="mx-auto max-w-[640px] px-4 py-8 md:px-8">
        <Skeleton className="h-64" />
      </div>
    );
  if (q.isError || !q.data)
    return (
      <div className="mx-auto max-w-[640px] px-4 py-8 md:px-8">
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
    try {
      // The server tracks progress and hands out the next unfinished step, so a
      // retry or reload continues instead of repeating swaps.
      for (;;) {
        const s: Step = await api<Step>(`/api/intents/${id}/tx`, {
          method: "POST",
          body: JSON.stringify({ account: w.address }),
        });
        setLabel(s.label);
        for (const tx of s.txs) {
          const sig = await signAndSendBase64(w.signer, tx);
          all.push(sig);
          setSigs([...all]);
          setDone(++n);
          // Report each landed tx at once: a crash mid-step never loses progress.
          await api(`/api/intents/${id}/status`, {
            method: "POST",
            body: JSON.stringify({ signatures: [sig] }),
          });
        }
        if (s.next === null) break;
      }
      await q.refetch();
    } catch (e) {
      const msg = humanizeError(e);
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
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6 px-4 py-8 md:px-8">
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
