import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { isDm } from "@/lib/session";

// Uploaded images in full, for the DM only. Players get the map through
// /api/play/map, which paints their team's fog of war onto it.
export async function GET(req: Request, ctx: RouteContext<"/api/assets/[assetId]">) {
  if (!(await isDm())) return new Response("Not allowed", { status: 403 });
  const { assetId } = await ctx.params;
  if (!z.uuid().safeParse(assetId).success) return new Response("Not found", { status: 404 });
  const etag = `"${assetId}"`;
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304 });
  const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, assetId)).limit(1);
  if (!asset) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(asset.data), {
    headers: {
      "Content-Type": asset.mime,
      // Assets never change (a new upload gets a new ID), so browsers may keep them.
      "Cache-Control": "private, max-age=31536000, immutable",
      ETag: etag,
    },
  });
}
