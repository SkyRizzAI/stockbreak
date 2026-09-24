/** errors.ts code tables must match the program enums (generated from the IDL). */
import { expect, test } from "bun:test";
import { humanizeError, parseFailure, TxFailedError } from "../src/errors";
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

test("bare Custom code without logs is not guessed as a vault error", () => {
  const e = new Error('Transaction x failed on chain: {"InstructionError":[1,{"Custom":6005}]}');
  expect(parseFailure(e)).toBeNull();
  expect(humanizeError(e)).toBe("Transaction failed. Please try again.");
});

test("on-chain failure with fetched logs names the market error", () => {
  const e = new TxFailedError('failed: {"InstructionError":[1,{"Custom":6005}]}', "sig", [
    `Program ${MOCK_MARKET} invoke [1]`,
    "Program log: AnchorError occurred. Error Code: OracleStale. Error Number: 6005.",
    `Program ${MOCK_MARKET} failed: custom program error: 0x1775`,
  ]);
  const f = parseFailure(e);
  expect(f?.program).toBe("mock_market");
  expect(f?.name).toBe("OracleStale");
});

test("wallet disconnect is recognised", () => {
  expect(humanizeError(new Error("Dev wallet not connected"))).toBe(
    "Wallet disconnected. Reconnect and try again.",
  );
});
