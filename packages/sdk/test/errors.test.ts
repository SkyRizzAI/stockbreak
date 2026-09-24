/** errors.ts code tables must match the program enums (generated from the IDL). */
import { expect, test } from "bun:test";
import { parseFailure } from "../src/errors";
import * as vault from "../src/generated/index-vault";
import * as market from "../src/generated/mock-market";
import { INDEX_VAULT, MOCK_MARKET } from "../src/pda";

const pascal = (s: string) =>
  s
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");

function table(mod: Record<string, unknown>, prefix: string): [number, string][] {
  return Object.entries(mod)
    .filter(([k, v]) => k.startsWith(prefix) && typeof v === "number")
    .map(([k, v]) => [v as number, pascal(k.slice(prefix.length))] as [number, string])
    .sort((a, b) => a[0] - b[0]);
}

test("vault error codes decode to the right names", () => {
  for (const [code, name] of table(vault, "INDEX_VAULT_ERROR__")) {
    const logs = [`Program ${INDEX_VAULT} failed: custom program error: 0x${code.toString(16)}`];
    expect(parseFailure(new Error("x"), logs)?.name).toBe(name);
  }
});

test("market error codes decode to the right names", () => {
  for (const [code, name] of table(market, "MOCK_MARKET_ERROR__")) {
    const logs = [`Program ${MOCK_MARKET} failed: custom program error: 0x${code.toString(16)}`];
    expect(parseFailure(new Error("x"), logs)?.name).toBe(name);
  }
});
