/** App UI layout preference shared by the server layout and the client store (D053). */
export type AppLayout = "dashboard" | "navbar";
export const LAYOUT_COOKIE = "sb-layout";

export function parseLayout(v: string | undefined | null): AppLayout {
  return v === "navbar" ? "navbar" : "dashboard";
}
