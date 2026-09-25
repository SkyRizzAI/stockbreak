import Image from "../../../(app)/i/[pubkey]/opengraph-image";

export const dynamic = "force-dynamic";

/**
 * Stable URL for the index card image. Inside the (app) route group Next.js suffixes the
 * metadata route with a hash (/i/<pubkey>/opengraph-image-<hash>, used by og:image), but
 * Blink icons and on-chain token metadata link /i/<pubkey>/opengraph-image.
 */
export async function GET(_req: Request, ctx: RouteContext<"/i/[pubkey]/opengraph-image">) {
  return Image({ params: ctx.params });
}
