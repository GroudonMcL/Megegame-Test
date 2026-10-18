import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { fogHoles, fogKey, renderFoggedMap } from "@/lib/fogImage";
import { loadTeamView } from "@/lib/teamView";
import { getViewer } from "@/lib/viewer";

// The map image as one team may see it: fogged outside the regions it sees.
export async function GET(req: Request) {
  const viewer = await getViewer();
  if (!viewer) return new Response("Not allowed", { status: 403 });
  const { view, fullRuleset } = await loadTeamView(viewer.gameId, viewer.teamId, { record: false });
  const [game] = await db.select({ mapAssetId: schema.games.mapAssetId }).from(schema.games).where(eq(schema.games.id, viewer.gameId)).limit(1);
  if (!game?.mapAssetId) return new Response("Not found", { status: 404 });

  const fog = fullRuleset.settings.fog;
  const holes = fogHoles(view);
  const key = fog.fogImage ? fogKey(game.mapAssetId, holes, fog.revealRadius) : `open-${game.mapAssetId}`;
  const etag = `"${key}"`;
  const headers = { "Cache-Control": "private, no-cache", ETag: etag, Vary: "Cookie" };
  if (req.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers });

  const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, game.mapAssetId)).limit(1);
  if (!asset) return new Response("Not found", { status: 404 });
  if (!fog.fogImage) return new Response(new Uint8Array(asset.data), { headers: { ...headers, "Content-Type": asset.mime } });
  const body = await renderFoggedMap(key, asset.data, holes, fog.revealRadius);
  return new Response(new Uint8Array(body), { headers: { ...headers, "Content-Type": "image/webp" } });
}
