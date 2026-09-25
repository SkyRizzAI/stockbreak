import "server-only";
/** Shared bits of the agent console API (/api/me/*, D045). */
import { agentKeySecret } from "@repo/db";
import * as z from "zod";
import { serverEnv } from "./ctx";
import { fail } from "./http";
import { currentWallet } from "./session";

export const NOT_CONFIGURED = "Agent creation is not configured on this server";

/** Agent / key label: trimmed, 1–40 chars, no control characters. */
export const NameBody = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a name")
    .max(40, "Name: up to 40 characters")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control chars is the point
    .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), "Name contains invalid characters"),
});

/** Session wallet for a read, or a 401 JSON response. */
export async function requireOwner(): Promise<string | Response> {
  return (await currentWallet()) ?? fail(401, "Sign in with your wallet to continue");
}

/** AGENT_KEY_SECRET (≥32 chars), or a 503 JSON response when the feature is off. */
export function requireAgentSecret(): string | Response {
  return agentKeySecret(serverEnv().AGENT_KEY_SECRET) ?? fail(503, NOT_CONFIGURED);
}

/** First validation message of a zod error. */
export const firstIssue = (e: z.ZodError): string => e.issues[0]?.message ?? "Invalid request";
