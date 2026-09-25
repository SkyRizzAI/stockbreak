/** Streamable HTTP transport on 127.0.0.1:MCP_HTTP_PORT (/mcp) with /health. */
import "./boot";
import {
  createMcpHandler,
  hostHeaderValidationResponse,
  localhostAllowedHostnames,
} from "@modelcontextprotocol/server";
import { createServer } from "./server";

const port = Number(process.env.MCP_HTTP_PORT ?? 3333);
const handler = createMcpHandler(createServer);

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  idleTimeout: 255,
  fetch: (req) => {
    // DNS-rebinding guard: only localhost Host headers.
    const bad = hostHeaderValidationResponse(req, localhostAllowedHostnames());
    if (bad) return bad;
    const { pathname } = new URL(req.url);
    if (pathname === "/health")
      return Response.json({
        ok: true,
        cluster: process.env.CLUSTER ?? "localnet",
        agent: !!process.env.AGENT_KEYPAIR_PATH,
      });
    if (pathname === "/mcp") return handler.fetch(req);
    return new Response("Not found", { status: 404 });
  },
});
console.log(`stockbreak MCP on http://127.0.0.1:${server.port}/mcp`);

const stop = async () => {
  await handler.close();
  server.stop();
  process.exit(0);
};
process.on("SIGINT", () => void stop());
process.on("SIGTERM", () => void stop());
