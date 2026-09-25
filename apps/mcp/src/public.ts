/**
 * Public (internet-facing) MCP endpoint: the same server factory with public-safe
 * defaults. Used by the web route /api/mcp and by http.ts with MCP_PUBLIC=1.
 *
 * - Read, simulate and build_* intent tools + docs://guide for everyone.
 * - agent_* tools only with `Authorization: Bearer <MCP_AGENT_TOKEN>` AND an agent
 *   keypair (AGENT_KEYPAIR_JSON or an existing AGENT_KEYPAIR_PATH file), or with a
 *   user API key `Bearer sbk_...` (D045): agent_* then act as that key's agent wallet.
 *   An unknown/revoked `sbk_` key is rejected with 401 (never silently downgraded).
 * - CORS for browser-based MCP clients, per-IP rate limit and a per-API-key rate limit
 *   (in-memory, per instance).
 * - Stateless: createMcpHandler serves each request with a fresh server instance.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { type McpHttpEnv, mcpHttpEnvSchema, parseEnv } from "@repo/config";
import {
  API_KEY_PREFIX,
  agentKeySecret,
  decryptSecret,
  isApiKeyFormat,
  resolveApiKey,
} from "@repo/db";
import { createKeyPairSignerFromPrivateKeyBytes, type KeyPairSigner } from "@solana/kit";
import { agentKeyConfigured, getCtx } from "./ctx";
import { createServer } from "./server";

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Mcp-Method, Mcp-Name, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, Mcp-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

let envCache: McpHttpEnv | null = null;
export function mcpHttpEnv(): McpHttpEnv {
  envCache ??= parseEnv(mcpHttpEnvSchema);
  return envCache;
}

const digest = (v: string) => createHash("sha256").update(v).digest();

/** The bearer credential of a request, if any. */
export function bearerOf(req: Request | undefined): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(req?.headers.get("authorization") ?? "");
  return m?.[1]?.trim() || null;
}

/** Constant-time check of `Authorization: Bearer <MCP_AGENT_TOKEN>`. */
export function hasAgentToken(req: Request | undefined): boolean {
  const token = mcpHttpEnv().MCP_AGENT_TOKEN;
  const b = bearerOf(req);
  if (!token || !b) return false;
  // Equal-length digests: no length leak, no timingSafeEqual length throw.
  return timingSafeEqual(digest(b), digest(token));
}

/** Signers produced by resolveAgentKey in this process (the factory accepts only these). */
const verifiedAgents = new WeakSet<object>();
const verifiedAgent = (v: unknown): KeyPairSigner | null =>
  typeof v === "object" && v !== null && verifiedAgents.has(v) ? (v as KeyPairSigner) : null;

/** Requests per minute per user API key (on top of the per-IP limit). */
export const KEY_RATE_LIMIT = 120;

export type AgentKeyResult =
  | { ok: true; keyId: number; agent: KeyPairSigner }
  | { ok: false; status: 401 | 503; message: string };

/**
 * Resolve a user API key (`sbk_...`) to its agent signer: hash lookup (revoked keys
 * never resolve), decrypt the stored seed, and check it still derives the stored wallet.
 */
export async function resolveAgentKey(rawKey: string): Promise<AgentKeyResult> {
  const secret = agentKeySecret();
  if (!secret)
    return { ok: false, status: 503, message: "Agent API keys are not configured on this server" };
  if (!isApiKeyFormat(rawKey))
    return { ok: false, status: 401, message: "Invalid or revoked API key" };
  const c = await getCtx();
  const r = await resolveApiKey(c.db, rawKey);
  if (!r) return { ok: false, status: 401, message: "Invalid or revoked API key" };
  let agent: KeyPairSigner;
  try {
    agent = await createKeyPairSignerFromPrivateKeyBytes(decryptSecret(r.secretEnc, secret));
  } catch {
    // Wrong AGENT_KEY_SECRET for this database, or a corrupted row. Never log the key.
    return {
      ok: false,
      status: 503,
      message: "This agent's wallet cannot be unlocked on this server",
    };
  }
  if (agent.address !== r.agentWallet)
    return {
      ok: false,
      status: 503,
      message: "This agent's wallet cannot be unlocked on this server",
    };
  verifiedAgents.add(agent);
  return { ok: true, keyId: r.keyId, agent };
}

/** Whether this deployment can serve agent_* tools at all (token + key configured). */
export function agentToolsAvailable(): boolean {
  return !!mcpHttpEnv().MCP_AGENT_TOKEN && agentKeyConfigured(true);
}

const WINDOW_MS = 60_000;
const hits = new Map<string, { n: number; reset: number }>();

/** Fixed-window limiter (per IP, or `key:<id>`); returns seconds to wait when over the limit. */
export function rateLimited(
  bucket: string,
  now = Date.now(),
  limit = mcpHttpEnv().MCP_RATE_LIMIT,
): number | null {
  if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  const h = hits.get(bucket);
  if (!h || h.reset <= now) {
    hits.set(bucket, { n: 1, reset: now + WINDOW_MS });
    return null;
  }
  h.n += 1;
  return h.n > limit ? Math.ceil((h.reset - now) / 1000) : null;
}

/** Client IP behind proxies (Vercel/Fly/Render set x-forwarded-for). */
export function clientIp(req: Request, fallback = "unknown"): string {
  const xff = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return xff || req.headers.get("x-real-ip") || fallback;
}

export function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** JSON-RPC shaped error so MCP clients surface a readable message. */
export function jsonRpcError(
  status: number,
  message: string,
  extra: Record<string, string> = {},
): Response {
  return withCors(
    Response.json(
      { jsonrpc: "2.0", error: { code: -32000, message }, id: null },
      { status, headers: extra },
    ),
  );
}

export interface PublicMcpHandler {
  fetch: (req: Request, ip?: string) => Promise<Response>;
  close: () => Promise<void>;
}

export function createPublicMcpHandler(): PublicMcpHandler {
  const handler = createMcpHandler(({ requestInfo, authInfo }) => {
    // Per-request agent from a verified user API key (set by fetch below, never by headers).
    const agent = verifiedAgent(authInfo?.extra?.agent);
    if (agent) return createServer({ agent });
    return createServer({ agentTools: agentToolsAvailable() && hasAgentToken(requestInfo) });
  });
  const limited = (wait: number) =>
    jsonRpcError(429, `Rate limit exceeded. Retry in ${wait}s.`, { "Retry-After": String(wait) });
  return {
    fetch: async (req, ip) => {
      if (req.method === "OPTIONS")
        return new Response(null, { status: 204, headers: CORS_HEADERS });
      const wait = rateLimited(clientIp(req, ip));
      if (wait !== null) return limited(wait);
      const bearer = bearerOf(req);
      if (bearer?.startsWith(API_KEY_PREFIX)) {
        let r: AgentKeyResult;
        try {
          r = await resolveAgentKey(bearer);
        } catch {
          return jsonRpcError(503, "API key check is unavailable right now. Try again shortly.");
        }
        if (!r.ok)
          return jsonRpcError(
            r.status,
            r.message,
            r.status === 401 ? { "WWW-Authenticate": 'Bearer error="invalid_token"' } : {},
          );
        const keyWait = rateLimited(`key:${r.keyId}`, Date.now(), KEY_RATE_LIMIT);
        if (keyWait !== null) return limited(keyWait);
        return withCors(
          await handler.fetch(req, {
            authInfo: {
              token: `key:${r.keyId}`, // never the raw key
              clientId: r.agent.address,
              scopes: ["agent"],
              extra: { agent: r.agent },
            },
          }),
        );
      }
      return withCors(await handler.fetch(req));
    },
    close: () => handler.close(),
  };
}

/** Health payload shared by /health (standalone) and /api/mcp/health (web). */
export function mcpHealth(): { ok: true; cluster: string; agentTools: boolean } {
  return {
    ok: true,
    cluster: process.env.CLUSTER ?? "localnet",
    agentTools: agentToolsAvailable(),
  };
}
