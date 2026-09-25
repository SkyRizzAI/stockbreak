/**
 * Web-created agent wallets and their API keys (D045, custody model A).
 *
 * - Agent seeds (32-byte ed25519) are stored AES-256-GCM encrypted with
 *   key = SHA-256(AGENT_KEY_SECRET). Format: base64(iv12 | tag16 | ciphertext).
 * - API keys are `sbk_` + 32 random bytes (base64url); only the SHA-256 hex hash
 *   and a display prefix are stored. The raw key is shown once.
 * Devnet/localnet only; production custody belongs in an HSM/MPC wallet provider.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, asc, count, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "./client";
import { agentWallets, apiKeys } from "./schema";

export const API_KEY_PREFIX = "sbk_";
export const MAX_AGENTS_PER_OWNER = 3;
export const MAX_KEYS_PER_AGENT = 5;
const MIN_SECRET_LEN = 32;

// ---------------- crypto ----------------

/** AGENT_KEY_SECRET when set and long enough, else null (feature off on this server). */
export function agentKeySecret(v = process.env.AGENT_KEY_SECRET): string | null {
  return v && v.length >= MIN_SECRET_LEN ? v : null;
}

const aesKey = (secret: string) => createHash("sha256").update(secret, "utf8").digest();

export function encryptSecret(plain: Uint8Array, secret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", aesKey(secret), iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}

/** Throws when the secret is wrong or the ciphertext was tampered with. */
export function decryptSecret(enc: string, secret: string): Uint8Array {
  const raw = Buffer.from(enc, "base64");
  if (raw.length < 12 + 16 + 1) throw new Error("Malformed encrypted secret");
  const d = createDecipheriv("aes-256-gcm", aesKey(secret), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return new Uint8Array(Buffer.concat([d.update(raw.subarray(28)), d.final()]));
}

export const hashApiKey = (key: string): string =>
  createHash("sha256").update(key, "utf8").digest("hex");

/** A fresh API key: the raw value (show once), its display prefix and stored hash. */
export function generateApiKey(): { key: string; prefix: string; hash: string } {
  const key = API_KEY_PREFIX + randomBytes(32).toString("base64url");
  return { key, prefix: key.slice(0, 12), hash: hashApiKey(key) };
}

export const isApiKeyFormat = (v: string): boolean => /^sbk_[A-Za-z0-9_-]{43}$/.test(v);

// ---------------- queries ----------------

export type AgentWalletRow = typeof agentWallets.$inferSelect;
export type ApiKeyRow = typeof apiKeys.$inferSelect;

export interface OwnerAgent {
  wallet: string;
  name: string;
  createdAt: Date;
  keys: {
    id: number;
    name: string;
    prefix: string;
    createdAt: Date;
    lastUsedAt: Date | null;
    revokedAt: Date | null;
  }[];
}

/** Insert an agent wallet; returns null when the owner already has the maximum. */
export async function createAgentWallet(
  db: Db,
  row: { wallet: string; owner: string; name: string; secretEnc: string },
): Promise<AgentWalletRow | null> {
  return db.transaction(async (tx) => {
    // Serialize per owner so two parallel requests can't both pass the limit.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`agents:${row.owner}`}))`);
    const [c] = await tx
      .select({ n: count() })
      .from(agentWallets)
      .where(eq(agentWallets.owner, row.owner));
    if ((c?.n ?? 0) >= MAX_AGENTS_PER_OWNER) return null;
    const [r] = await tx.insert(agentWallets).values(row).returning();
    return r ?? null;
  });
}

export async function getAgentWallet(db: Db, wallet: string): Promise<AgentWalletRow | null> {
  const [r] = await db.select().from(agentWallets).where(eq(agentWallets.wallet, wallet)).limit(1);
  return r ?? null;
}

/** An owner's agents with every key's metadata (never the hash). */
export async function listOwnerAgents(db: Db, owner: string): Promise<OwnerAgent[]> {
  const agents = await db
    .select({
      wallet: agentWallets.wallet,
      name: agentWallets.name,
      createdAt: agentWallets.createdAt,
    })
    .from(agentWallets)
    .where(eq(agentWallets.owner, owner))
    .orderBy(asc(agentWallets.createdAt));
  if (!agents.length) return [];
  const keys = await db
    .select({
      id: apiKeys.id,
      agentWallet: apiKeys.agentWallet,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(
      and(
        eq(apiKeys.owner, owner),
        inArray(
          apiKeys.agentWallet,
          agents.map((a) => a.wallet),
        ),
      ),
    )
    .orderBy(asc(apiKeys.id));
  return agents.map((a) => ({
    ...a,
    keys: keys.filter((k) => k.agentWallet === a.wallet).map(({ agentWallet: _, ...k }) => k),
  }));
}

/**
 * Store a new key for an agent the owner holds. Returns the raw key once, or
 * "not_found" (not this owner's agent) / "limit" (MAX_KEYS_PER_AGENT active keys).
 */
export async function createApiKey(
  db: Db,
  args: { owner: string; agentWallet: string; name: string },
): Promise<{ id: number; key: string; prefix: string } | "not_found" | "limit"> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`keys:${args.agentWallet}`}))`);
    const [agent] = await tx
      .select({ wallet: agentWallets.wallet })
      .from(agentWallets)
      .where(and(eq(agentWallets.wallet, args.agentWallet), eq(agentWallets.owner, args.owner)))
      .limit(1);
    if (!agent) return "not_found";
    const [c] = await tx
      .select({ n: count() })
      .from(apiKeys)
      .where(and(eq(apiKeys.agentWallet, args.agentWallet), isNull(apiKeys.revokedAt)));
    if ((c?.n ?? 0) >= MAX_KEYS_PER_AGENT) return "limit";
    const k = generateApiKey();
    const [r] = await tx
      .insert(apiKeys)
      .values({
        agentWallet: args.agentWallet,
        owner: args.owner,
        name: args.name,
        prefix: k.prefix,
        keyHash: k.hash,
      })
      .returning({ id: apiKeys.id });
    if (!r) throw new Error("Could not create the API key");
    return { id: r.id, key: k.key, prefix: k.prefix };
  });
}

/** Revoke one of the owner's keys; false when it doesn't exist or isn't theirs. */
export async function revokeApiKey(db: Db, owner: string, id: number): Promise<boolean> {
  const [k] = await db
    .select({ id: apiKeys.id, revokedAt: apiKeys.revokedAt })
    .from(apiKeys)
    .where(and(eq(apiKeys.id, id), eq(apiKeys.owner, owner)))
    .limit(1);
  if (!k) return false;
  if (!k.revokedAt)
    await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id));
  return true;
}

export interface ResolvedApiKey {
  keyId: number;
  agentWallet: string;
  owner: string;
  secretEnc: string;
}

/** Look up a raw API key (revoked keys resolve to null); touches last_used_at ≤ once/min. */
export async function resolveApiKey(db: Db, rawKey: string): Promise<ResolvedApiKey | null> {
  if (!isApiKeyFormat(rawKey)) return null;
  const [r] = await db
    .select({
      keyId: apiKeys.id,
      agentWallet: apiKeys.agentWallet,
      owner: apiKeys.owner,
      secretEnc: agentWallets.secretEnc,
    })
    .from(apiKeys)
    .innerJoin(agentWallets, eq(agentWallets.wallet, apiKeys.agentWallet))
    .where(and(eq(apiKeys.keyHash, hashApiKey(rawKey)), isNull(apiKeys.revokedAt)))
    .limit(1);
  if (!r) return null;
  const minuteAgo = new Date(Date.now() - 60_000);
  await db
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(
      and(
        eq(apiKeys.id, r.keyId),
        or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, minuteAgo)),
      ),
    );
  return r;
}
