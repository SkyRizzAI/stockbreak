import { describe, expect, test } from "bun:test";
import { applyDelta, reconcileDelta } from "@repo/db";
import { redact } from "../src/ctx";

describe("applyDelta (event-time position math)", () => {
  test("join then full redeem in one pass ends at zero, not negative", () => {
    const a = applyDelta(undefined, { addShares: 100n, addCostMicroUsd: 1_000n });
    expect(a).toEqual({ shares: 100n, costBasisMicroUsd: 1_000n });
    const b = applyDelta(a, { burnShares: 100n });
    expect(b).toEqual({ shares: 0n, costBasisMicroUsd: 0n });
  });

  test("join, join, partial redeem keeps pro-rata cost", () => {
    let p = applyDelta(undefined, { addShares: 100n, addCostMicroUsd: 1_000n });
    p = applyDelta(p, { addShares: 100n, addCostMicroUsd: 3_000n });
    p = applyDelta(p, { burnShares: 50n });
    expect(p).toEqual({ shares: 150n, costBasisMicroUsd: 3_000n });
  });

  test("burn larger than stored shares is capped", () => {
    const p = applyDelta({ shares: 10n, costBasisMicroUsd: 500n }, { burnShares: 25n });
    expect(p).toEqual({ shares: 0n, costBasisMicroUsd: 0n });
  });
});

describe("reconcileDelta (chain balance is final)", () => {
  test("transfer out scales cost down", () => {
    expect(reconcileDelta({ shares: 100n, costBasisMicroUsd: 1_000n }, 40n, 5_000_000n)).toEqual({
      shares: 40n,
      costBasisMicroUsd: 400n,
    });
  });
  test("transfer in adds cost at current share price", () => {
    expect(reconcileDelta({ shares: 100n, costBasisMicroUsd: 1_000n }, 150n, 2_000_000n)).toEqual({
      shares: 150n,
      costBasisMicroUsd: 1_100n,
    });
  });
  test("unknown holder starts at market value; zero balance clears", () => {
    expect(reconcileDelta(undefined, 10n, 3_000_000n).costBasisMicroUsd).toBe(30n);
    expect(reconcileDelta({ shares: 5n, costBasisMicroUsd: 9n }, 0n, 1n).shares).toBe(0n);
  });
});

describe("redact", () => {
  test("hides api keys, tokens, url passwords and known secrets", () => {
    const msg =
      "fetch https://rpc.example/?api-key=abc123&x=1 https://f.io/q?symbol=A&token=zzz postgres://u:pw@h/db SECRETVALUE1";
    const out = redact(msg, ["SECRETVALUE1"]);
    expect(out).not.toContain("abc123");
    expect(out).not.toContain("zzz");
    expect(out).not.toContain(":pw@");
    expect(out).not.toContain("SECRETVALUE1");
    expect(out).toContain("x=1");
  });
});
