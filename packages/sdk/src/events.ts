/**
 * Decode Anchor `emit!` events from transaction logs (A07). Only lines emitted
 * while index_vault is the executing program are considered.
 */
import { getBase64Encoder, type ReadonlyUint8Array } from "@solana/kit";
import * as vault from "./generated/index-vault";
import { INDEX_VAULT } from "./pda";

const INVOKE = /^Program (\w+) invoke \[(\d+)\]$/;
const EXIT = /^Program (\w+) (success|failed)/;
const DATA = "Program data: ";

export function programDataFromLogs(
  logs: readonly string[],
  programId: string = INDEX_VAULT,
): ReadonlyUint8Array[] {
  const stack: string[] = [];
  const out: ReadonlyUint8Array[] = [];
  const b64 = getBase64Encoder();
  for (const line of logs) {
    const inv = INVOKE.exec(line);
    if (inv) {
      stack.push(inv[1] as string);
      continue;
    }
    if (EXIT.test(line)) {
      stack.pop();
      continue;
    }
    if (line.startsWith(DATA) && stack.at(-1) === programId) {
      try {
        out.push(b64.encode(line.slice(DATA.length)));
      } catch {
        // malformed line
      }
    }
  }
  return out;
}

const PARSERS = {
  [vault.IndexVaultEvent.ConfigUpdated]: ["ConfigUpdated", vault.parseConfigUpdatedEvent],
  [vault.IndexVaultEvent.FeesAccrued]: ["FeesAccrued", vault.parseFeesAccruedEvent],
  [vault.IndexVaultEvent.FeesClaimed]: ["FeesClaimed", vault.parseFeesClaimedEvent],
  [vault.IndexVaultEvent.IndexCreated]: ["IndexCreated", vault.parseIndexCreatedEvent],
  [vault.IndexVaultEvent.IndexUpdateCancelled]: [
    "IndexUpdateCancelled",
    vault.parseIndexUpdateCancelledEvent,
  ],
  [vault.IndexVaultEvent.IndexUpdated]: ["IndexUpdated", vault.parseIndexUpdatedEvent],
  [vault.IndexVaultEvent.IndexUpdateProposed]: [
    "IndexUpdateProposed",
    vault.parseIndexUpdateProposedEvent,
  ],
  [vault.IndexVaultEvent.IpoMigrated]: ["IpoMigrated", vault.parseIpoMigratedEvent],
  [vault.IndexVaultEvent.Joined]: ["Joined", vault.parseJoinedEvent],
  [vault.IndexVaultEvent.ManagersSet]: ["ManagersSet", vault.parseManagersSetEvent],
  [vault.IndexVaultEvent.PausedSet]: ["PausedSet", vault.parsePausedSetEvent],
  [vault.IndexVaultEvent.RebalanceExecuted]: [
    "RebalanceExecuted",
    vault.parseRebalanceExecutedEvent,
  ],
  [vault.IndexVaultEvent.Redeemed]: ["Redeemed", vault.parseRedeemedEvent],
  [vault.IndexVaultEvent.TargetsSynced]: ["TargetsSynced", vault.parseTargetsSyncedEvent],
} as const;

export type VaultEventName = (typeof PARSERS)[keyof typeof PARSERS][0];

export interface DecodedEvent {
  name: VaultEventName;
  data: Record<string, unknown>;
  /** Position of the event within the transaction (stable id with the signature). */
  ordinal: number;
}

export function decodeVaultEvents(logs: readonly string[]): DecodedEvent[] {
  const out: DecodedEvent[] = [];
  for (const bytes of programDataFromLogs(logs)) {
    let kind: vault.IndexVaultEvent;
    try {
      kind = vault.identifyIndexVaultEvent(bytes);
    } catch {
      continue;
    }
    const [name, parse] = PARSERS[kind];
    const data = (parse as (b: ReadonlyUint8Array) => Record<string, unknown>)(bytes);
    const { discriminator: _d, ...rest } = data as Record<string, unknown> & {
      discriminator?: unknown;
    };
    out.push({ name, data: rest, ordinal: out.length });
  }
  return out;
}

/** JSON-safe copy (bigint → string, Uint8Array → array, Option → value|null). */
export function toJson(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Array.from(value);
  if (Array.isArray(value)) return value.map(toJson);
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if ("__option" in o) return o.__option === "Some" ? toJson(o.value) : null;
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toJson(v)]));
  }
  return value;
}
