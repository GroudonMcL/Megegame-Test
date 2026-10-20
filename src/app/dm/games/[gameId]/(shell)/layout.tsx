import { and, eq } from "drizzle-orm";
import { DmShell } from "@/components/dm/DmShell";
import { WorldMap } from "@/components/map/WorldMap";
import type { ConnectionData, RegionData, TerrainAreaData, UnitData } from "@/components/map/mapData";
import { db, schema } from "@/db";
import { loadMapState } from "@/lib/map";
import { dmUnreadTotal } from "@/lib/messages";
import { loadRuleset } from "@/lib/rulesets";
import { loadGame } from "../game";

// Teams, Resolve, Diplomacy, Messages and the World map share this screen: the World map
// underneath, and the page open as a window over it.

export default async function DmShellLayout({ children, params }: LayoutProps<"/dm/games/[gameId]">) {
  const { gameId } = await params;
  const game = await loadGame(gameId);
  const [state, { ruleset }, [round], unreadMessages] = await Promise.all([
    loadMapState(gameId),
    loadRuleset(gameId),
    db
      .select({ number: schema.rounds.number, status: schema.rounds.status })
      .from(schema.rounds)
      .where(and(eq(schema.rounds.gameId, gameId), eq(schema.rounds.number, game.currentRound)))
      .limit(1),
    dmUnreadTotal(gameId),
  ]);
  return (
    <DmShell
      gameId={gameId}
      gameName={game.name}
      round={round ?? null}
      unreadMessages={unreadMessages}
      map={
        <WorldMap
          gameId={gameId}
          ruleset={ruleset}
          regions={state.regions as RegionData[]}
          connections={state.connections as ConnectionData[]}
          units={state.units as UnitData[]}
          teams={state.teams}
          terrainAreas={state.terrainAreas as TerrainAreaData[]}
          mapImage={state.mapImage}
          map3d={state.map3d}
        />
      }
    >
      {children}
    </DmShell>
  );
}
