import { actionJson, preflight } from "@/lib/server/actions";

export const GET = () =>
  actionJson({ rules: [{ pathPattern: "/i/*", apiPath: "/api/actions/join/*" }] });
export const OPTIONS = preflight;
