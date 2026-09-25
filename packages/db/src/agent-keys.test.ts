import { afterAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import {
  agentKeySecret,
  createAgentWallet,
  createApiKey,
  decryptSecret,
  encryptSecret,
  generateApiKey,
  hashApiKey,
  isApiKeyFormat,
  listOwnerAgents,
  MAX_AGENTS_PER_OWNER,
  MAX_KEYS_PER_AGENT,
  resolveApiKey,
  revokeApiKey,
} from "./agent-keys";
import { closeDb, getDb } from "./client";
import { agentWallets, apiKeys } from "./schema";

const SECRET = "s".repeat(32);

describe("agent seed encryption", () => {
  test("roundtrip", () => {
    const seed = new Uint8Array(randomBytes(32));
    const enc = encryptSecret(seed, SECRET);
    expect(enc).not.toContain(Buffer.from(seed).toString("base64"));
    expect(Buffer.from(enc, "base64").length).toBe(12 + 16 + 32);
    expect(decryptSecret(enc, SECRET)).toEqual(seed);
    // fresh IV every time
    expect(encryptSecret(seed, SECRET)).not.toBe(enc);
  });

  test("wrong secret or tampering fails", () => {
    const enc = encryptSecret(new Uint8Array(32).fill(1), SECRET);
    expect(() => decryptSecret(enc, "t".repeat(32))).toThrow();
    const raw = Buffer.from(enc, "base64");
    raw[raw.length - 1] = (raw[raw.length - 1] ?? 0) ^ 1;
    expect(() => decryptSecret(raw.toString("base64"), SECRET)).toThrow();
    expect(() => decryptSecret("AAAA", SECRET)).toThrow();
  });

  test("secret must be at least 32 chars", () => {
    expect(agentKeySecret(undefined)).toBeNull();
    expect(agentKeySecret("short")).toBeNull();
    expect(agentKeySecret(SECRET)).toBe(SECRET);
  });
});

describe("api key format", () => {
  test("sbk_ + 32 bytes base64url, prefix 12 chars, sha-256 hex hash", () => {
    const k = generateApiKey();
    expect(k.key).toMatch(/^sbk_[A-Za-z0-9_-]{43}$/);
    expect(isApiKeyFormat(k.key)).toBe(true);
    expect(k.prefix).toBe(k.key.slice(0, 12));
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(k.hash).toBe(hashApiKey(k.key));
    expect(generateApiKey().key).not.toBe(k.key);
    expect(isApiKeyFormat("sbk_short")).toBe(false);
  });
});

// DB-backed checks against the test database (app_test); skipped when it is not reachable.
const TEST_DB =
  process.env.TEST_DATABASE_URL || "postgres://postgres:postgres@localhost:5434/app_test";
const db = getDb(TEST_DB);
const dbUp = await db
  .execute(sql`select 1 from api_keys limit 1`)
  .then(() => true)
  .catch(() => false);
if (!dbUp) console.warn("[agent-keys.test] DB checks skipped: app_test not reachable/migrated");
const d = dbUp ? describe : describe.skip;

const owner = `test-owner-${Date.now()}`;
const other = `test-other-${Date.now()}`;
const wallets: string[] = [];
const newWallet = () => {
  const w = `TestAgent${randomBytes(12).toString("hex")}`;
  wallets.push(w);
  return w;
};

afterAll(async () => {
  if (dbUp && wallets.length) {
    await db.delete(apiKeys).where(inArray(apiKeys.agentWallet, wallets));
    await db.delete(agentWallets).where(inArray(agentWallets.wallet, wallets));
  }
  await closeDb(TEST_DB);
});

d("agent wallets and api keys (db)", () => {
  test("agents per owner are capped", async () => {
    for (let i = 0; i < MAX_AGENTS_PER_OWNER; i++) {
      const r = await createAgentWallet(db, {
        wallet: newWallet(),
        owner,
        name: `A${i}`,
        secretEnc: encryptSecret(new Uint8Array(32), SECRET),
      });
      expect(r?.owner).toBe(owner);
    }
    const over = await createAgentWallet(db, {
      wallet: newWallet(),
      owner,
      name: "over",
      secretEnc: "x",
    });
    expect(over).toBeNull();
  });

  test("create, list (no hash), resolve, revoke", async () => {
    const [first] = await listOwnerAgents(db, owner);
    if (!first) throw new Error("no agent");
    expect(await createApiKey(db, { owner: other, agentWallet: first.wallet, name: "x" })).toBe(
      "not_found",
    );
    const k = await createApiKey(db, { owner, agentWallet: first.wallet, name: "laptop" });
    if (typeof k === "string") throw new Error(k);
    expect(k.key.startsWith(k.prefix)).toBe(true);

    const listed = await listOwnerAgents(db, owner);
    const json = JSON.stringify(listed);
    expect(json).not.toContain(k.key);
    expect(json).not.toContain(hashApiKey(k.key));
    expect(json).not.toContain("secret");
    expect(listed.find((a) => a.wallet === first.wallet)?.keys[0]?.prefix).toBe(k.prefix);

    const r = await resolveApiKey(db, k.key);
    expect(r?.agentWallet).toBe(first.wallet);
    expect(r?.owner).toBe(owner);
    expect(r?.keyId).toBe(k.id);
    const used = (await listOwnerAgents(db, owner)).find((a) => a.wallet === first.wallet);
    expect(used?.keys[0]?.lastUsedAt).toBeInstanceOf(Date);
    expect(await resolveApiKey(db, generateApiKey().key)).toBeNull();

    expect(await revokeApiKey(db, other, k.id)).toBe(false);
    expect(await revokeApiKey(db, owner, k.id)).toBe(true);
    expect(await resolveApiKey(db, k.key)).toBeNull();
  });

  test("active keys per agent are capped; revoked keys free a slot", async () => {
    const agents = await listOwnerAgents(db, owner);
    const a = agents[1];
    if (!a) throw new Error("no agent");
    const ids: number[] = [];
    for (let i = 0; i < MAX_KEYS_PER_AGENT; i++) {
      const k = await createApiKey(db, { owner, agentWallet: a.wallet, name: `k${i}` });
      if (typeof k === "string") throw new Error(k);
      ids.push(k.id);
    }
    expect(await createApiKey(db, { owner, agentWallet: a.wallet, name: "over" })).toBe("limit");
    await revokeApiKey(db, owner, ids[0] ?? 0);
    const again = await createApiKey(db, { owner, agentWallet: a.wallet, name: "again" });
    expect(typeof again).toBe("object");
  });
});
