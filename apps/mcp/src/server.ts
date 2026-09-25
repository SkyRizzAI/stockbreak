/** One MCP server factory for stdio and HTTP. */
import { McpServer } from "@modelcontextprotocol/server";
import type { KeyPairSigner } from "@solana/kit";
import { agentKeyConfigured, getCtx, type McpCtx } from "./ctx";
import { GUIDE } from "./guide";
import { registerAgentTools } from "./tools/agent";
import { registerIntentTools } from "./tools/intents";
import { registerManageTools } from "./tools/manage";
import { registerReadTools } from "./tools/read";
import { registerSimulateTool } from "./tools/simulate";

export interface ServerOptions {
  /**
   * Register agent_* tools (server-held agent wallet). Default: whenever an agent
   * keypair is configured (local stdio/HTTP behaviour). Public endpoints pass
   * `false` unless the request carries MCP_AGENT_TOKEN (see ./public.ts).
   */
  agentTools?: boolean;
  /**
   * Act as this agent wallet instead of the server keypair (per-request agent from a
   * user API key, D045). Implies `agentTools` unless it is explicitly false.
   */
  agent?: KeyPairSigner;
}

/** A ctx getter whose `agent` is the given signer (every tool sees the same wallet). */
export function ctxWithAgent(agent: KeyPairSigner): () => Promise<McpCtx> {
  return async () => ({ ...(await getCtx()), agent });
}

export function createServer(opts: ServerOptions = {}): McpServer {
  const s = new McpServer(
    { name: "stockbreak", version: "0.1.0" },
    {
      instructions:
        "Stockbreak: simulated tokenized stock indexes on Solana localnet/devnet. Read docs://guide first. Use build_* tools to prepare actions the user signs; agent_* tools (when present) act with the agent's own wallet within program-enforced limits.",
    },
  );
  const ctx = opts.agent ? ctxWithAgent(opts.agent) : getCtx;
  registerReadTools(s, ctx);
  registerSimulateTool(s, ctx);
  registerIntentTools(s, ctx);
  registerManageTools(s, ctx);
  // Agent wallet mode only with a per-request agent or a configured keypair (PLAN §7.6).
  if (opts.agentTools ?? (!!opts.agent || agentKeyConfigured())) registerAgentTools(s, ctx);
  s.registerResource(
    "guide",
    "docs://guide",
    { title: "How to use Stockbreak tools", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: GUIDE }] }),
  );
  return s;
}
