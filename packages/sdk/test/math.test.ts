/** Parity with anchor/crates/index_math (A12): SDK math must equal on-chain math. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as m from "../src/math";

type V = Record<string, unknown> & { fn: string; out: unknown };
const vectors = JSON.parse(
  readFileSync(
    path.resolve(import.meta.dir, "../../../anchor/crates/index_math/vectors/math.json"),
    "utf8",
  ),
) as V[];

const B = (x: unknown) => BigInt(x as string);
const S = (x: bigint | null) => (x === null ? null : x.toString());
const P = (price: unknown, expo: unknown) => ({ price: B(price), expo: expo as number });

describe("math parity with index_math", () => {
  for (const [i, v] of vectors.entries()) {
    test(`${i} ${v.fn}`, () => {
      switch (v.fn) {
        case "mult_fp_from_f64":
          expect(S(m.multFpFromF64(v.m as number))).toEqual(v.out as string | null);
          break;
        case "value_usd":
          expect(
            S(m.valueUsd(B(v.raw), v.decimals as number, B(v.mult_fp), P(v.price, v.expo))),
          ).toEqual(v.out as string | null);
          break;
        case "raw_for_value":
          expect(
            S(m.rawForValue(B(v.value), v.decimals as number, B(v.mult_fp), P(v.price, v.expo))),
          ).toEqual(v.out as string | null);
          break;
        case "swap_out":
          expect(
            S(
              m.swapOut(
                B(v.amount_in),
                v.in_decimals as number,
                B(v.in_mult_fp),
                P(v.in_price, v.in_expo),
                v.out_decimals as number,
                B(v.out_mult_fp),
                P(v.out_price, v.out_expo),
                v.spread_bps as number,
              ),
            ),
          ).toEqual(v.out as string | null);
          break;
        case "join_proportional": {
          const r = m.joinProportional(
            (v.max_amounts as string[]).map(B),
            (v.balances as string[]).map(B),
            B(v.supply),
          );
          const out = v.out as { shares_total: string | null; amounts: string[] };
          expect(S(r?.sharesTotal ?? null)).toEqual(out.shares_total);
          expect((r?.amounts ?? []).map(String)).toEqual(out.amounts);
          break;
        }
        case "redeem_amount":
          expect(S(m.redeemAmount(B(v.net), B(v.balance), B(v.supply)))).toEqual(
            v.out as string | null,
          );
          break;
        case "bps_of":
          expect(S(m.bpsOf(B(v.amount), v.bps as number))).toEqual(v.out as string | null);
          break;
        case "accrue_fees": {
          const r = m.accrueFees(
            B(v.supply),
            B(v.elapsed),
            v.mgmt as number,
            v.platform as number,
            v.royalty as number,
            v.has_parent as boolean,
          );
          expect(r?.map(String) ?? null).toEqual(v.out as string[] | null);
          break;
        }
        case "drift":
          expect(m.drift((v.values as string[]).map(B), v.targets as number[])).toEqual(
            v.out as [number, number],
          );
          break;
        case "share_price":
          expect(S(m.sharePrice(B(v.nav), B(v.supply)))).toEqual(v.out as string);
          break;
        case "convert_amount":
          expect(S(m.convertAmount(B(v.amount), B(v.num), B(v.den)))).toEqual(v.out as string);
          break;
        default:
          throw new Error(`unknown vector fn ${v.fn}`);
      }
    });
  }
});
