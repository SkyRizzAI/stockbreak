/**
 * bun run agent:token [-- --rotate] [-- --print-only]
 *
 * Creates the operator token that unlocks agent_* MCP tools (remote /api/mcp or a public
 * standalone MCP) and writes it to the root .env as MCP_AGENT_TOKEN (server side) and
 * AGENT_MCP_TOKEN (what `bun run agent:loop` sends). An existing token is kept unless
 * --rotate. The token is shown once so you can paste it into your MCP client; for Vercel,
 * put the same value in the project's MCP_AGENT_TOKEN (or use `vercel:env -- --with-agent`).
 */
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { log } from "./lib/proc";
import { ROOT } from "./lib/toolchain";

const S = "agent-token";
const envPath = path.join(ROOT, ".env");
const rotate = process.argv.includes("--rotate");
const printOnly = process.argv.includes("--print-only");

const text = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
const current = /^MCP_AGENT_TOKEN=(.+)$/m.exec(text)?.[1]?.trim();
const token = current && !rotate ? current : randomBytes(32).toString("base64url");

if (!printOnly && token !== current) {
  let next = text;
  for (const key of ["MCP_AGENT_TOKEN", "AGENT_MCP_TOKEN"]) {
    const line = `${key}=${token}`;
    next = new RegExp(`^${key}=.*$`, "m").test(next)
      ? next.replace(new RegExp(`^${key}=.*$`, "m"), line)
      : `${next.replace(/\n?$/, "\n")}${line}\n`;
  }
  writeFileSync(envPath, next, { mode: 0o600 });
  chmodSync(envPath, 0o600);
  log(S, `${current ? "rotated" : "created"} MCP_AGENT_TOKEN and AGENT_MCP_TOKEN in .env`);
} else if (current && !rotate) {
  log(S, "using the existing MCP_AGENT_TOKEN from .env (pass --rotate for a new one)");
}

const keypair = existsSync(path.join(ROOT, process.env.AGENT_KEYPAIR_PATH || ".keys/agent.json"));
console.log(`
Operator token (keep it secret, like a password):

  ${token}

Use it:
  Claude Code   claude mcp add --transport http stockbreak <MCP URL> \\
                  --header "Authorization: Bearer ${token}"
  Agent loop    already set as AGENT_MCP_TOKEN in .env
  Vercel        project → Settings → Environment Variables → MCP_AGENT_TOKEN = the token
                (plus AGENT_KEYPAIR_JSON; \`bun run vercel:env -- --with-agent\` writes both)

Restart the server that serves /api/mcp (bun run dev / dev:devnet, or redeploy) to apply it.${
  keypair
    ? ""
    : "\nNote: no agent keypair found (.keys/agent.json) — agent_* tools stay off until one exists."
}`);
