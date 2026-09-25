/**
 * Streamable HTTP transport (/mcp) with /health.
 *
 * Local (default): 127.0.0.1, localhost-only Host header, every tool (agent_* when a
 * keypair is configured).
 * Public (MCP_PUBLIC=1, for Fly/Railway/Render/any Bun host): binds MCP_HOST (set
 * 0.0.0.0), Host checked against MCP_ALLOWED_HOSTS when set, agent_* only with
 * MCP_AGENT_TOKEN, CORS and a per-IP rate limit (./public.ts).
 */
import "./boot";
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
} from "@modelcontextprotocol/server";
import { agentKeyConfigured } from "./ctx";
import { CORS_HEADERS, createPublicMcpHandler, mcpHealth, mcpHttpEnv } from "./public";
import { createServer } from "./server";

const env = mcpHttpEnv();
const port = Number(process.env.MCP_HTTP_PORT || process.env.PORT || 3333);
const isPublic = env.MCP_PUBLIC;
const hostname = isPublic ? env.MCP_HOST : "127.0.0.1";
const allowedHosts = isPublic ? env.MCP_ALLOWED_HOSTS : localhostAllowedHostnames();

const local = isPublic ? null : createMcpHandler(() => createServer());
const pub = isPublic ? createPublicMcpHandler() : null;

const server = Bun.serve({
  port,
  hostname,
  idleTimeout: 255,
  fetch: (req, srv) => {
    // DNS-rebinding guard: localhost only (local); MCP_ALLOWED_HOSTS if set (public).
    if (allowedHosts.length) {
      const bad = hostHeaderValidationResponse(req, allowedHosts);
      if (bad) return bad;
    }
    const { pathname } = new URL(req.url);
    if (pathname === "/health") {
      if (pub) return Response.json(mcpHealth(), { headers: CORS_HEADERS });
      return Response.json({
        ok: true,
        cluster: process.env.CLUSTER ?? "localnet",
        agent: agentKeyConfigured(),
      });
    }
    if (pathname === "/mcp") {
      if (pub) return pub.fetch(req, srv.requestIP(req)?.address);
      if (local) return local.fetch(req);
    }
    return new Response("Not found", { status: 404 });
  },
});
console.log(
  `stockbreak MCP on http://${hostname}:${server.port}/mcp${isPublic ? " (public mode)" : ""}`,
);

const stop = async () => {
  await (pub ?? local)?.close();
  server.stop();
  process.exit(0);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
