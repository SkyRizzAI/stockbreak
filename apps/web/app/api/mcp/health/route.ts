import { mcpHealth } from "@repo/mcp/public";
import { serverEnv } from "@/lib/server/ctx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Remote MCP health: {ok, cluster, agentTools}. */
export function GET() {
  const e = serverEnv();
  return Response.json(
    { ...mcpHealth(), cluster: e.CLUSTER },
    { headers: { "Access-Control-Allow-Origin": "*" } },
  );
}
