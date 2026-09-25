import { describe, expect, test } from "bun:test";
import { ASSETS } from "./assets";
import { parsePrestocks } from "./prestocks";

const row = {
  name: "SpaceX PreStocks",
  symbol: "SPACEX",
  external_url: "https://www.prestocks.com/spacex",
  contract_address: "PreANxuXjsy2pvisWWMNB6YaJNzr7681wJJr2rHsfTh",
  markPrice: 148,
  markValuation: 1_941_728_419_756,
  tokenPrice: 118.4,
  impliedValuation: 1_556_206_576_701,
  supply: 43712.5,
};

describe("parsePrestocks", () => {
  test("maps by mint and computes premium = token / mark - 1", () => {
    const m = parsePrestocks([row]);
    const q = m.get(row.contract_address);
    expect(q?.tokenPrice).toBe(118.4);
    expect(q?.markPrice).toBe(148);
    expect(q?.premium).toBeCloseTo(-0.2, 10);
    expect(q?.url).toBe(row.external_url);
  });

  test("skips invalid rows, throws on a non-array payload", () => {
    const m = parsePrestocks([row, { ...row, contract_address: "x", markPrice: 0 }, null]);
    expect(m.size).toBe(1);
    expect(() => parsePrestocks({ error: "down" })).toThrow();
  });
});

describe("pre-IPO registry", () => {
  test("every pre-IPO asset is a PreStocks token with a Pre… mainnet mint", () => {
    const pre = ASSETS.filter((a) => a.kind === "PreIpo");
    expect(pre.length).toBeGreaterThan(0);
    for (const a of pre) {
      expect(a.issuer?.name).toBe("PreStocks");
      expect(a.priceSource).toBe("prestocks");
      expect(a.mainnetMint?.startsWith("Pre")).toBe(true);
    }
  });
});
