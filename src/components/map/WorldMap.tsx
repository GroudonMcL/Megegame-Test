"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { deriveStats, unitBonuses } from "@/engine/ruleset/derive";
import { formatCr } from "@/engine/ruleset/common";
import type { Ruleset } from "@/engine/ruleset/ruleset";
import { deleteUnitAction, dmMoveUnitsAction, dmUndoWorldAction, moveUnitAction, spawnUnitsAction, updateUnitAction } from "@/app/dm/games/[gameId]/map/actions";
import { NO_NOTE, noteFor, TeamNoteOption, type TeamNoteState } from "@/components/dm/TeamNoteOption";
import { Modal } from "@/components/shell/Modal";
import { Button } from "@/components/ui";
import { dmMoveNote, planDmMove, type DmMovePlan } from "@/engine/dmMoves";
import { joinList } from "@/engine/dmEdits";
import type { TeamNote } from "@/engine/messages";
import { SidePanel } from "@/components/shell/SidePanel";
import { indexShapes, regionAt } from "@/engine/geo/regions";
import type { Map3dInfo } from "@/engine/world/mapLook";
import type { MapNode } from "./MapCanvas";
import { MapSurface } from "./MapSurface";
import { connectionEdges, terrainLayer } from "./mapLayers";
import { groupBadges, spotOf, SpotBadges } from "./UnitBadges";
import { UnitRadial } from "./UnitRadial";
import { dragUnits, isGreyed, selectedAmong, toggleUnit, type StackEntry } from "./unitStack";
import { DEFAULT_MAP_SIZE, type ConnectionData, type MapImageData, type RegionData, type TeamData, type TerrainAreaData, type UnitData } from "./mapData";
import { TeamEmblem } from "@/components/icons/TeamEmblem";

const STATUSES = ["active", "hidden", "dead", "captured", "tamed", "stored", "disbanded"] as const;
const ON_MAP = new Set(["active", "hidden", "dead"]);
const input = "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm";

type Pt = [number, number];

/** Units dragged onto a region, waiting for the DM to say how team units should move. */
interface PendingMove {
  plan: DmMovePlan;
  regionId: string;
  at: Pt;
}

function unitFields(u: UnitData) {
  const { name, creatureId, ownerTeamId, raceId, archetypeId, regionId, status, isLeader, academyBonus, augmentIds, notes } = u;
  return { name, creatureId, ownerTeamId, raceId, archetypeId, regionId, status, isLeader, academyBonus, augmentIds, notes };
}

export function WorldMap(props: {
  gameId: string;
  ruleset: Ruleset;
  regions: RegionData[];
  connections: ConnectionData[];
  units: UnitData[];
  teams: TeamData[];
  terrainAreas: TerrainAreaData[];
  mapImage: MapImageData | null;
  map3d?: Map3dInfo;
}) {
  const { gameId, ruleset, regions, connections, teams } = props;
  const [units, setUnits] = useState(props.units);
  const [selected, setSelected] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(true);
  const [showKey, setShowKey] = useState(false);
  const [dragging, setDragging] = useState<{ unitId: string; x: number; y: number } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string; undo?: string[] } | null>(null);
  // The radial menu: which spot is open, and the units ticked to move together.
  const [openSpot, setOpenSpot] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(() => new Set());
  // A unit opened from the radial menu (its row opens in the side panel).
  const [openUnit, setOpenUnit] = useState<string | null>(null);
  // Dragging a badge: the line from the stack to the pointer.
  const [moveLine, setMoveLine] = useState<{ from: Pt; to: Pt } | null>(null);
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null);
  const [pending, startTransition] = useTransition();
  const [serverUnits, setServerUnits] = useState(props.units);
  if (serverUnits !== props.units) {
    setServerUnits(props.units);
    setUnits(props.units);
  }

  const size = props.mapImage ?? DEFAULT_MAP_SIZE;
  const team = useMemo(() => new Map(teams.map((t) => [t.id, t])), [teams]);
  const creature = (id: string) => ruleset.creatures.find((c) => c.id === id);
  const regionCode = (id: string | null) => regions.find((r) => r.id === id)?.code ?? "nowhere";
  const maxHp = (u: UnitData) => {
    const c = creature(u.creatureId);
    return c ? deriveStats(c.statBlock, unitBonuses(ruleset, u)).maxHp.total : u.hp;
  };

  const regionById = useMemo(() => new Map(regions.map((r) => [r.id, r])), [regions]);
  const nodes: MapNode[] = regions.map((r) => ({
    id: r.id,
    x: r.x,
    y: r.y,
    polygon: r.polygon,
    label: r.code,
    fill: r.ownerTeamId ? team.get(r.ownerTeamId)?.colour : r.polygon.length >= 3 ? undefined : "var(--map-region)",
    ring: Boolean(r.settlementTierId),
    dashed: r.hidden,
    dim: r.hidden,
  }));
  const edges = connectionEdges(connections, (id) => regionById.get(id)?.polygon, ruleset, (c) => ({ dim: c.hidden }));
  const terrain = terrainLayer(
    props.terrainAreas.map((a) => ({ id: a.id, terrainId: a.terrainId, pieces: [[a.polygon]] })),
    ruleset,
  );

  // Region shapes, for finding the region under a point (dropping units).
  const shapes = useMemo(() => indexShapes(regions.filter((r) => r.polygon.length >= 3).map((r) => ({ id: r.id, polygon: r.polygon }))), [regions]);
  const teamName = (id: string | null) => (id ? (team.get(id)?.name ?? "a team") : "wild");
  const shown = units.filter((u) => u.regionId && ON_MAP.has(u.status) && (showHidden || u.status !== "hidden"));
  const centre = (id: string): Pt | undefined => {
    const r = regionById.get(id);
    return r ? [r.x, r.y] : undefined;
  };

  /** Units on the map, grouped by where they stand and who owns them. */
  const spots = groupBadges(
    shown.map((u) => ({ id: u.id, regionId: u.regionId!, x: u.x, y: u.y, ownerTeamId: u.ownerTeamId, dead: u.status === "dead", hidden: u.status === "hidden", lent: Boolean(u.lentToTeamId) })),
    centre,
    (id) => team.get(id),
  );

  // What the radial menu lists at each spot: every unit, in full (the DM can move any of them).
  const entriesAt = new Map<string, StackEntry[]>();
  for (const u of shown) {
    const at: Pt | undefined = u.x !== null && u.y !== null ? [u.x, u.y] : centre(u.regionId!);
    if (!at) continue;
    const key = spotOf(u.regionId!, at);
    const kind = creature(u.creatureId)?.statBlock.name ?? u.creatureId;
    const extra = [u.status === "hidden" ? "hidden" : "", u.lentToTeamId ? `lent to ${teamName(u.lentToTeamId)}` : ""].filter(Boolean).join(" · ");
    entriesAt.set(key, [
      ...(entriesAt.get(key) ?? []),
      { id: u.id, name: u.name || kind, detail: `${kind} · ${teamName(u.ownerTeamId)}${extra ? ` · ${extra}` : ""}`, owner: u.ownerTeamId ? (team.get(u.ownerTeamId) ?? null) : null, movable: true, dead: u.status === "dead" },
    ]);
  }
  // Drag handles: every pill is one ("stack:<pill key>"); dragging it moves the ticked units at its spot, or all of them.
  const stackOf = new Map(spots.flat().map((g) => [`stack:${g.key}`, g]));
  const update = (u: UnitData) => setUnits((us) => us.map((x) => (x.id === u.id ? u : x)));
  const report = (ok: boolean, text: string, undo?: string[]) => setMessage({ ok, text, undo });

  /** Moves units straight away (wild monsters, or team units after the DM chose so) or adds team move orders. */
  const sendMove = (ids: string[], regionId: string, at: Pt, mode: "instant" | "order", notes: Record<string, TeamNote> = {}) =>
    startTransition(async () => {
      const r = await dmMoveUnitsAction(gameId, { unitIds: ids, regionId, at, mode, notes });
      if (!r.ok) return report(false, r.error);
      if (mode === "instant") setUnits((us) => us.map((u) => (ids.includes(u.id) ? { ...u, regionId, x: at[0], y: at[1] } : u)));
      const what = ids.length === 1 ? (units.find((u) => u.id === ids[0])?.name || "1 unit") : `${ids.length} units`;
      report(true, mode === "instant" ? `Moved ${what} to ${regionCode(regionId)}.` : `Added a move to ${regionCode(regionId)} to the team's orders.`, r.value.map((c) => c.auditId));
    });

  const undoMove = (ids: string[]) =>
    startTransition(async () => {
      for (const id of ids) {
        const r = await dmUndoWorldAction(gameId, id);
        if (!r.ok) return report(false, r.error);
      }
      report(true, "Undone.");
    });

  /** A badge was let go at p: wild monsters move at once; team units ask how. */
  const dropStack = (ids: string[], p: Pt) => {
    const regionId = regionAt(shapes, p);
    if (!regionId) return report(false, "Drop units inside a region.");
    const plan = planDmMove(units.filter((u) => ids.includes(u.id)));
    if (plan.wild.length) sendMove(plan.wild, regionId, p, "instant");
    if (plan.teams.length) setPendingMove({ plan: { wild: [], teams: plan.teams }, regionId, at: p });
  };
  const onHandleMove = (id: string, p: Pt, finished: boolean) => {
    const g = stackOf.get(id);
    if (!g) return;
    if (!finished) return setMoveLine({ from: g.at, to: p });
    setMoveLine(null);
    const ids = dragUnits(entriesAt.get(g.spot) ?? [], ticked);
    if (ids.length) dropStack(ids, p);
  };
  const onHandleClick = (id: string) => {
    const g = stackOf.get(id);
    if (!g) return;
    setOpenSpot(g.spot);
    setOpenUnit(null);
    setSelected(g.regionId);
  };

  const moveUnit = (unitId: string, regionId: string | null) =>
    startTransition(async () => {
      const r = await moveUnitAction(gameId, unitId, regionId);
      if (r.ok) {
        update(r.value as UnitData);
        report(true, `Moved ${r.value.name} to ${regionCode(regionId)}.`);
      } else report(false, r.error);
    });

  // Where the pointer is over the map (either view), for dropping units dragged from the panel.
  const hover = useRef<[number, number] | null>(null);

  // Dragging a unit from the side panel onto a region node moves it there.
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => setDragging((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d));
    const up = (e: PointerEvent) => {
      // A region's dot (old maps), else the region under the pointer (shapes, and the 3D view).
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-node-id]")?.getAttribute("data-node-id") ?? (hover.current && regionAt(shapes, hover.current));
      const unitId = dragging.unitId;
      setDragging(null);
      if (target) moveUnit(unitId, target);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging?.unitId]);

  const region = regions.find((r) => r.id === selected);
  const here = units.filter((u) => (selected === "unplaced" ? !u.regionId || !ON_MAP.has(u.status) : u.regionId === selected && ON_MAP.has(u.status)));
  const unplacedCount = units.filter((u) => !u.regionId || !ON_MAP.has(u.status)).length;

  // Fills the DM's map shell: the map underneath, controls and key in the
  // bottom-left corner, the selected region (or the off-map units) in a side panel.
  return (
    <div className="relative h-full">
      <div className="glass absolute bottom-3 left-3 z-10 max-w-[min(36rem,calc(100%-1.5rem))] space-y-2 rounded-xl border border-border p-2.5 text-xs shadow-panel sm:left-[6.75rem]">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Show hidden units
          </label>
          <button type="button" className="rounded-md border border-border bg-raised px-2.5 py-1 hover:border-border-strong" onClick={() => setSelected("unplaced")}>
            Off-map units ({unplacedCount})
          </button>
          <button type="button" className="rounded-md border border-border bg-raised px-2.5 py-1 hover:border-border-strong" aria-expanded={showKey} onClick={() => setShowKey(!showKey)}>
            {showKey ? "Hide key" : "Map key"}
          </button>
        </div>
        {showKey && (
          <>
            <p className="text-muted">
              Click a region to see and edit what&apos;s there, or to place units. Click a unit badge to see every unit there; drag the badge to move them anywhere (tick units in its menu to move only those). Wild monsters move at once; for a team&apos;s units you choose an instant change or a move order. You can also drag a unit&apos;s ⠿ handle onto another region.
            </p>
            <span className="flex flex-wrap items-center gap-2 text-muted">
              {teams.map((t) => (
                <span key={t.id} className="flex items-center gap-1">
                  <TeamEmblem team={t} size={16} /> {t.name}
                </span>
              ))}
              <span className="flex items-center gap-1">
                <TeamEmblem team={null} size={16} /> Wild monsters
              </span>
              <span>· dashed badge = hidden units · ✝ = dead</span>
            </span>
          </>
        )}
      </div>
      {message && (
        <div className={`glass absolute top-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border px-4 py-1.5 text-sm shadow-panel ${message.ok ? "text-ok" : "text-danger"}`} role="status">
          {message.text}
          {message.undo && message.undo.length > 0 && (
            <button type="button" className="rounded-full border border-border px-2 py-0.5 text-xs text-foreground hover:border-border-strong disabled:opacity-50" disabled={pending} onClick={() => undoMove(message.undo!)}>
              Undo
            </button>
          )}
        </div>
      )}
      <MapSurface
        bare
        className="h-full"
        map3d={props.map3d}
        onHover={
          dragging
            ? (p) => {
                hover.current = p;
              }
            : undefined
        }
        width={size.width}
        height={size.height}
        imageUrl={props.mapImage ? `/api/assets/${props.mapImage.id}` : null}
        nodes={nodes}
        edges={edges}
        selectedNodeId={region?.id}
        onNodeClick={(id) => {
          setOpenSpot(null);
          setSelected(id);
        }}
        onBackgroundClick={() => {
          setOpenSpot(null);
          setSelected(null);
        }}
        onHandleMove={onHandleMove}
        onHandleClick={onHandleClick}
        terrain={terrain}
        overlay={(scale) => (
          <>
            {spots.map((groups) => (
              <SpotBadges key={groups[0].key} groups={groups} width={size.width} height={size.height} scale={scale} handle={(g) => `stack:${g.key}`} />
            ))}
            {moveLine && (
              <line
                x1={moveLine.from[0] * size.width}
                y1={moveLine.from[1] * size.height}
                x2={moveLine.to[0] * size.width}
                y2={moveLine.to[1] * size.height}
                stroke="var(--map-path)"
                strokeWidth={3 * scale}
                strokeDasharray={`${8 * scale} ${5 * scale}`}
                pointerEvents="none"
              />
            )}
          </>
        )}
        three={{
          tokens: spots.map((groups) => ({
            key: groups[0].key,
            at: groups[0].at,
            content: (
              <svg width={160} height={48} viewBox="-80 -24 160 48" overflow="visible" className="pointer-events-none block">
                <SpotBadges groups={groups} width={0} height={0} scale={1} handle={(g) => `stack:${g.key}`} />
              </svg>
            ),
          })),
          lines: moveLine ? [{ key: "dm-move", points: [moveLine.from, moveLine.to], colour: "var(--map-path)", dashed: true }] : [],
        }}
      />
      {openSpot && entriesAt.get(openSpot) && (
        <UnitRadial
          spot={openSpot}
          entries={entriesAt.get(openSpot)!}
          selected={ticked}
          onToggle={(e) => setTicked(toggleUnit(ticked, e))}
          onOpen={(e) => {
            const u = units.find((x) => x.id === e.id);
            if (u?.regionId) setSelected(u.regionId);
            setOpenUnit(e.id);
          }}
          onClose={() => setOpenSpot(null)}
        />
      )}
      <DmMoveConfirm
        pending={pendingMove}
        teamName={teamName}
        regionCode={regionCode}
        unitName={(id) => units.find((u) => u.id === id)?.name || creature(units.find((u) => u.id === id)?.creatureId ?? "")?.statBlock.name || "a unit"}
        busy={pending}
        onCancel={() => setPendingMove(null)}
        onConfirm={(mode, notes) => {
          if (!pendingMove) return;
          setPendingMove(null);
          sendMove(
            pendingMove.plan.teams.flatMap((t) => t.unitIds),
            pendingMove.regionId,
            pendingMove.at,
            mode,
            notes,
          );
          setTicked(new Set());
        }}
      />

      {(region || selected === "unplaced") && (
        <SidePanel title={region ? `${region.code}${region.name ? ` · ${region.name}` : ""}` : "Off-map units"} onClose={() => setSelected(null)}>
          <div className="space-y-3">
            {region && (
              <p className="text-sm text-muted">
                {region.ownerTeamId ? `Owned by ${team.get(region.ownerTeamId)?.name}` : "Unowned"}
                {region.settlementTierId ? ` · ${ruleset.settlementTiers.find((t) => t.id === region.settlementTierId)?.name ?? region.settlementTierId}` : ""}
                {region.buildings.length ? ` · ${region.buildings.map((b) => `${ruleset.buildings.find((x) => x.id === b.buildingId)?.name ?? b.buildingId} ${b.tier}`).join(", ")}` : ""}
                {region.hidden ? " · hidden region" : ""}
              </p>
            )}
            <ul className="space-y-2">
              {here.map((u) => (
                <UnitRow
                  key={openUnit === u.id ? `${u.id}:open` : u.id}
                  startOpen={openUnit === u.id}
                  greyed={isGreyed({ id: u.id, movable: true }, selectedAmong(ticked, here.map((x) => x.id)))}
                  unit={u}
                  ruleset={ruleset}
                  teams={teams}
                  regions={regions}
                  maxHp={maxHp(u)}
                  pending={pending}
                  onDragStart={(e) => setDragging({ unitId: u.id, x: e.clientX, y: e.clientY })}
                  onSave={(fields, hp) =>
                    startTransition(async () => {
                      const r = await updateUnitAction(gameId, u.id, fields, hp);
                      if (r.ok) {
                        update(r.value as UnitData);
                        report(true, `Saved ${r.value.name}.`);
                      } else report(false, r.error);
                    })
                  }
                  onDelete={() => {
                    if (!confirm(`Remove ${u.name} from the game completely? (To kill it, set its status to dead instead.)`)) return;
                    setUnits((us) => us.filter((x) => x.id !== u.id));
                    startTransition(() => deleteUnitAction(gameId, u.id));
                  }}
                />
              ))}
              {here.length === 0 && <li className="text-sm text-muted">No units here.</li>}
            </ul>
            {region && (
              <SpawnForm
                ruleset={ruleset}
                teams={teams}
                pending={pending}
                onSpawn={(fields, count) =>
                  startTransition(async () => {
                    const r = await spawnUnitsAction(gameId, { ...fields, regionId: region.id }, count);
                    if (r.ok) {
                      setUnits((us) => [...us, ...(r.value as UnitData[])]);
                      report(true, `Placed ${r.value.length} unit${r.value.length === 1 ? "" : "s"} in ${region.code}.`);
                    } else report(false, r.error);
                  })
                }
              />
            )}
          </div>
        </SidePanel>
      )}
      {dragging && (
        <div className="pointer-events-none fixed z-50 rounded-md bg-accent px-2 py-1 text-xs text-accent-foreground shadow" style={{ left: dragging.x + 8, top: dragging.y + 8 }}>
          {units.find((u) => u.id === dragging.unitId)?.name} → drop on a region
        </div>
      )}
    </div>
  );
}

function UnitRow(p: {
  unit: UnitData;
  /** Opened from the radial menu: start open, scrolled into view. */
  startOpen?: boolean;
  /** Left out of the units ticked to move in the radial menu. */
  greyed?: boolean;
  ruleset: Ruleset;
  teams: TeamData[];
  regions: RegionData[];
  maxHp: number;
  pending: boolean;
  onDragStart: (e: React.PointerEvent) => void;
  onSave: (fields: ReturnType<typeof unitFields>, hp: number) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(Boolean(p.startOpen));
  const [draft, setDraft] = useState(() => unitFields(p.unit));
  const [hp, setHp] = useState(p.unit.hp);
  const { ruleset } = p;
  const c = ruleset.creatures.find((x) => x.id === p.unit.creatureId);
  const owner = p.unit.ownerTeamId ? p.teams.find((t) => t.id === p.unit.ownerTeamId) : null;
  const archetype = ruleset.archetypes.find((a) => a.id === p.unit.archetypeId);
  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => setDraft({ ...draft, [k]: v });
  return (
    <li className={`rounded-lg border p-2 ${p.startOpen ? "border-accent" : "border-border"} ${p.greyed ? "opacity-50" : ""}`} ref={p.startOpen ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="cursor-grab touch-none px-1 text-muted"
          onPointerDown={(e) => {
            e.preventDefault();
            p.onDragStart(e);
          }}
          aria-label={`Drag ${p.unit.name} to another region`}
          title="Drag onto a region to move"
        >
          ⠿
        </button>
        <TeamEmblem team={owner ?? null} size={16} />
        <button type="button" className="min-w-0 flex-1 text-left text-sm" onClick={() => setOpen(!open)}>
          <span className="font-medium">{p.unit.name}</span>{" "}
          <span className="text-muted">
            {c?.statBlock.name ?? p.unit.creatureId}
            {archetype ? ` · ${archetype.name}` : ""} · {p.unit.hp}/{p.maxHp} HP
            {p.unit.status !== "active" ? ` · ${p.unit.status}` : ""}
            {p.unit.isLeader ? " · leader" : ""}
            {p.unit.lentToTeamId ? ` · lent to ${p.teams.find((t) => t.id === p.unit.lentToTeamId)?.name ?? "a team"}` : ""}
          </span>
        </button>
      </div>
      {open && (
        <div className="mt-2 grid grid-cols-2 gap-2 border-t border-border pt-2 text-xs">
          <label className="col-span-2">
            Name
            <input className={input} value={draft.name} onChange={(e) => set("name", e.target.value)} />
          </label>
          <label>
            HP (max {p.maxHp})
            <input className={input} type="number" min={0} value={hp} onChange={(e) => setHp(Number(e.target.value))} />
          </label>
          <label>
            Status
            <select className={input} value={draft.status} onChange={(e) => set("status", e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Owner
            <select className={input} value={draft.ownerTeamId ?? ""} onChange={(e) => set("ownerTeamId", e.target.value || null)}>
              <option value="">Wild monster</option>
              {p.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Region
            <select className={input} value={draft.regionId ?? ""} onChange={(e) => set("regionId", e.target.value || null)}>
              <option value="">— off the map —</option>
              {p.regions.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code}
                </option>
              ))}
            </select>
          </label>
          <label>
            Race
            <select className={input} value={draft.raceId ?? ""} onChange={(e) => set("raceId", e.target.value || null)}>
              <option value="">—</option>
              {ruleset.races.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Archetype
            <select className={input} value={draft.archetypeId ?? ""} onChange={(e) => set("archetypeId", e.target.value || null)}>
              <option value="">—</option>
              {ruleset.archetypes.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="col-span-2 flex items-center gap-2">
            <input type="checkbox" checked={draft.isLeader} onChange={(e) => set("isLeader", e.target.checked)} /> Faction leader (pays no upkeep)
          </label>
          <label className="col-span-2">
            Notes
            <textarea className={input} rows={2} value={draft.notes} onChange={(e) => set("notes", e.target.value)} />
          </label>
          <div className="col-span-2 flex gap-2">
            <button type="button" className="rounded-md bg-accent px-3 py-1.5 text-sm text-accent-foreground disabled:opacity-50" disabled={p.pending} onClick={() => p.onSave(draft, hp)}>
              Save
            </button>
            <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={() => setHp(p.maxHp)}>
              Full HP
            </button>
            <button type="button" className="ml-auto rounded-md border border-border px-3 py-1.5 text-sm text-danger" onClick={p.onDelete}>
              Remove
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function SpawnForm({ ruleset, teams, pending, onSpawn }: { ruleset: Ruleset; teams: TeamData[]; pending: boolean; onSpawn: (fields: Record<string, unknown>, count: number) => void }) {
  const recruitable = ruleset.creatures.filter((c) => c.recruitable);
  const monsters = ruleset.creatures.filter((c) => !c.recruitable);
  const [creatureId, setCreatureId] = useState(monsters[0]?.id ?? recruitable[0]?.id ?? "");
  const [owner, setOwner] = useState("");
  const [raceId, setRaceId] = useState("");
  const [archetypeId, setArchetypeId] = useState("");
  const [status, setStatus] = useState("active");
  const [count, setCount] = useState(1);
  const [name, setName] = useState("");
  const category = ruleset.creatures.find((c) => c.id === creatureId)?.category;
  const archetypes = ruleset.archetypes.filter((a) => !category || a.categories.includes(category));
  // An archetype chosen for a previous creature may not suit this one.
  const archetype = archetypes.some((a) => a.id === archetypeId) ? archetypeId : "";
  return (
    <fieldset className="space-y-2 rounded-lg border border-border p-3 text-xs">
      <legend className="px-1 font-medium text-muted">Place units here</legend>
      <label className="block">
        Creature
        <select className={input} value={creatureId} onChange={(e) => setCreatureId(e.target.value)}>
          <optgroup label="Monsters">
            {monsters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.statBlock.name} (CR {formatCr(c.statBlock.cr)})
              </option>
            ))}
          </optgroup>
          <optgroup label="Recruitable units">
            {recruitable.map((c) => (
              <option key={c.id} value={c.id}>
                {c.statBlock.name} (CR {formatCr(c.statBlock.cr)})
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label>
          Owner
          <select className={input} value={owner} onChange={(e) => setOwner(e.target.value)}>
            <option value="">Wild monster</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select className={input} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">Visible</option>
            <option value="hidden">Hidden</option>
          </select>
        </label>
        <label>
          Race
          <select className={input} value={raceId} onChange={(e) => setRaceId(e.target.value)}>
            <option value="">—</option>
            {ruleset.races.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Archetype
          <select className={input} value={archetype} onChange={(e) => setArchetypeId(e.target.value)} disabled={!archetypes.length}>
            <option value="">{archetypes.length ? "—" : "none available"}</option>
            {archetypes.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Name (optional)
          <input className={input} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          How many
          <input className={input} type="number" min={1} max={20} value={count} onChange={(e) => setCount(Math.max(1, Math.min(20, Number(e.target.value))))} />
        </label>
      </div>
      <button
        type="button"
        disabled={!creatureId || pending}
        className="rounded-md bg-accent px-3 py-1.5 text-sm text-accent-foreground disabled:opacity-50"
        onClick={() => {
          onSpawn(
            { name, creatureId, ownerTeamId: owner || null, raceId: raceId || null, archetypeId: archetype || null, status, isLeader: false, academyBonus: {}, augmentIds: [], notes: "" },
            count,
          );
          setCount(1);
          setName("");
        }}
      >
        Place
      </button>
    </fieldset>
  );
}

/**
 * The DM dropped a team's units somewhere: move them now (no miles, no fight,
 * logged and undoable) or add the move to the team's orders for this round
 * (resolved like the team's own). Either can send the team a note.
 */
function DmMoveConfirm({
  pending,
  teamName,
  regionCode,
  unitName,
  busy,
  onCancel,
  onConfirm,
}: {
  pending: PendingMove | null;
  teamName: (id: string) => string;
  regionCode: (id: string) => string;
  unitName: (id: string) => string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (mode: "instant" | "order", notes: Record<string, TeamNote>) => void;
}) {
  const [note, setNote] = useState<TeamNoteState>(NO_NOTE);
  const teams = pending?.plan.teams ?? [];
  const where = pending ? regionCode(pending.regionId) : "";
  const names = joinList(teams.map((t) => teamName(t.teamId)));
  // One note option for every team moved; until the DM types their own, each team gets its own text.
  const suggested = (asOrder: boolean) => (t: (typeof teams)[number]) => dmMoveNote(t.unitIds.map(unitName), where, asOrder);
  const confirm = (mode: "instant" | "order") => {
    const notes = Object.fromEntries(teams.map((t) => [t.teamId, noteFor(note, suggested(mode === "order")(t))]));
    setNote(NO_NOTE);
    onConfirm(mode, notes);
  };
  const cancel = () => {
    setNote(NO_NOTE);
    onCancel();
  };
  return (
    <Modal open={Boolean(pending)} onClose={cancel} title={`Move ${names}'s units?`}>
      {pending && (
        <div className="space-y-3 text-sm">
          <ul className="space-y-0.5 text-muted">
            {teams.map((t) => (
              <li key={t.teamId}>
                <strong className="text-foreground">{teamName(t.teamId)}</strong>: {joinList(t.unitIds.map(unitName))} → {where}
              </li>
            ))}
          </ul>
          <button type="button" disabled={busy} className="block w-full rounded-lg border border-border bg-raised px-3 py-2 text-left hover:border-accent disabled:opacity-50" onClick={() => confirm("instant")}>
            <span className="font-medium">Instant change</span>
            <span className="mt-0.5 block text-xs text-muted">Moved now. No miles used, no fight. Written to the audit log, and you can undo it.</span>
          </button>
          <button type="button" disabled={busy} className="block w-full rounded-lg border border-border bg-raised px-3 py-2 text-left hover:border-accent disabled:opacity-50" onClick={() => confirm("order")}>
            <span className="font-medium">Add as a move order for {names}</span>
            <span className="mt-0.5 block text-xs text-muted">Added to {teams.length === 1 ? "the team's" : "each team's"} orders for this round and resolved like their own moves (borders and miles apply then). Undo it from the team&apos;s DM log.</span>
          </button>
          <TeamNoteOption suggested={suggested(false)(teams[0])} value={note} onChange={setNote} teamName={teams.length === 1 ? teamName(teams[0].teamId) : undefined} />
          {note.send && note.text === null && (
            <p className="text-xs text-muted">
              {teams.length > 1 ? "Each team gets a note about its own units. " : ""}As a move order, the note says the DM added a move to their orders.
            </p>
          )}
          <div className="flex justify-end">
            <Button variant="secondary" onClick={cancel}>
              Don&apos;t move
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
