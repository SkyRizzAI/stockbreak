/**
 * Remote MCP endpoint (Streamable HTTP, stateless) for Claude.ai / ChatGPT connectors
 * and Claude Code: `https://<web>/api/mcp`. Same server as apps/mcp with public-safe
 * tools; agent_* only with `Authorization: Bearer <MCP_AGENT_TOKEN>` (operator agent) or a
 * user API key `Bearer sbk_...` that acts as that user's agent wallet (D045, docs/DEPLOY.md).
 * Public by design: no localhost Host validation here.
 */
import { createPublicMcpHandler, type PublicMcpHandler } from "@repo/mcp/public";
import { serverEnv } from "@/lib/server/ctx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Tool calls may wait on RPC/indexer (e.g. build_* simulations).
export const maxDuration = 60;

let handler: PublicMcpHandler | null = null;

function serve(req: Request): Promise<Response> {
  serverEnv(); // loads the monorepo .env locally and validates the server env
  handler ??= createPublicMcpHandler();
  return handler.fetch(req);
}

export const GET = serve;
export const POST = serve;
export const DELETE = serve;
export const OPTIONS = serve;
