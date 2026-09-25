"use client";
/**
 * Autopilot settings and run log for one of the owner's agents (D047): the platform
 * worker wakes the agent on its schedule, it decides with an LLM using the MCP tools
 * (as that agent, inside the program's limits) and every run is logged here.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "cn";
import { Check, Circle, Loader2, Minus, Play, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { ago } from "@/lib/format";
import { socialWrite } from "@/lib/social";

interface Run {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "ok" | "noop" | "error";
  summary: string;
  actions: { tool: string; ok: boolean; detail: string }[];
}
export interface Autopilot {
  enabled: boolean;
  intervalMinutes: number;
  strategy: string;
  indexes: string[];
  model: string | null;
  available: boolean;
  reason: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  runs: Run[];
}
export interface AgentIndexRef {
  pubkey: string;
  symbol: string;
}

const INTERVALS = [5, 15, 30, 60, 240, 1440];
const every = (m: number) => (m < 60 ? `${m} min` : m < 1440 ? `${m / 60} h` : "day");
const STRATEGY_HINT =
  "e.g. Keep weights close to target. If one stock runs up more than 10% in a week, trim it back and explain why. Never change fees.";

function RunIcon({ status }: { status: Run["status"] }) {
  if (status === "running")
    return <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Running" />;
  if (status === "ok") return <Check className="size-4 text-up" aria-label="Acted" />;
  if (status === "noop")
    return <Minus className="size-4 text-muted-foreground" aria-label="No action" />;
  return <X className="size-4 text-down" aria-label="Error" />;
}

export function AutopilotPanel({
  wallet,
  owner,
  indexes,
}: {
  wallet: string;
  owner: string;
  indexes: AgentIndexRef[];
}) {
  const qc = useQueryClient();
  const key = ["autopilot", wallet];
  const q = useQuery({
    queryKey: key,
    queryFn: () => api<Autopilot>(`/api/me/agents/${wallet}/autopilot`),
    refetchInterval: (query) => (query.state.data?.runs[0]?.status === "running" ? 3_000 : 20_000),
  });
  const [strategy, setStrategy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the draft when the saved strategy changes
  useEffect(() => setStrategy(null), [q.data?.strategy]);

  const save = async (
    patch: Partial<Pick<Autopilot, "enabled" | "intervalMinutes" | "strategy" | "indexes">>,
  ) => {
    setBusy(true);
    try {
      const r = await socialWrite<Autopilot>(qc, owner, `/api/me/agents/${wallet}/autopilot`, {
        method: "PUT",
        body: JSON.stringify(patch),
      });
      qc.setQueryData(key, r);
      return r;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
      return null;
    } finally {
      setBusy(false);
    }
  };
  const runNow = async () => {
    setBusy(true);
    try {
      await socialWrite(qc, owner, `/api/me/agents/${wallet}/autopilot/run`, { method: "POST" });
      toast.success("Queued: the agent runs within a minute");
      void q.refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start a run");
    } finally {
      setBusy(false);
    }
  };

  if (q.isLoading) return <p className="text-xs text-muted-foreground">Loading autopilot…</p>;
  if (q.isError || !q.data)
    return <p className="text-xs text-muted-foreground">Autopilot is unavailable right now.</p>;
  const a = q.data;
  const draft = strategy ?? a.strategy;
  const toggleIndex = (pk: string) => {
    // An empty list means "every index it manages": switching one off keeps the others on.
    const current = a.indexes.length ? a.indexes : indexes.map((i) => i.pubkey);
    const next = current.includes(pk) ? current.filter((x) => x !== pk) : [...current, pk];
    if (!next.length) {
      toast.error("Keep at least one index, or turn Autopilot off");
      return;
    }
    // All selected again: store the empty list so new indexes are included automatically.
    void save({ indexes: next.length === indexes.length ? [] : next });
  };

  return (
    <div className="flex flex-col gap-4 rounded-xl border p-4" data-testid="autopilot">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex flex-col">
          <Label htmlFor={`ap-${wallet}`} className="text-sm font-medium">
            Autopilot
          </Label>
          <span className="text-xs text-muted-foreground">
            {!a.available
              ? (a.reason ?? "Not available on this server")
              : a.enabled
                ? `Runs every ${every(a.intervalMinutes)}${a.nextRunAt ? ` · next ${ago(a.nextRunAt).replace(" ago", "")}` : ""}`
                : indexes.length
                  ? "Off. Turn it on and the platform runs this agent on a schedule."
                  : "Needs an index to manage first (see below)."}
          </span>
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || !a.available || !indexes.length || a.runs[0]?.status === "running"}
            onClick={() => void runNow()}
            data-testid="autopilot-run"
          >
            <Play />
            Run now
          </Button>
          <Switch
            id={`ap-${wallet}`}
            checked={a.enabled}
            disabled={busy || !a.available || (!a.enabled && !indexes.length)}
            onCheckedChange={(v) => void save({ enabled: v })}
            aria-label="Autopilot"
            data-testid="autopilot-toggle"
          />
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Check every</Label>
          <Select
            value={String(a.intervalMinutes)}
            onValueChange={(v) => void save({ intervalMinutes: Number(v) })}
            disabled={busy}
          >
            <SelectTrigger className="h-9 w-full" aria-label="Check every">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INTERVALS.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {every(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Indexes</Label>
          {indexes.length ? (
            <div className="flex flex-wrap gap-1.5">
              {indexes.map((i) => {
                const on = a.indexes.length === 0 || a.indexes.includes(i.pubkey);
                return (
                  <button
                    key={i.pubkey}
                    type="button"
                    disabled={busy}
                    onClick={() => toggleIndex(i.pubkey)}
                    className={cn(
                      "mono inline-flex h-7 items-center gap-1.5 rounded-sm border px-2 text-xs transition-colors",
                      on ? "border-foreground/40 text-foreground" : "text-muted-foreground",
                    )}
                    aria-pressed={on}
                  >
                    {on ? <Check className="size-3" /> : <Circle className="size-3" />}
                    {i.symbol}
                  </button>
                );
              })}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">
              Add this agent as a manager of an index first (Manage → Managers &amp; AI agents).
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`st-${wallet}`} className="text-xs text-muted-foreground">
          Strategy (plain words; the program still enforces the mandate)
        </Label>
        <Textarea
          id={`st-${wallet}`}
          value={draft}
          onChange={(e) => setStrategy(e.target.value)}
          maxLength={1000}
          placeholder={STRATEGY_HINT}
          className="min-h-20 text-sm"
          data-testid="autopilot-strategy"
        />
        {strategy !== null && strategy !== a.strategy ? (
          <Button
            size="sm"
            className="self-end"
            disabled={busy}
            onClick={() => void save({ strategy: draft }).then((r) => r && setStrategy(null))}
          >
            Save strategy
          </Button>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-xs text-muted-foreground">
          Recent runs{a.model ? ` · ${a.model}` : ""}
        </span>
        {a.runs.length ? (
          <ul className="flex flex-col divide-y rounded-lg border text-sm">
            {a.runs.map((r) => (
              <li key={r.id} className="flex flex-col gap-1 px-3 py-2">
                <span className="flex items-start gap-2">
                  <RunIcon status={r.status} />
                  <span className="min-w-0 flex-1">{r.summary || "Running…"}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{ago(r.startedAt)}</span>
                </span>
                {r.actions.length ? (
                  <ul className="flex flex-wrap gap-1 pl-6">
                    {r.actions.map((x, i) => (
                      <li
                        // biome-ignore lint/suspicious/noArrayIndexKey: actions have no id, order is stable
                        key={i}
                        title={x.detail}
                        className={cn(
                          "mono rounded-sm border px-1.5 text-[11px]",
                          x.ok ? "text-muted-foreground" : "border-down/40 text-down",
                        )}
                      >
                        {x.tool}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-xs text-muted-foreground">No runs yet.</span>
        )}
      </div>
    </div>
  );
}
