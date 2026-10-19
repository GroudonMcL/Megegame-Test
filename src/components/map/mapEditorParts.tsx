"use client";

import { useMemo, useState } from "react";
import { parseRegionCsv } from "@/engine/map/csv";
import type { Ruleset } from "@/engine/ruleset/ruleset";
import { Fields, type FieldSpec } from "../editor/fields";
import { regionPatch, type ConnectionData, type RegionData, type TeamData, type TerrainAreaData } from "./mapData";

// The side panels and dialogs of the map editor (MapEditor.tsx).

const button = "rounded-md border border-border px-3 py-1.5 text-sm hover:bg-background disabled:opacity-50";
const primary = "rounded-md bg-accent px-3 py-1.5 text-sm text-accent-foreground disabled:opacity-50";
const danger = "rounded-md border border-border px-3 py-1.5 text-sm text-danger";

export function regionFields(teams: TeamData[]): FieldSpec[] {
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


/** A region's details: the form, then its borders with each neighbour and its links. */
export function RegionPanel(props: {
  region: RegionData;
  fields: FieldSpec[];
  ctx: { ruleset: Ruleset };
  onSave: (patch: ReturnType<typeof regionPatch>) => void;
  onDelete: () => void;
  onRedraw: () => void;
  pending: boolean;
  borders: { connection: ConnectionData; to: string }[];
  links: { connection: ConnectionData; to: string }[];
  onBorder: (c: ConnectionData, patch: { blocked?: boolean; hidden?: boolean }) => void;
  onSelectConnection: (id: string) => void;
}) {
  const [draft, setDraft] = useState(() => regionPatch(props.region));
  const [dirty, setDirty] = useState(false);
  const shaped = props.region.polygon.length >= 3;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">Region {props.region.code}</h3>
        <div className="flex gap-2">
          <button
            type="button"
            className={primary}
            disabled={!dirty || props.pending}
            onClick={() => {
              props.onSave(draft);
              setDirty(false);
            }}
          >
            Save
          </button>
          <button type="button" className={danger} onClick={props.onDelete}>
            Delete
          </button>
        </div>
      </div>
      <p className="text-xs text-muted">
        {shaped ? "Drag the dot in the region to move its centre (where its name and new units go)." : "This region has no shape yet."}{" "}
        <button type="button" className="text-link underline" onClick={props.onRedraw}>
          {shaped ? "Redraw its shape" : "Draw its shape"}
        </button>
      </p>
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
        <p className="mb-1 text-xs font-medium text-muted">Borders (with each region it touches)</p>
        {props.borders.length === 0 && <p className="text-sm text-muted">It doesn&apos;t touch any other region.</p>}
        <ul className="space-y-1 text-sm">
          {props.borders.map(({ connection: c, to }) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3">
              <span className="min-w-12 font-medium">{to}</span>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={c.blocked} disabled={props.pending} onChange={(e) => props.onBorder(c, { blocked: e.target.checked })} /> blocked
              </label>
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={c.hidden} disabled={props.pending} onChange={(e) => props.onBorder(c, { hidden: e.target.checked })} /> hidden
              </label>
            </li>
          ))}
        </ul>
      </div>
      {props.links.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium text-muted">Links</p>
          <ul className="space-y-1 text-sm">
            {props.links.map(({ connection: c, to }) => (
              <li key={c.id}>
                <button type="button" className="text-link underline" onClick={() => props.onSelectConnection(c.id)}>
                  → {to}
                </button>
                <span className="text-muted">{c.hidden ? " · hidden" : ""}{c.blocked ? " · blocked" : ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

const linkFields: FieldSpec[] = [
  { kind: "number", key: "miles", label: "Length in miles (empty = straight-line distance on the map)", nullable: true, step: 1 },
  { kind: "select", key: "terrainId", label: "Terrain along the way", options: { ref: "terrainTypes" } },
  { kind: "checkbox", key: "hidden", label: "Hidden (not yet discovered)" },
  { kind: "checkbox", key: "blocked", label: "Blocked (nobody can use it)" },
];

/** A link (or a blocked border clicked on the map). */
export function ConnectionPanel(props: {
  connection: ConnectionData;
  title: string;
  ctx: { ruleset: Ruleset };
  pending: boolean;
  onSave: (patch: { miles: number | null; terrainId: string; hidden: boolean; blocked: boolean }) => void;
  onDelete: () => void;
}) {
  const c = props.connection;
  const [draft, setDraft] = useState({ miles: c.miles, terrainId: c.terrainId, hidden: c.hidden, blocked: c.blocked });
  const [dirty, setDirty] = useState(false);
  const border = c.kind === "border";
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">
          {border ? "Border" : "Link"} {props.title}
        </h3>
        <div className="flex gap-2">
          <button
            type="button"
            className={primary}
            disabled={!dirty || props.pending}
            onClick={() => {
              props.onSave(draft);
              setDirty(false);
            }}
          >
            Save
          </button>
          {!border && (
            <button type="button" className={danger} onClick={props.onDelete}>
              Delete
            </button>
          )}
        </div>
      </div>
      <p className="text-sm text-muted">
        {border
          ? "These regions touch, so they share this border. Block it to stop units (and sight) crossing; hide it to make teams discover it first."
          : "A way between regions that don't touch, like a tunnel or a sea lane. Units take it from anywhere in one region to the centre of the other."}
      </p>
      <Fields
        fields={border ? linkFields.filter((f) => f.key === "hidden" || f.key === "blocked") : linkFields}
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

/** A terrain area: its type and name. Its shape is edited on the map. */
export function TerrainPanel(props: {
  area: TerrainAreaData;
  ctx: { ruleset: Ruleset };
  pending: boolean;
  onSave: (patch: { terrainId: string; name: string }) => void;
  onDelete: () => void;
  onEditShape: () => void;
}) {
  const [draft, setDraft] = useState({ terrainId: props.area.terrainId, name: props.area.name });
  const [dirty, setDirty] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">Terrain area</h3>
        <div className="flex gap-2">
          <button
            type="button"
            className={primary}
            disabled={!dirty || props.pending}
            onClick={() => {
              props.onSave(draft);
              setDirty(false);
            }}
          >
            Save
          </button>
          <button type="button" className={danger} onClick={props.onDelete}>
            Delete
          </button>
        </div>
      </div>
      <Fields
        fields={[
          { kind: "select", key: "terrainId", label: "Terrain type", options: { ref: "terrainTypes" } },
          { kind: "text", key: "name", label: "Name (for you; players see the terrain type)" },
        ]}
        value={draft}
        onChange={(v) => {
          setDraft(v as typeof draft);
          setDirty(true);
        }}
        ctx={props.ctx}
      />
      <button type="button" className={button} onClick={props.onEditShape}>
        Edit its shape
      </button>
    </div>
  );
}

export function CsvDialog({ onClose, onImport, pending }: { onClose: () => void; onImport: (text: string) => void; pending: boolean }) {
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
          Save your spreadsheet as CSV (in Google Sheets: File → Download → CSV). Columns: <strong>Region ID</strong>, Name, Description, Features, Ruin Name, Ruin Description, Dungeon Name, Dungeon Description, Settleable. Regions that already exist (same ID) are updated; new ones get no shape yet: draw them, or use Fill in starting shapes.
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
