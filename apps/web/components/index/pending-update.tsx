"use client";
/** Scheduled (timelocked) index update: chain clock hook, summary and public banner. */
import { CalendarClock } from "lucide-react";
import { useEffect, useState } from "react";
import { bps, duration } from "@/lib/format";
import type { IndexDetail, PendingUpdateJson } from "@/lib/types";

/**
 * Chain time ticking once a second. The offset to the local clock is
 * recomputed whenever the server reports a new `chainNow` (warps, drift).
 */
export function useChainNow(chainNow: number): number {
  const [now, setNow] = useState(chainNow);
  useEffect(() => {
    const offset = chainNow - Math.floor(Date.now() / 1000);
    setNow(chainNow);
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000) + offset), 1000);
    return () => clearInterval(t);
  }, [chainNow]);
  return now;
}

/** One line per changed part of a pending update. */
export function pendingLines(p: PendingUpdateJson): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  if (p.assets)
    out.push({
      label: "Weights",
      value: p.assets
        .filter((a) => a.targetWeightBps > 0)
        .map((a) => `${a.symbol} ${bps(a.targetWeightBps)}`)
        .join(", "),
    });
  if (p.fees)
    out.push({
      label: "Fees",
      value: `mgmt ${bps(p.fees.mgmtFeeBps)} / yr, entry ${bps(p.fees.entryFeeBps)}, exit ${bps(p.fees.exitFeeBps)}`,
    });
  if (p.strategy) {
    const s = p.strategy;
    const rule =
      s.mode === "Threshold"
        ? `drift > ${bps(s.driftThresholdBps)}`
        : s.mode === "Periodic"
          ? `every ${duration(s.periodSecs)}`
          : "manual";
    out.push({
      label: "Strategy",
      value: `${s.mode} (${rule}), slippage ${bps(s.maxSlippageBps)}, cooldown ${duration(s.cooldownSecs)}, keeper ${s.allowKeeper ? "on" : "off"}`,
    });
  }
  return out;
}

/** Public notice on the index page: holders see what will change and when. */
export function PendingBanner({ d }: { d: IndexDetail }) {
  const now = useChainNow(d.chainNow);
  if (!d.pending) return null;
  const left = d.pending.eta - now;
  return (
    <div
      className="flex flex-col gap-2 rounded-2xl border p-4 text-sm"
      data-testid="pending-banner"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-medium">
          <CalendarClock className="size-4 text-warn" />
          Scheduled change
        </span>
        <span className="num text-xs text-muted-foreground">
          {left > 0 ? `Can apply in ${duration(left)}` : "Can be applied now"}
        </span>
      </div>
      <ul className="flex flex-col gap-1">
        {pendingLines(d.pending).map((l) => (
          <li key={l.label} className="flex flex-wrap gap-x-2">
            <span className="text-muted-foreground">{l.label}</span>
            <span className="num">{l.value}</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        The creator proposed this update. It takes effect only after the timelock and once applied.
      </p>
    </div>
  );
}
