import { z } from "zod";
import { CSV_TABLES, exportCsv } from "@/lib/export";
import { isDm } from "@/lib/session";

// One table as a CSV file for spreadsheets (DM only).
export async function GET(_req: Request, ctx: RouteContext<"/api/dm/games/[gameId]/export/[table]">) {
  if (!(await isDm())) return new Response("Not allowed", { status: 403 });
  const { gameId, table } = await ctx.params;
  const t = z.enum(CSV_TABLES).safeParse(table);
  if (!z.uuid().safeParse(gameId).success || !t.success) return new Response("Not found", { status: 404 });
  const body = await exportCsv(gameId, t.data);
  if (body === null) return new Response("Not found", { status: 404 });
  return new Response("﻿" + body, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${t.data}.csv"`, "Cache-Control": "no-store" },
  });
}
