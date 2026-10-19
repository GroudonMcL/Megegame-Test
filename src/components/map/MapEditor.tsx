"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Ruleset } from "@/engine/ruleset/ruleset";
import { parseRegionCsv } from "@/engine/map/csv";
import {
  createConnectionAction,
  createRegionAction,
  deleteConnectionAction,
  deleteRegionAction,
  importRegionsAction,
  moveRegionAction,
  updateConnectionAction,
  updateRegionAction,
  uploadMapImageAction,
} from "@/app/dm/games/[gameId]/map/actions";
import { Fields, type FieldSpec } from "../editor/fields";
import { compressImage } from "./compressImage";
import { MapCanvas, type MapEdge, type MapNode } from "./MapCanvas";
import { DEFAULT_MAP_SIZE, regionPatch, type ConnectionData, type MapImageData, type RegionData, type TeamData } from "./mapData";

type Mode = "select" | "add" | "connect";
type Selection = { kind: "region"; id: string } | { kind: "connection"; id: string } | null;

const button = "rounded-md border border-border px-3 py-1.5 text-sm hover:bg-background disabled:opacity-50";

function regionFields(teams: TeamData[]): FieldSpec[] {
  return [
    { kind: "text", key: "code", label: "ID", help: "e.g. A1" },
    { kind: "text", key: "name", label: "Name" },
    { kind: "textarea", key: "description", label: "Description", rows: 3 },
    { kind: "checkbox", key: "settleable", label: "Can be settled" },
    { kind: "checkbox", key: "hidden", label: "Hidden (not yet discovered)" },
    { kind: "select", key: "ownerTeamId", label: "Owner", options: teams.map((t) => ({ value: t.id, label: t.name })), nullable: true, nullLabel: "— unowned —" },
    { kind: "select", key: "settlementTierId", label: "Settlement", options: { ref: "settlementTiers" }, nullable: true, nullLabel: "— none —" },
    {
      kind: "list",
      key: "buildings",
      label: "Buildings",
      itemLabel: (b) => `${b.buildingId || "?"} (tier ${b.tier})`,
      newItem: () => ({ buildingId: "", tier: 1 }),
      fields: [
        { kind: "select", key: "buildingId", label: "Building", options: { ref: "buildings" } },
        { kind: "number", key: "tier", label: "Tier", min: 1 },
        { kind: "text", key: "choice", label: "Choice (e.g. Academy ability)" },
      ],
    },
    {
      kind: "list",
      key: "structures",
      label: "Ruins and dungeons",
      itemLabel: (s) => `${s.kind === "dungeon" ? "Dungeon" : "Ruin"}: ${s.name || "unnamed"}`,
      newItem: () => ({ kind: "ruin", name: "", description: "", searched: false, hidden: false }),
      fields: [
        { kind: "select", key: "kind", label: "Kind", options: [{ value: "ruin", label: "Ruin" }, { value: "dungeon", label: "Dungeon" }] },
        { kind: "text", key: "name", label: "Name" },
        { kind: "textarea", key: "description", label: "Description", rows: 2 },
        { kind: "checkbox", key: "searched", label: "Already explored" },
        { kind: "checkbox", key: "hidden", label: "Hidden until found" },
      ],
    },
    {
      kind: "list",
      key: "deposits",
      label: "Deposits",
      itemLabel: (d) => `${d.name || "Deposit"}${d.hidden ? " (hidden)" : ""}`,
      newItem: () => ({ id: crypto.randomUUID(), name: "", note: "", hidden: true }),
      fields: [
        { kind: "text", key: "name", label: "Name", wide: true },
        { kind: "text", key: "note", label: "Note" },
        { kind: "checkbox", key: "hidden", label: "Hidden until found" },
        { kind: "resources", key: "production", label: "Income once claimed", nullable: true },
      ],
    },
    { kind: "effects", key: "features", label: "Region features (hazards, special rules)" },
    { kind: "textarea", key: "notes", label: "DM notes", rows: 2 },
  ];
}

const connectionFields: FieldSpec[] = [
  { kind: "number", key: "miles", label: "Length in miles (empty = default)", nullable: true, step: 1 },
  { kind: "select", key: "terrainId", label: "Terrain", options: { ref: "terrainTypes" } },
  { kind: "checkbox", key: "hidden", label: "Hidden (not yet discovered)" },
];

export function MapEditor(props: {
  gameId: string;
  ruleset: Ruleset;
  regions: RegionData[];
  connections: ConnectionData[];
  teams: TeamData[];
  mapImage: MapImageData | null;
}) {
  const { gameId, ruleset, teams } = props;
  const router = useRouter();
  const [regions, setRegions] = useState(props.regions);
  const [connections, setConnections] = useState(props.connections);
  const [mapImage, setMapImage] = useState(props.mapImage);
  const [mode, setMode] = useState<Mode>("select");
  const [selection, setSelection] = useState<Selection>(null);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [snap, setSnap] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [csvOpen, setCsvOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  // Server data wins after a refresh (e.g. after a CSV import).
  const [serverData, setServerData] = useState(props);
  if (serverData.regions !== props.regions || serverData.connections !== props.connections || serverData.mapImage !== props.mapImage) {
    setServerData(props);
    setRegions(props.regions);
    setConnections(props.connections);
    setMapImage(props.mapImage);
  }

  const size = mapImage ?? DEFAULT_MAP_SIZE;
  const teamColour = useMemo(() => new Map(teams.map((t) => [t.id, t.colour])), [teams]);
  const ctx = useMemo(() => ({ ruleset }), [ruleset]);
  const fields = useMemo(() => regionFields(teams), [teams]);
  const terrainName = (id: string) => ruleset.terrainTypes.find((t) => t.id === id)?.name ?? id;
  const defaultMiles = ruleset.settings.movement.defaultConnectionMiles;

  const nodes: MapNode[] = regions.map((r) => ({
    id: r.id,
    x: r.x,
    y: r.y,
    label: r.name ? `${r.code} ${r.name}` : r.code,
    fill: r.ownerTeamId ? teamColour.get(r.ownerTeamId) : r.settleable ? "var(--map-region)" : "var(--map-region-unsettleable)",
    ring: Boolean(r.settlementTierId),
    dashed: r.hidden,
    dim: r.hidden,
  }));
  const edges: MapEdge[] = connections.map((c) => {
    const terrain = ruleset.terrainTypes.find((t) => t.id === c.terrainId);
    return { id: c.id, a: c.regionA, b: c.regionB, dashed: c.hidden, dim: c.hidden, heavy: (terrain?.costMultiplier ?? 1) > 1, colour: terrain?.requiresMovement.length ? "var(--map-water)" : undefined };
  });

  const report = (ok: boolean, text: string) => setMessage({ ok, text });

  const connect = (a: string, b: string) =>
    startTransition(async () => {
      const r = await createConnectionAction(gameId, a, b);
      if (r.ok) setConnections((cs) => [...cs, r.value as ConnectionData]);
      else report(false, r.error);
    });

  const onNodeClick = (id: string, e: { shiftKey: boolean }) => {
    if (mode === "connect") {
      if (linkFrom && linkFrom !== id) {
        connect(linkFrom, id);
        setLinkFrom(id);
      } else setLinkFrom(id);
      return;
    }
    if (e.shiftKey && selection?.kind === "region" && selection.id !== id) {
      connect(selection.id, id);
      return;
    }
    setSelection({ kind: "region", id });
  };

  const onBackgroundClick = (x: number, y: number) => {
    if (mode === "add") {
      startTransition(async () => {
        const row = (await createRegionAction(gameId, x, y)) as RegionData;
        setRegions((rs) => [...rs, row]);
        setSelection({ kind: "region", id: row.id });
      });
      return;
    }
    if (mode === "connect") setLinkFrom(null);
    setSelection(null);
  };

  const onNodeMove = (id: string, x: number, y: number) => {
    setRegions((rs) => rs.map((r) => (r.id === id ? { ...r, x, y } : r)));
    startTransition(() => moveRegionAction(gameId, id, x, y));
  };

  const deleteSelected = () => {
    if (!selection) return;
    if (selection.kind === "region") {
      const r = regions.find((x) => x.id === selection.id);
      if (!r || !confirm(`Delete region ${r.code}? Its connections go too, and any units in it are left without a location.`)) return;
      setRegions((rs) => rs.filter((x) => x.id !== r.id));
      setConnections((cs) => cs.filter((c) => c.regionA !== r.id && c.regionB !== r.id));
      startTransition(() => deleteRegionAction(gameId, r.id));
    } else {
      setConnections((cs) => cs.filter((c) => c.id !== selection.id));
      startTransition(() => deleteConnectionAction(gameId, selection.id));
    }
    setSelection(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "Escape") {
        setLinkFrom(null);
        setSelection(null);
      } else if (e.key === "v") setMode("select");
      else if (e.key === "a") setMode("add");
      else if (e.key === "c") setMode("connect");
      else if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onUpload = async (file: File) => {
    try {
      report(true, "Shrinking and uploading the image…");
      const { blob, width, height } = await compressImage(file);
      const form = new FormData();
      form.set("image", blob, "map");
      form.set("width", String(width));
      form.set("height", String(height));
      const r = await uploadMapImageAction(gameId, form);
      if (r.ok) {
        setMapImage(r.value);
        report(true, `Map image uploaded (${width} × ${height}).`);
      } else report(false, r.error);
    } catch (err) {
      report(false, err instanceof Error ? err.message : "Upload failed.");
    }
  };

  const selectedRegion = selection?.kind === "region" ? regions.find((r) => r.id === selection.id) : undefined;
  const selectedConnection = selection?.kind === "connection" ? connections.find((c) => c.id === selection.id) : undefined;
  const code = (id: string) => regions.find((r) => r.id === id)?.code ?? "?";

  const modeButton = (m: Mode, label: string, key: string) => (
    <button
      type="button"
      onClick={() => {
        setMode(m);
        setLinkFrom(null);
      }}
      className={`rounded-md px-3 py-1.5 text-sm ${mode === m ? "bg-accent text-accent-foreground" : "border border-border hover:bg-background"}`}
      aria-pressed={mode === m}
      title={`Shortcut: ${key}`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {modeButton("select", "Select / move", "V")}
        {modeButton("add", "Add region", "A")}
        {modeButton("connect", "Connect", "C")}
        <span className="mx-1 h-6 w-px bg-border" />
        <button type="button" className={button} onClick={() => fileRef.current?.click()} disabled={pending}>
          {mapImage ? "Replace map image" : "Upload map image"}
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
        <button type="button" className={button} onClick={() => setCsvOpen(true)}>
          Import regions (CSV)
        </button>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Snap to grid
        </label>
        <span className="text-sm text-muted">
          {regions.length} regions · {connections.length} connections
        </span>
      </div>
      <p className="text-sm text-muted">
        {mode === "select" && "Click a region to edit it, drag to move it, or click a connection. Shift-click another region to connect it to the selected one. Drag the background to pan; scroll or pinch to zoom."}
        {mode === "add" && "Click anywhere on the map to add a region."}
        {mode === "connect" && (linkFrom ? `Click another region to connect it to ${code(linkFrom)}. Press Esc to stop.` : "Click the first region of the connection.")}
      </p>
      {message && (
        <p className={`text-sm ${message.ok ? "text-ok" : "text-danger"}`} role="status">
          {message.text}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_24rem] [&>*]:min-w-0">
        <MapCanvas
          width={size.width}
          height={size.height}
          imageUrl={mapImage ? `/api/assets/${mapImage.id}` : null}
          nodes={nodes}
          edges={edges}
          selectedNodeId={selectedRegion?.id ?? linkFrom}
          selectedEdgeId={selectedConnection?.id}
          draggable={mode === "select"}
          snap={snap ? Math.max(size.width, size.height) / 80 : null}
          onNodeMove={onNodeMove}
          onNodeClick={onNodeClick}
          onEdgeClick={(id) => mode === "select" && setSelection({ kind: "connection", id })}
          onBackgroundClick={onBackgroundClick}
          linkFrom={mode === "connect" ? linkFrom : null}
        />

        <aside className="min-w-0 glass rounded-xl border border-border shadow-panel p-4 lg:max-h-[70vh] lg:overflow-y-auto">
          {selectedRegion && (
            <RegionPanel
              key={selectedRegion.id}
              region={selectedRegion}
              fields={fields}
              ctx={ctx}
              onSave={(patch) =>
                startTransition(async () => {
                  const r = await updateRegionAction(gameId, selectedRegion.id, patch);
                  if (r.ok) {
                    setRegions((rs) => rs.map((x) => (x.id === selectedRegion.id ? (r.value as RegionData) : x)));
                    report(true, `Saved ${r.value.code}.`);
                  } else report(false, r.error);
                })
              }
              onDelete={deleteSelected}
              pending={pending}
              connections={connections.filter((c) => c.regionA === selectedRegion.id || c.regionB === selectedRegion.id).map((c) => ({ id: c.id, to: code(c.regionA === selectedRegion.id ? c.regionB : c.regionA), terrain: terrainName(c.terrainId), miles: c.miles ?? defaultMiles, hidden: c.hidden }))}
              onSelectConnection={(id) => setSelection({ kind: "connection", id })}
            />
          )}
          {selectedConnection && (
            <ConnectionPanel
              key={selectedConnection.id}
              connection={selectedConnection}
              title={[code(selectedConnection.regionA), code(selectedConnection.regionB)].sort().join(" ↔ ")}
              defaultMiles={defaultMiles}
              ctx={ctx}
              pending={pending}
              onSave={(patch) =>
                startTransition(async () => {
                  const r = await updateConnectionAction(gameId, selectedConnection.id, patch);
                  if (r.ok) {
                    setConnections((cs) => cs.map((x) => (x.id === selectedConnection.id ? (r.value as ConnectionData) : x)));
                    report(true, "Saved the connection.");
                  } else report(false, r.error);
                })
              }
              onDelete={deleteSelected}
            />
          )}
          {!selection && (
            <div className="space-y-2 text-sm text-muted">
              <p className="font-medium text-foreground">Nothing selected</p>
              <p>Pick a region or connection on the map to edit it.</p>
              <p>Legend: filled circles are owned (team colour), grey circles are unowned, dark grey can&apos;t be settled, a ring means a settlement, and dashed means hidden. Thick lines are slow terrain; blue lines need swimming, climbing or flying.</p>
            </div>
          )}
        </aside>
      </div>

      {csvOpen && (
        <CsvDialog
          onClose={() => setCsvOpen(false)}
          onImport={(text) =>
            startTransition(async () => {
              const r = await importRegionsAction(gameId, text);
              if (r.ok) {
                report(true, `Imported: ${r.value.created} new regions, ${r.value.updated} updated.${r.value.problems.length ? ` Notes: ${r.value.problems.join(" ")}` : ""}`);
                setCsvOpen(false);
                router.refresh();
              } else report(false, r.error);
            })
          }
          pending={pending}
        />
      )}
    </div>
  );
}

function RegionPanel(props: {
  region: RegionData;
  fields: FieldSpec[];
  ctx: { ruleset: Ruleset };
  onSave: (patch: ReturnType<typeof regionPatch>) => void;
  onDelete: () => void;
  pending: boolean;
  connections: { id: string; to: string; terrain: string; miles: number; hidden: boolean }[];
  onSelectConnection: (id: string) => void;
}) {
  const [draft, setDraft] = useState(() => regionPatch(props.region));
  const [dirty, setDirty] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">Region {props.region.code}</h3>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-md bg-accent px-3 py-1.5 text-sm text-accent-foreground disabled:opacity-50"
            disabled={!dirty || props.pending}
            onClick={() => {
              props.onSave(draft);
              setDirty(false);
            }}
          >
            Save
          </button>
          <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm text-danger" onClick={props.onDelete}>
            Delete
          </button>
        </div>
      </div>
      <Fields
        fields={props.fields}
        value={draft}
        onChange={(v) => {
          setDraft(v as typeof draft);
          setDirty(true);
        }}
        ctx={props.ctx}
      />
      <div>
        <p className="mb-1 text-xs font-medium text-muted">Connections</p>
        {props.connections.length === 0 && <p className="text-sm text-muted">None yet. Use Connect mode, or shift-click another region.</p>}
        <ul className="space-y-1 text-sm">
          {props.connections.map((c) => (
            <li key={c.id}>
              <button type="button" className="text-link underline" onClick={() => props.onSelectConnection(c.id)}>
                → {c.to}
              </button>{" "}
              <span className="text-muted">
                {c.terrain}, {c.miles} miles{c.hidden ? ", hidden" : ""}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ConnectionPanel(props: {
  connection: ConnectionData;
  title: string;
  defaultMiles: number;
  ctx: { ruleset: Ruleset };
  pending: boolean;
  onSave: (patch: { miles: number | null; terrainId: string; hidden: boolean }) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState({ miles: props.connection.miles, terrainId: props.connection.terrainId, hidden: props.connection.hidden });
  const [dirty, setDirty] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">Connection {props.title}</h3>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-md bg-accent px-3 py-1.5 text-sm text-accent-foreground disabled:opacity-50"
            disabled={!dirty || props.pending}
            onClick={() => {
              props.onSave(draft);
              setDirty(false);
            }}
          >
            Save
          </button>
          <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm text-danger" onClick={props.onDelete}>
            Delete
          </button>
        </div>
      </div>
      <p className="text-sm text-muted">Default length is {props.defaultMiles} miles (Game settings → Movement).</p>
      <Fields
        fields={connectionFields}
        value={draft}
        onChange={(v) => {
          setDraft(v as typeof draft);
          setDirty(true);
        }}
        ctx={props.ctx}
      />
    </div>
  );
}

function CsvDialog({ onClose, onImport, pending }: { onClose: () => void; onImport: (text: string) => void; pending: boolean }) {
  const [text, setText] = useState("");
  const preview = useMemo(() => (text.trim() ? parseRegionCsv(text) : null), [text]);
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-overlay p-4" role="dialog" aria-modal="true" aria-label="Import regions">
      <div className="w-full max-w-3xl space-y-3 glass rounded-xl border border-border p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Import regions from a spreadsheet</h3>
          <button type="button" className={button} onClick={onClose}>
            Close
          </button>
        </div>
        <p className="text-sm text-muted">
          Save your spreadsheet as CSV (in Google Sheets: File → Download → CSV). Columns: <strong>Region ID</strong>, Name, Description, Features, Ruin Name, Ruin Description, Dungeon Name, Dungeon Description, Settleable. Regions that already exist (same ID) are updated; new ones are placed in a grid for you to drag into position.
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          className="text-sm"
          aria-label="CSV file"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setText(await f.text());
          }}
        />
        <textarea className="h-40 w-full rounded-md border border-border bg-background p-2 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder="…or paste the CSV here" aria-label="CSV text" />
        {preview && (
          <div className="rounded-lg border border-border p-3 text-sm">
            <p>
              Found <strong>{preview.regions.length}</strong> regions.
              {Object.keys(preview.columns).length > 0 && <span className="text-muted"> Columns used: {Object.entries(preview.columns).map(([k, v]) => `${v} → ${k}`).join(", ")}.</span>}
            </p>
            {preview.problems.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-xs text-danger">
                {preview.problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}
            {preview.regions.length > 0 && (
              <p className="mt-1 text-xs text-muted">
                First few: {preview.regions.slice(0, 5).map((r) => `${r.code}${r.name ? ` (${r.name})` : ""}`).join(", ")}
              </p>
            )}
          </div>
        )}
        <button type="button" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50" disabled={!preview?.regions.length || pending} onClick={() => onImport(text)}>
          {pending ? "Importing…" : `Import ${preview?.regions.length ?? 0} regions`}
        </button>
      </div>
    </div>
  );
}
