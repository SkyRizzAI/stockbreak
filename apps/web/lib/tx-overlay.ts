"use client";
/**
 * State for the transaction progress overlay (components/shell/tx-overlay.tsx).
 * useRun() drives it; one run at a time. A tiny external store keeps the overlay
 * independent of which component started the run.
 */
import { useSyncExternalStore } from "react";

export type TxStatus = "running" | "success" | "error" | "partial";

export interface TxPhase {
  key: string;
  label: string;
  state: "pending" | "active" | "done";
}

export interface TxAction {
  label: string;
  onClick: () => void;
}

export interface TxState {
  open: boolean;
  /** Collapsed to the corner pill while it keeps running. */
  minimized: boolean;
  title: string;
  status: TxStatus;
  phases: TxPhase[];
  done: number;
  total: number;
  signatures: string[];
  message: string | null;
  detail: string | null;
  /** Transient note under the active phase (e.g. waiting for fresh prices). */
  note: string | null;
  /** Runs without wallet prompts (e.g. dev wallet setup): no "approve" hints. */
  auto: boolean;
  actions: TxAction[];
}

const EMPTY: TxState = {
  open: false,
  minimized: false,
  title: "",
  status: "running",
  phases: [],
  done: 0,
  total: 0,
  signatures: [],
  message: null,
  detail: null,
  note: null,
  auto: false,
  actions: [],
};

let state: TxState = EMPTY;
const listeners = new Set<() => void>();
const set = (patch: Partial<TxState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};

/** Phase key from a progress step ("deposit-swap" → "swap" inside the deposit). */
export function phaseLabel(step: string): string {
  const base = step.replace(/^deposit-/, "");
  const prefix = step.startsWith("deposit-") ? "Deposit · " : "";
  const map: Record<string, string> = {
    "lookup-table": "Prepare the address table",
    create: "Create the index on chain",
    manager: "Set the manager",
    prepare: "Prepare token accounts",
    swap: "Swap USDC into the index assets",
    wait: "Wait for fresh prices",
    join: "Deposit into the vault",
    redeem: "Redeem your shares",
    deposit: "First deposit",
    sol: "Get SOL for transaction fees",
    usdc: "Mint 10,000 test USDC",
  };
  return prefix + (map[base] ?? base.charAt(0).toUpperCase() + base.slice(1));
}

let closeTimer: ReturnType<typeof setTimeout> | null = null;

export const txOverlay = {
  start(title: string, steps: string[] = [], opts: { auto?: boolean } = {}) {
    if (closeTimer) clearTimeout(closeTimer);
    state = {
      ...EMPTY,
      open: true,
      title,
      auto: !!opts.auto,
      phases: (steps.length ? steps : ["confirm"]).map((key, i) => ({
        key,
        label: key === "confirm" ? "Confirm the transaction" : phaseLabel(key),
        state: i === 0 ? "active" : "pending",
      })),
    };
    for (const l of listeners) l();
  },
  progress(p: { step: string; done: number; total: number; signature?: string }) {
    // Waiting for the price feeder is a pause inside the current phase, not a phase.
    if (/(^|-)wait$/.test(p.step)) {
      set({ note: "Waiting for fresh prices…" });
      return;
    }
    // "wait" is a pause inside a phase, not a phase of its own when not planned.
    const phases = [...state.phases.filter((x) => x.key !== "confirm")];
    let idx = phases.findIndex((x) => x.key === p.step);
    if (idx < 0) {
      // An unplanned phase (e.g. token accounts that turned out to be missing) goes right
      // before the first phase that has not started yet, keeping the order true.
      const at = phases.findIndex((x) => x.state === "pending");
      idx = at < 0 ? phases.length : at;
      phases.splice(idx, 0, { key: p.step, label: phaseLabel(p.step), state: "pending" });
    }
    const next = phases.map((x, i) => ({
      ...x,
      state: i < idx ? "done" : i === idx ? "active" : x.state === "done" ? "done" : "pending",
    })) as TxPhase[];
    set({
      note: null,
      phases: next,
      done: p.done,
      total: p.total,
      signatures:
        p.signature && !state.signatures.includes(p.signature)
          ? [...state.signatures, p.signature]
          : state.signatures,
    });
  },
  success(message: string, signature?: string) {
    set({
      status: "success",
      message,
      done: Math.max(state.total, 1),
      total: Math.max(state.total, 1),
      phases: state.phases.map((x) => ({ ...x, state: "done" })),
      signatures:
        signature && !state.signatures.includes(signature)
          ? [...state.signatures, signature]
          : state.signatures,
    });
    // Success reads at a glance; get out of the way shortly after.
    closeTimer = setTimeout(() => txOverlay.close(), 1600);
  },
  fail(
    status: "error" | "partial",
    message: string,
    detail: string | null,
    actions: TxAction[] = [],
  ) {
    set({ status, message, detail, actions, minimized: false });
  },
  minimize(v: boolean) {
    set({ minimized: v });
  },
  close() {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = null;
    state = EMPTY;
    for (const l of listeners) l();
  },
};

export function useTxOverlay(): TxState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => EMPTY,
  );
}
