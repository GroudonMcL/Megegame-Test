import { z } from "zod";
import { exportGame } from "@/lib/export";
import { isDm } from "@/lib/session";

// The whole game as a JSON backup (DM only).
export async function GET(_req: Request, ctx: RouteContext<"/api/dm/games/[gameId]/export">) {
  if (!(await isDm())) return new Response("Not allowed", { status: 403 });
  const { gameId } = await ctx.params;
  if (!z.uuid().safeParse(gameId).success) return new Response("Not found", { status: 404 });
  const data = await exportGame(gameId);
  if (!data) return new Response("Not found", { status: 404 });
  const name = data.game.name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "game";
  return new Response(JSON.stringify(data, null, 1), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
