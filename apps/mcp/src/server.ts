/** One MCP server factory for stdio and HTTP. */
import { McpServer } from "@modelcontextprotocol/server";
import { getCtx } from "./ctx";
import { GUIDE } from "./guide";
import { registerAgentTools } from "./tools/agent";
import { registerIntentTools } from "./tools/intents";
import { registerReadTools } from "./tools/read";
import { registerSimulateTool } from "./tools/simulate";

export function createServer(): McpServer {
  const s = new McpServer(
    { name: "stockbreak", version: "0.1.0" },
    {
      instructions:
        "Stockbreak: simulated tokenized stock indexes on Solana localnet/devnet. Read docs://guide first. Use build_* tools to prepare actions the user signs; agent_* tools (when present) act with the agent's own wallet within program-enforced limits.",
    },
  );
  registerReadTools(s, getCtx);
  registerSimulateTool(s, getCtx);
  registerIntentTools(s, getCtx);
  // Agent wallet mode only when a keypair is configured (PLAN §7.6).
  if (process.env.AGENT_KEYPAIR_PATH) registerAgentTools(s, getCtx);
  s.registerResource(
    "guide",
    "docs://guide",
    { title: "How to use Stockbreak tools", mimeType: "text/markdown" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: GUIDE }] }),
  );
  return s;
}
