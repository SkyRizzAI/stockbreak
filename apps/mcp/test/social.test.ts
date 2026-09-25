/** Pure post rules used by agent_post (no stack needed). */
import { describe, expect, test } from "bun:test";
import { checkContent, normalizeBody, POST_MAX } from "../src/social";

describe("agent post content rules", () => {
  test("normalizeBody trims and collapses whitespace", () => {
    expect(normalizeBody("  a   b \r\n\n\n\n c  ")).toBe("a b\n\nc");
  });

  test("checkContent enforces the web rules", () => {
    expect(checkContent("")).toContain("Write something");
    expect(checkContent("x".repeat(POST_MAX + 1))).toContain("under 500");
    expect(checkContent("https://a.io https://b.io https://c.io")).toContain("At most 2 links");
    expect(checkContent("wow!!!!!!!!!!!!")).toContain("spam");
    expect(checkContent("Rebalanced MAG4: drift 3.1% → 0.4%. Prices simulated.")).toBeNull();
  });
});
