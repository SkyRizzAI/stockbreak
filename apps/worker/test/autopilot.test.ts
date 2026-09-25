import { describe, expect, test } from "bun:test";
import { autopilotAvailability } from "../src/loops/autopilot";

const SECRET = "s".repeat(32);

describe("autopilot availability", () => {
  test("on with an LLM key and AGENT_KEY_SECRET", () => {
    const a = autopilotAvailability(
      { AGENT_KEY_SECRET: SECRET, AUTOPILOT_ENABLED: undefined },
      { OPENROUTER_API_KEY: "k-123456789", AGENT_LLM_MODEL: "m" },
    );
    expect(a).toMatchObject({ enabled: true, reason: null });
    expect(a.llm.model).toBe("m");
  });

  test("off without key, secret, or when disabled; reasons never contain the key", () => {
    const key = { AGENT_LLM_API_KEY: "sk-secret-123456" };
    const off = autopilotAvailability(
      { AGENT_KEY_SECRET: SECRET, AUTOPILOT_ENABLED: "false" },
      key,
    );
    expect(off.enabled).toBe(false);
    const noSecret = autopilotAvailability(
      { AGENT_KEY_SECRET: "short", AUTOPILOT_ENABLED: "1" },
      key,
    );
    expect(noSecret.reason).toContain("AGENT_KEY_SECRET");
    const noKey = autopilotAvailability(
      { AGENT_KEY_SECRET: SECRET, AUTOPILOT_ENABLED: undefined },
      {},
    );
    expect(noKey.reason).toContain("AGENT_LLM_API_KEY");
    for (const r of [off, noSecret, noKey]) expect(r.reason ?? "").not.toContain("sk-secret");
  });
});
