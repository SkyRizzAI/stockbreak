import { assetPrices } from "@/lib/server/data";
import { guard } from "@/lib/server/http";

export const dynamic = "force-dynamic";
export const GET = () => guard(assetPrices);
