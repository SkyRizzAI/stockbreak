"use client";
/**
 * Centered progress overlay for multi-step transaction flows (join, redeem,
 * create, manage). A progress ring, the flow's phases with live state, links to
 * every landed transaction, and a clear success / failure / partial ending.
 * It can be hidden to a corner pill while the flow keeps running.
 */
import { cn } from "cn";
import { ArrowUpRight, Check, TriangleAlert, X } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { txUrl } from "@/lib/solana";
import { type TxPhase, txOverlay, useTxOverlay } from "@/lib/tx-overlay";

const R = 30;
const C = 2 * Math.PI * R;

function Ring({ pct, status }: { pct: number; status: string }) {
  const running = status === "running";
  const color =
    status === "error" ? "var(--down)" : status === "partial" ? "var(--warn)" : "var(--primary)";
  return (
    <div className="relative size-20 shrink-0">
      <svg viewBox="0 0 72 72" className="size-20 -rotate-90" aria-hidden>
        <circle cx="36" cy="36" r={R} fill="none" stroke="var(--border)" strokeWidth="4" />
        <circle
          cx="36"
          cy="36"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - Math.min(1, Math.max(running ? 0.06 : 0, pct)))}
          style={{ transition: "stroke-dashoffset 700ms cubic-bezier(.2,.8,.2,1), stroke 300ms" }}
        />
      </svg>
      {/* A slow orbiting arc keeps the ring alive while a wallet or the chain is working. */}
      {running ? (
        <svg
          viewBox="0 0 72 72"
          className="absolute inset-0 size-20 animate-spin"
          aria-hidden
          style={{ animationDuration: "2.4s" }}
        >
          <circle
            cx="36"
            cy="36"
            r={R}
            fill="none"
            stroke="var(--primary)"
            strokeOpacity="0.35"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${C * 0.08} ${C}`}
          />
        </svg>
      ) : null}
      <div className="absolute inset-0 flex items-center justify-center">
        {status === "success" ? (
          <Check className="size-8 text-primary animate-in zoom-in-50 fade-in duration-300" />
        ) : status === "error" ? (
          <X className="size-8 text-down animate-in zoom-in-50 fade-in duration-300" />
        ) : status === "partial" ? (
          <TriangleAlert className="size-7 text-warn animate-in zoom-in-50 fade-in duration-300" />
        ) : (
          <span className="num text-base font-semibold">{Math.round(pct * 100)}%</span>
        )}
      </div>
    </div>
  );
}

function PhaseRow({
  p,
  last,
  note,
  auto,
}: {
  p: TxPhase;
  last: boolean;
  note: string | null;
  auto: boolean;
}) {
  return (
    <li className="relative flex gap-3 pb-4 last:pb-0">
      {last ? null : (
        <span
          className={cn(
            "absolute top-6 left-[11px] h-[calc(100%-1.25rem)] w-px transition-colors duration-500",
            p.state === "done" ? "bg-primary/60" : "bg-border",
          )}
          aria-hidden
        />
      )}
      <span
        className={cn(
          "relative flex size-6 shrink-0 items-center justify-center rounded-full border transition-all duration-300",
          p.state === "done" && "border-primary bg-primary text-primary-foreground",
          p.state === "active" && "border-primary",
          p.state === "pending" && "border-border",
        )}
        aria-hidden
      >
        {p.state === "done" ? (
          <Check className="size-3.5 animate-in zoom-in-50 duration-200" />
        ) : p.state === "active" ? (
          <>
            <span className="absolute inset-0 animate-ping rounded-full border border-primary/40" />
            <span className="size-2 rounded-full bg-primary" />
          </>
        ) : (
          <span className="size-1.5 rounded-full bg-muted-foreground/40" />
        )}
      </span>
      <span
        className={cn(
          "pt-0.5 text-sm transition-colors duration-300",
          p.state === "pending" ? "text-muted-foreground" : "text-foreground",
          p.state === "active" && "font-medium",
        )}
      >
        {p.label}
        {p.state === "active" ? (
          <span className="block text-xs font-normal text-muted-foreground animate-in fade-in">
            {note ?? (auto ? "Working…" : "Approve in your wallet, then it confirms on chain")}
          </span>
        ) : null}
      </span>
    </li>
  );
}

export function TxOverlay() {
  const s = useTxOverlay();
  const pct = s.total > 0 ? s.done / s.total : s.status === "success" ? 1 : 0;

  // Esc hides a running flow (it keeps going) and closes a finished one.
  useEffect(() => {
    if (!s.open || s.minimized) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (s.status === "running") txOverlay.minimize(true);
      else txOverlay.close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s.open, s.minimized, s.status]);

  if (!s.open) return null;

  if (s.minimized)
    return (
      <button
        type="button"
        onClick={() => txOverlay.minimize(false)}
        className="fixed right-4 bottom-20 z-50 flex items-center gap-3 rounded-full border bg-surface py-2 pr-4 pl-2 text-sm shadow-lg animate-in fade-in slide-in-from-bottom-2 md:bottom-4"
        data-testid="tx-pill"
      >
        <span className="relative flex size-7 items-center justify-center">
          <span className="absolute inset-0 animate-spin rounded-full border-2 border-border border-t-primary" />
        </span>
        <span className="flex flex-col items-start leading-tight">
          <span className="font-medium">{s.title}</span>
          <span className="num text-xs text-muted-foreground">
            {s.total > 0 ? `Step ${Math.min(s.done + 1, s.total)} of ${s.total}` : "In progress"}
          </span>
        </span>
      </button>
    );

  const running = s.status === "running";
  const subtitle = running
    ? s.auto
      ? "This takes a few seconds. No approvals needed."
      : "Approve each step in your wallet. Keep this tab open until it finishes."
    : s.message;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm animate-in fade-in duration-200"
      data-testid="tx-overlay"
      data-status={s.status}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tx-title"
        className="flex w-full max-w-md flex-col gap-5 rounded-2xl border bg-surface p-6 shadow-2xl animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-300"
      >
        <div className="flex items-center gap-4">
          <Ring pct={pct} status={s.status} />
          <div className="flex min-w-0 flex-col gap-1" aria-live="polite">
            <h2 id="tx-title" className="text-lg font-semibold tracking-tight">
              {s.status === "success"
                ? "Done"
                : s.status === "error"
                  ? "Something went wrong"
                  : s.status === "partial"
                    ? "Partly done"
                    : s.title}
            </h2>
            <p
              className={cn(
                "text-sm",
                s.status === "error" ? "text-down" : "text-muted-foreground",
              )}
            >
              {subtitle}
            </p>
          </div>
        </div>

        <ol className="flex flex-col rounded-xl border bg-background/40 p-4">
          {s.phases.map((p, i) => (
            <PhaseRow
              key={p.key}
              p={p}
              last={i === s.phases.length - 1}
              note={s.status === "running" ? s.note : null}
              auto={s.auto}
            />
          ))}
        </ol>

        {s.detail ? <p className="text-xs text-muted-foreground">{s.detail}</p> : null}

        {s.signatures.length ? (
          <div className="flex flex-wrap gap-1.5">
            {s.signatures.map((sig, i) => (
              <a
                key={sig}
                href={txUrl(sig)}
                target="_blank"
                rel="noreferrer"
                className="num inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                Tx {i + 1}
                <ArrowUpRight className="size-3" />
              </a>
            ))}
          </div>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          {s.actions.map((a, i) => (
            <Button
              key={a.label}
              variant={i === 0 ? "default" : "outline"}
              onClick={() => {
                txOverlay.close();
                a.onClick();
              }}
            >
              {a.label}
            </Button>
          ))}
          {running ? (
            <Button variant="outline" onClick={() => txOverlay.minimize(true)}>
              Hide
            </Button>
          ) : (
            <Button
              variant={s.actions.length ? "outline" : "default"}
              onClick={() => txOverlay.close()}
              data-testid="tx-close"
            >
              Close
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
