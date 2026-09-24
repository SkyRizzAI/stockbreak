/** stdio transport: `bun apps/mcp/src/stdio.ts`. stdout is JSON-RPC, so log to stderr only. */
import "./boot";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "./server";

const h = serveStdio(createServer);
console.error("stocklana MCP ready on stdio");
process.on("SIGINT", () => void h.close());
process.on("SIGTERM", () => void h.close());
