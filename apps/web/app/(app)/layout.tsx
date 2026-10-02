import { cookies } from "next/headers";
import { AppShell } from "@/components/shell/app-shell";
import { LAYOUT_COOKIE, parseLayout } from "@/lib/layout-pref";

/** App shell for every route except the landing page; the layout follows the visitor's choice. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const layout = parseLayout((await cookies()).get(LAYOUT_COOKIE)?.value);
  return <AppShell initial={layout}>{children}</AppShell>;
}
