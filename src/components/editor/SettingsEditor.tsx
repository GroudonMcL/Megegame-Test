"use client";

import { useState, useTransition } from "react";
import { CREATURE_CATEGORIES, type Ruleset } from "@/engine/ruleset/ruleset";
import type { Problem } from "@/engine/ruleset/validate";
import { Fields, type FieldSpec } from "./fields";

export type SaveWhole = (data: unknown, version: number) => Promise<
  { ok: true; version: number; warnings: Problem[] } | { ok: false; error: string; problems: Problem[] }
>;

const metaFields: FieldSpec[] = [
  { kind: "text", key: "name", label: "Ruleset name" },
  { kind: "textarea", key: "description", label: "Description", rows: 2 },
  {
    kind: "keyValue",
    key: "terminology",
    label: "Terminology",
    help: "rename words everywhere in the app, e.g. region → Province, unit → Warband",
    keyLabel: "Word",
    valueLabel: "Shown as",
  },
  {
    kind: "object",
    key: "theme",
    label: "Theme",
    fields: [
      { kind: "colour", key: "primaryColour", label: "Main colour" },
      { kind: "text", key: "logoUrl", label: "Logo image URL" },
    ],
  },
  { kind: "custom", key: "attributions", label: "Credits (shown in the rules reference)", render: (v: string[]) => <ul className="list-disc pl-5 text-xs text-muted">{(v ?? []).map((a, i) => <li key={i}>{a}</li>)}{!v?.length && <li>None</li>}</ul> },
];

const settingsFields: FieldSpec[] = [
  { kind: "number", key: "actionSlots", label: "Numbered actions per round", min: 1 },
  { kind: "number", key: "conditionalLimit", label: "Conditional actions per round", min: 0 },
  { kind: "number", key: "maxEquippedPerUnit", label: "Equipped items per unit (total)", min: 0 },
  { kind: "checkbox", key: "equipSwapLock", label: "An item unequipped this round can only go back on the unit it came from until next round" },
  { kind: "number", key: "demolishRefund", label: "Demolish refund (0–1)", step: 0.05 },
  {
    kind: "select",
    key: "roundEvents",
    label: "Random events at the end of each round",
    options: [
      { value: "off", label: "only for teams the DM picks" },
      { value: "all", label: "for every team (the DM can untick teams)" },
    ],
  },
  {
    kind: "object",
    key: "movement",
    label: "Movement (D&D overland travel)",
    fields: [
      { kind: "number", key: "milesPerDayAt30ft", label: "Miles per day at 30 ft speed", help: "D&D normal pace = 24", step: 1 },
      { kind: "number", key: "travelDaysPerRound", label: "Travel days per round", step: 0.5 },
      {
        kind: "number",
        key: "defaultConnectionMiles",
        label: "Old maps: connection length (miles)",
        help: "only used when converting a map of dots and connections; distances are now measured on the map (set its scale in the map editor)",
        step: 1,
      },
      { kind: "number", key: "forceMarchMultiplier", label: "Force march multiplier", step: 0.5 },
      { kind: "number", key: "stealthMultiplier", label: "Stealth move multiplier", step: 0.25 },
    ],
  },
  {
    kind: "object",
    key: "combat",
    label: "Combat",
    fields: [
      { kind: "number", key: "maxRounds", label: "Maximum combat rounds", min: 1 },
      { kind: "select", key: "usesReset", label: "“Per day” uses reset each", options: [{ value: "round", label: "game round" }, { value: "combat", label: "combat" }] },
      { kind: "number", key: "retreatBelow", label: "Team units retreat below this share of max HP", help: "0.25 = 25%; 0 = never; monsters fight on", step: 0.05, min: 0 },
      { kind: "number", key: "oddsRuns", label: "Fights simulated for “Show odds”", min: 10 },
      {
        kind: "object",
        key: "footprintFt",
        label: "Width one unit takes up, by creature size (ft, for area effects)",
        fields: (["tiny", "small", "medium", "large", "huge", "gargantuan"] as const).map((k) => ({ kind: "number" as const, key: k, label: k[0].toUpperCase() + k.slice(1), step: 0.5, min: 0.5 })),
      },
    ],
  },
  {
    kind: "object",
    key: "fog",
    label: "Fog of war",
    fields: [
      { kind: "checkbox", key: "showPreviouslySeen", label: "Show regions a team has seen before (dimmed, with what it last saw)" },
      { kind: "checkbox", key: "fogImage", label: "Fog the map image outside what a team can see" },
      {
        kind: "number",
        key: "revealRadius",
        label: "Clear area around a seen region with no shape",
        help: "as a fraction of the map's width, e.g. 0.07; regions with shapes are cleared to their outline",
        step: 0.01,
        min: 0.01,
      },
    ],
  },
  {
    kind: "list",
    key: "crCosts",
    label: "Recruit cost and upkeep by Challenge Rating",
    help: "the first matching row is used; a creature can override it",
    itemLabel: (r) => `${r.category === "any" ? "Any category" : r.category}, CR ≤ ${r.maxCr}`,
    newItem: () => ({ category: "any", maxCr: 1, cost: {}, upkeep: {} }),
    fields: [
      { kind: "select", key: "category", label: "Category", options: [{ value: "any", label: "any" }, ...CREATURE_CATEGORIES.map((c) => ({ value: c, label: c }))] },
      { kind: "number", key: "maxCr", label: "Up to CR", step: 0.125, min: 0 },
      { kind: "resources", key: "cost", label: "Recruit cost" },
      { kind: "resources", key: "upkeep", label: "Upkeep" },
    ],
  },
];

export function SettingsEditor({ ruleset, version: initialVersion, save }: { ruleset: Ruleset; version: number; save: SaveWhole }) {
  const [draft, setDraft] = useState(ruleset);
  const [version, setVersion] = useState(initialVersion);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string; problems: Problem[] } | null>(null);
  const [pending, startTransition] = useTransition();
  const ctx = { ruleset: draft };

  const onSave = () =>
    startTransition(async () => {
      const r = await save(draft, version);
      if (r.ok) {
        setVersion(r.version);
        setDirty(false);
        setMessage({ ok: true, text: "Saved.", problems: [] });
      } else setMessage({ ok: false, text: r.error, problems: r.problems });
    });

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Game settings</h2>
          <p className="text-sm text-muted">Name, terminology, action slots, movement, combat, fog of war and unit costs.</p>
        </div>
        <button type="button" onClick={onSave} disabled={!dirty || pending} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50">
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {message && (
        <div className={`rounded-lg border p-3 text-sm ${message.ok ? "border-ok/40 text-ok" : "border-danger/50 text-danger"}`} role="status">
          {message.text}
          {message.problems.map((p, i) => (
            <p key={i} className="text-xs">
              {p.path}: {p.message}
            </p>
          ))}
        </div>
      )}
      <section className="glass rounded-xl border border-border shadow-panel p-4">
        <Fields fields={metaFields} value={draft.meta} onChange={(v) => (setDraft({ ...draft, meta: v as Ruleset["meta"] }), setDirty(true))} ctx={ctx} />
      </section>
      <section className="glass rounded-xl border border-border shadow-panel p-4">
        <Fields fields={settingsFields} value={draft.settings} onChange={(v) => (setDraft({ ...draft, settings: v as Ruleset["settings"] }), setDirty(true))} ctx={ctx} />
      </section>
    </div>
  );
}
