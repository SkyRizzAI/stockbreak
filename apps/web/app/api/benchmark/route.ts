import { benchmark } from "@/lib/server/data";
import { guard } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** SPYx 30-day closes and return, for index cards (D035). */
export function GET() {
  return guard(() => benchmark());
}
