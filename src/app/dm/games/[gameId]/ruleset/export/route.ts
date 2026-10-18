import { isDm } from "@/lib/session";
import { loadRuleset } from "@/lib/rulesets";

export async function GET(_req: Request, ctx: RouteContext<"/dm/games/[gameId]/ruleset/export">) {
  if (!(await isDm())) return new Response("Not allowed", { status: 403 });
  const { gameId } = await ctx.params;
  const { ruleset } = await loadRuleset(gameId);
  const name = ruleset.meta.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "ruleset";
  return new Response(JSON.stringify(ruleset, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${name}.json"`,
    },
  });
}
