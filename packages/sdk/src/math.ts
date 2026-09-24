/**
 * Bit-for-bit port of `anchor/crates/index_math` (PLAN §6). All amounts are
 * bigint; functions return `null` where Rust returns `None`.
 * Parity is enforced by `test/math.test.ts` against `vectors/math.json`.
 */

export const MULT_FP = 1_000_000_000_000n;
export const BPS = 10_000n;
export const YEAR_SECS = 31_536_000n;
export const FEE_FP = 1_000_000_000_000n;
const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
const USD_DECIMALS = 6;

export interface Price {
  price: bigint;
  expo: number;
}

const u64 = (v: bigint): bigint | null => (v < 0n || v > U64_MAX ? null : v);
const chk = (v: bigint): bigint | null => (v < 0n || v > U128_MAX ? null : v);

/** Float multiplier → fixed point, round half up (== Rust mult_fp_from_f64). */
export function multFpFromF64(m: number): bigint | null {
  if (!(Number.isFinite(m) && m > 0)) return null;
  const v = m * 1e12;
  if (v >= 1e30) return null;
  const floor = Math.floor(v);
  const frac = v - floor;
  return BigInt(floor) + (frac >= 0.5 ? 1n : 0n);
}

const pow10 = (e: number): bigint => 10n ** BigInt(e);

export function scaleRaw(raw: bigint, multFp: bigint): bigint | null {
  const v = chk(raw * multFp);
  return v === null ? null : v / MULT_FP;
}

/** value in micro-USD, floored (PLAN §6.3). */
export function valueUsd(raw: bigint, decimals: number, multFp: bigint, p: Price): bigint | null {
  if (p.price <= 0n) return null;
  const scaled = scaleRaw(raw, multFp);
  if (scaled === null) return null;
  const num = chk(scaled * p.price);
  if (num === null) return null;
  const shift = decimals - (p.expo + USD_DECIMALS);
  const v = shift >= 0 ? num / pow10(shift) : chk(num * pow10(-shift));
  return v === null ? null : u64(v);
}

export function rawForValue(
  value: bigint,
  decimals: number,
  multFp: bigint,
  p: Price,
): bigint | null {
  if (p.price <= 0n || multFp === 0n) return null;
  const shift = decimals - (p.expo + USD_DECIMALS);
  const scaled = shift >= 0 ? chk(value * pow10(shift)) : value / pow10(-shift);
  if (scaled === null) return null;
  const s2 = scaled / p.price;
  const raw = chk(s2 * MULT_FP);
  return raw === null ? null : u64(raw / multFp);
}

export function swapOut(
  amountIn: bigint,
  inDecimals: number,
  inMultFp: bigint,
  inPrice: Price,
  outDecimals: number,
  outMultFp: bigint,
  outPrice: Price,
  spreadBps: number,
): bigint | null {
  const vIn = valueUsd(amountIn, inDecimals, inMultFp, inPrice);
  if (vIn === null) return null;
  const vNet = (vIn * (BPS - BigInt(spreadBps))) / BPS;
  if (u64(vNet) === null) return null;
  return rawForValue(vNet, outDecimals, outMultFp, outPrice);
}

export function ceilDiv(a: bigint, b: bigint): bigint | null {
  if (b === 0n) return null;
  return a % b === 0n ? a / b : a / b + 1n;
}

export function joinProportional(
  maxAmounts: bigint[],
  balances: bigint[],
  supply: bigint,
): { sharesTotal: bigint; amounts: bigint[] } | null {
  const n = balances.length;
  if (n !== maxAmounts.length || n > 16 || supply === 0n) return null;
  let shares: bigint | null = null;
  for (let i = 0; i < n; i++) {
    const b = balances[i] as bigint;
    if (b === 0n) continue;
    const s = ((maxAmounts[i] as bigint) * supply) / b;
    if (chk(s) === null) return null;
    shares = shares === null || s < shares ? s : shares;
  }
  if (shares === null) return null;
  const amounts: bigint[] = [];
  for (let i = 0; i < n; i++) {
    const b = balances[i] as bigint;
    if (b === 0n) {
      amounts.push(0n);
      continue;
    }
    const a = ceilDiv(shares * b, supply);
    if (a === null || u64(a) === null) return null;
    amounts.push(a);
  }
  const st = u64(shares);
  return st === null ? null : { sharesTotal: st, amounts };
}

export function redeemAmount(net: bigint, balance: bigint, supply: bigint): bigint | null {
  if (supply === 0n) return null;
  return u64((net * balance) / supply);
}

export function bpsOf(amount: bigint, bps: number): bigint | null {
  return u64((amount * BigInt(bps)) / BPS);
}

export function accrueFees(
  supply: bigint,
  elapsed: bigint,
  mgmtFeeBps: number,
  platformFeeBps: number,
  cloneRoyaltyBps: number,
  hasParent: boolean,
): [bigint, bigint, bigint] | null {
  const rate = BigInt(mgmtFeeBps + platformFeeBps);
  if (rate === 0n || elapsed <= 0n || supply === 0n) return [0n, 0n, 0n];
  let fFp = (rate * elapsed * FEE_FP) / (BPS * YEAR_SECS);
  if (fFp > FEE_FP / 2n) fFp = FEE_FP / 2n;
  const created = (supply * fFp) / (FEE_FP - fFp);
  let creator = (created * BigInt(mgmtFeeBps)) / rate;
  const platform = created - creator;
  let parent = 0n;
  if (hasParent) {
    parent = (creator * BigInt(cloneRoyaltyBps)) / BPS;
    creator -= parent;
  }
  if (u64(creator) === null || u64(platform) === null || u64(parent) === null) return null;
  return [creator, platform, parent];
}

export function weightBps(value: bigint, nav: bigint): number {
  if (nav === 0n) return 0;
  return Number((value * BPS) / nav);
}

/** [sum |w - t|, max |w - t|] in bps. */
export function drift(values: bigint[], targets: number[]): [number, number] | null {
  if (values.length !== targets.length) return null;
  const nav = values.reduce((a, b) => a + b, 0n);
  let sum = 0;
  let max = 0;
  values.forEach((v, i) => {
    const w = weightBps(v, nav);
    const d = Math.abs(w - (targets[i] as number));
    sum += d;
    if (d > max) max = d;
  });
  return [sum, max];
}

export function sharePrice(nav: bigint, supply: bigint): bigint {
  if (supply === 0n) return 0n;
  return (nav * 1_000_000n) / supply;
}

export function convertAmount(amount: bigint, num: bigint, den: bigint): bigint | null {
  if (den === 0n) return null;
  return u64((amount * num) / den);
}
