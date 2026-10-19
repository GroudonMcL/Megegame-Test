"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { deriveStats, unitBonuses } from "@/engine/ruleset/derive";
import { formatCr } from "@/engine/ruleset/common";
import type { Ruleset } from "@/engine/ruleset/ruleset";
import { deleteUnitAction, moveUnitAction, spawnUnitsAction, updateUnitAction } from "@/app/dm/games/[gameId]/map/actions";
import { SidePanel } from "@/components/shell/SidePanel";
import { MapCanvas, type MapNode } from "./MapCanvas";
import { connectionEdges, terrainLayer } from "./mapLayers";
import { groupBadges, SpotBadges } from "./UnitBadges";
import { DEFAULT_MAP_SIZE, type ConnectionData, type MapImageData, type RegionData, type TeamData, type TerrainAreaData, type UnitData } from "./mapData";
import { TeamEmblem } from "@/components/icons/TeamEmblem";

const STATUSES = ["active", "hidden", "dead", "captured", "tamed", "stored", "disbanded"] as const;
const ON_MAP = new Set(["active", "hidden", "dead"]);
const input = "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm";

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
}) {
  const { gameId, ruleset, regions, connections, teams } = props;
  const [units, setUnits] = useState(props.units);
  const [selected, setSelected] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(true);
  const [showKey, setShowKey] = useState(false);
  const [dragging, setDragging] = useState<{ unitId: string; x: number; y: number } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
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

  /** Units on the map, grouped by where they stand and who owns them. */
  const spots = useMemo(
    () =>
      groupBadges(
        units
          .filter((u) => u.regionId && ON_MAP.has(u.status) && (showHidden || u.status !== "hidden"))
          .map((u) => ({ regionId: u.regionId!, x: u.x, y: u.y, ownerTeamId: u.ownerTeamId, dead: u.status === "dead", hidden: u.status === "hidden" })),
        (id) => {
          const r = regionById.get(id);
          return r ? [r.x, r.y] : undefined;
        },
        (id) => team.get(id),
      ),
    [units, showHidden, regionById, team],
  );

  const update = (u: UnitData) => setUnits((us) => us.map((x) => (x.id === u.id ? u : x)));
  const report = (ok: boolean, text: string) => setMessage({ ok, text });

  const moveUnit = (unitId: string, regionId: string | null) =>
    startTransition(async () => {
      const r = await moveUnitAction(gameId, unitId, regionId);
      if (r.ok) {
        update(r.value as UnitData);
        report(true, `Moved ${r.value.name} to ${regionCode(regionId)}.`);
      } else report(false, r.error);
    });

  // Dragging a unit from the side panel onto a region node moves it there.
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => setDragging((d) => (d ? { ...d, x: e.clientX, y: e.clientY } : d));
    const up = (e: PointerEvent) => {
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-node-id]")?.getAttribute("data-node-id");
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
            <p className="text-muted">Click a region to see and edit what&apos;s there, or to place units. Drag a unit&apos;s ⠿ handle onto another region to move it.</p>
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
        <p className={`glass absolute top-3 left-1/2 z-20 -translate-x-1/2 rounded-full border border-border px-4 py-1.5 text-sm shadow-panel ${message.ok ? "text-ok" : "text-danger"}`} role="status">
          {message.text}
        </p>
      )}
      <MapCanvas
        bare
        className="h-full"
        width={size.width}
        height={size.height}
        imageUrl={props.mapImage ? `/api/assets/${props.mapImage.id}` : null}
        nodes={nodes}
        edges={edges}
        selectedNodeId={region?.id}
        onNodeClick={(id) => setSelected(id)}
        onBackgroundClick={() => setSelected(null)}
        terrain={terrain}
        overlay={(scale) => spots.map((groups) => <SpotBadges key={groups[0].key} groups={groups} width={size.width} height={size.height} scale={scale} />)}
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
                  key={u.id}
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
  ruleset: Ruleset;
  teams: TeamData[];
  regions: RegionData[];
  maxHp: number;
  pending: boolean;
  onDragStart: (e: React.PointerEvent) => void;
  onSave: (fields: ReturnType<typeof unitFields>, hp: number) => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => unitFields(p.unit));
  const [hp, setHp] = useState(p.unit.hp);
  const { ruleset } = p;
  const c = ruleset.creatures.find((x) => x.id === p.unit.creatureId);
  const owner = p.unit.ownerTeamId ? p.teams.find((t) => t.id === p.unit.ownerTeamId) : null;
  const archetype = ruleset.archetypes.find((a) => a.id === p.unit.archetypeId);
  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => setDraft({ ...draft, [k]: v });
  return (
    <li className="rounded-lg border border-border p-2">
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
