"use client";

import { useEffect, useState, useTransition } from "react";
import { CONDITIONS, DAMAGE_TYPES, formatCr, SIZES, ABILITIES } from "@/engine/ruleset/common";
import { creatureCosts } from "@/engine/ruleset/derive";
import { describeEffect, fmtRes } from "@/engine/ruleset/effects";
import { CREATURE_CATEGORIES, type Creature, type Ruleset } from "@/engine/ruleset/ruleset";
import { REVIEW_STATES, SKILLS, type StatBlock } from "@/engine/ruleset/statblock";
import type { SrdSummary } from "@/engine/srd/library";
import { StatBlockView } from "../StatBlockView";
import { Fields, type FieldContext, type FieldSpec } from "./fields";
import { abilityBonusesField } from "./sections";
import { SectionEditor, type SaveSection } from "./SectionEditor";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type SrdSearch = (q: { text: string; type: string; maxCr: number | null }) => Promise<SrdSummary[]>;
export type SrdFetch = (index: string) => Promise<{ index: string; statBlock: StatBlock } | null>;

const opt = (values: readonly string[]) => values.map((v) => ({ value: v, label: v }));

const megagameFields: FieldSpec[] = [
  { kind: "text", key: "id", label: "ID", help: "used by other rules; renaming breaks references" },
  { kind: "select", key: "category", label: "Category", options: opt(CREATURE_CATEGORIES) },
  { kind: "checkbox", key: "recruitable", label: "Teams can recruit this" },
  { kind: "number", key: "visionRange", label: "Vision (regions away)", min: 0 },
  { kind: "tags", key: "tags", label: "Tags", placeholder: "e.g. Miner, Stealthy, Regiment" },
  { kind: "textarea", key: "description", label: "Description", rows: 2 },
  { kind: "resources", key: "costOverride", label: "Recruit cost (default comes from the CR table)", nullable: true },
  { kind: "resources", key: "upkeepOverride", label: "Upkeep (default comes from the CR table)", nullable: true },
  { kind: "multiselect", key: "unlocksActions", label: "Unlocks actions", options: { ref: "actionTypes" } },
  {
    kind: "list",
    key: "harvest",
    label: "Harvestable when dead",
    newItem: () => ({ itemId: "", qty: 1 }),
    fields: [
      { kind: "select", key: "itemId", label: "Item", options: { ref: "items" } },
      { kind: "number", key: "qty", label: "Quantity", min: 1 },
    ],
  },
  { kind: "effects", key: "effects", label: "Megagame abilities (on top of the stat block)" },
];

const usesField: FieldSpec = {
  kind: "custom",
  key: "uses",
  label: "Uses",
  render: (v: any, onChange) => (
    <div className="flex gap-2">
      <select
        className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
        value={v?.type ?? "atWill"}
        aria-label="Uses"
        onChange={(e) => {
          const type = e.target.value;
          onChange(type === "atWill" ? { type } : type === "recharge" ? { type, min: 5 } : { type, times: 1 });
        }}
      >
        <option value="atWill">At will</option>
        <option value="perDay">Per day (resets each round)</option>
        <option value="perCombat">Per combat</option>
        <option value="recharge">Recharge</option>
      </select>
      {(v?.type === "perDay" || v?.type === "perCombat") && (
        <input type="number" min={1} className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={v.times} onChange={(e) => onChange({ ...v, times: Number(e.target.value) })} aria-label="Times" />
      )}
      {v?.type === "recharge" && (
        <input type="number" min={2} max={6} className="w-20 rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={v.min} onChange={(e) => onChange({ ...v, min: Number(e.target.value) })} aria-label="Recharges on" />
      )}
    </div>
  ),
};

const actionList = (key: string, label: string): FieldSpec => ({
  kind: "list",
  key,
  label,
  itemLabel: (a) => `${a.name}${a.review === "auto" ? "" : a.review === "needsReview" ? " — check" : " — text only"}`,
  newItem: () => ({ name: "New", text: "", uses: { type: "atWill" }, profile: { kind: "text" }, review: "text" }),
  fields: [
    { kind: "text", key: "name", label: "Name" },
    usesField,
    { kind: "textarea", key: "text", label: "Text (what players read)", rows: 3 },
    {
      kind: "select",
      key: "review",
      label: "Automation",
      options: [
        { value: "auto", label: "Automated" },
        { value: "needsReview", label: "Automated, but check it" },
        { value: "text", label: "Text only (DM handles it)" },
      ].filter((o) => (REVIEW_STATES as readonly string[]).includes(o.value)),
    },
    { kind: "json", key: "profile", label: "Combat profile (advanced)", rows: 8 },
  ],
});

const statBlockFields: FieldSpec[] = [
  { kind: "text", key: "name", label: "Name" },
  { kind: "select", key: "size", label: "Size", options: opt(SIZES) },
  { kind: "text", key: "creatureType", label: "Creature type", placeholder: "humanoid" },
  { kind: "text", key: "alignment", label: "Alignment" },
  { kind: "number", key: "ac", label: "AC", min: 0 },
  { kind: "text", key: "acNote", label: "AC note", placeholder: "chain mail" },
  { kind: "number", key: "hp", label: "Hit points", min: 1 },
  { kind: "text", key: "hitDice", label: "Hit dice", placeholder: "10d8 + 20" },
  { kind: "number", key: "cr", label: "Challenge rating", step: 0.125, min: 0 },
  { kind: "number", key: "proficiencyBonus", label: "Proficiency bonus (empty = from CR)", nullable: true },
  {
    kind: "object",
    key: "speed",
    label: "Speed (ft)",
    fields: [
      { kind: "number", key: "walk", label: "Walk", min: 0 },
      { kind: "number", key: "fly", label: "Fly", min: 0 },
      { kind: "number", key: "swim", label: "Swim", min: 0 },
      { kind: "number", key: "climb", label: "Climb", min: 0 },
      { kind: "number", key: "burrow", label: "Burrow", min: 0 },
      { kind: "checkbox", key: "hover", label: "Hover" },
    ],
  },
  abilityBonusesField("abilities", "Ability scores"),
  { kind: "multiselect", key: "saveProficiencies", label: "Proficient saving throws", options: opt(ABILITIES) },
  {
    kind: "custom",
    key: "skills",
    label: "Skills (click to cycle: none → proficient → expertise)",
    render: (v: Record<string, number> = {}, onChange) => (
      <div className="flex flex-wrap gap-1.5">
        {SKILLS.map((sk) => {
          const n = v[sk] ?? 0;
          return (
            <button
              type="button"
              key={sk}
              onClick={() => {
                const next = { ...v };
                if (n >= 2) delete next[sk];
                else next[sk] = n + 1;
                onChange(next);
              }}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${n ? "border-accent bg-accent text-accent-foreground" : "border-border"}`}
            >
              {sk}
              {n === 2 ? " ×2" : ""}
            </button>
          );
        })}
      </div>
    ),
  },
  { kind: "multiselect", key: "resistances", label: "Damage resistances", options: opt(DAMAGE_TYPES) },
  { kind: "multiselect", key: "immunities", label: "Damage immunities", options: opt(DAMAGE_TYPES) },
  { kind: "multiselect", key: "vulnerabilities", label: "Damage vulnerabilities", options: opt(DAMAGE_TYPES) },
  { kind: "multiselect", key: "conditionImmunities", label: "Condition immunities", options: opt(CONDITIONS) },
  { kind: "text", key: "damageNote", label: "Damage note", wide: true },
  {
    kind: "object",
    key: "senses",
    label: "Senses (ft)",
    fields: [
      { kind: "number", key: "darkvision", label: "Darkvision", min: 0 },
      { kind: "number", key: "blindsight", label: "Blindsight", min: 0 },
      { kind: "number", key: "tremorsense", label: "Tremorsense", min: 0 },
      { kind: "number", key: "truesight", label: "Truesight", min: 0 },
    ],
  },
  { kind: "text", key: "languages", label: "Languages", wide: true },
  actionList("traits", "Traits"),
  actionList("actions", "Actions"),
  actionList("bonusActions", "Bonus actions"),
  actionList("reactions", "Reactions"),
];

function CreatureDetail({ item, onChange, ctx }: { item: Creature; onChange: (v: Creature) => void; ctx: FieldContext }) {
  const [tab, setTab] = useState<"view" | "megagame" | "statblock">("view");
  const costs = creatureCosts(item, ctx.ruleset);
  const tabButton = (id: typeof tab, label: string) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`rounded-md px-3 py-1.5 text-sm ${tab === id ? "bg-accent text-accent-foreground" : "border border-border"}`}
    >
      {label}
    </button>
  );
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {tabButton("view", "Stat block")}
        {tabButton("megagame", "Megagame settings")}
        {tabButton("statblock", "Edit stat block")}
      </div>
      <p className="mb-3 text-sm text-muted">
        {item.category}
        {item.recruitable ? ", recruitable" : ""} · costs {fmtRes(costs.cost, ctx.ruleset.resources)} · upkeep {fmtRes(costs.upkeep, ctx.ruleset.resources)}
        {item.source.kind === "srd-2024" ? " · from the SRD 5.2" : " · custom"}
      </p>
      {tab === "view" && (
        <div className="space-y-3">
          <StatBlockView sb={item.statBlock} />
          {item.effects.length > 0 && (
            <div className="rounded-lg border border-border p-3 text-sm">
              <p className="font-medium">Megagame abilities</p>
              <ul className="list-disc pl-5">
                {item.effects.map((e, i) => (
                  <li key={i}>{describeEffect(e)}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {tab === "megagame" && <Fields fields={megagameFields} value={item} onChange={(v) => onChange(v as Creature)} ctx={ctx} />}
      {tab === "statblock" && (
        <Fields fields={statBlockFields} value={item.statBlock} onChange={(v) => onChange({ ...item, statBlock: v as StatBlock, source: { ...item.source } })} ctx={ctx} />
      )}
    </div>
  );
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "creature";
}

function SrdBrowser({ search, fetchMonster, onAdd, onClose }: { search: SrdSearch; fetchMonster: SrdFetch; onAdd: (c: Creature) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const [type, setType] = useState("");
  const [maxCr, setMaxCr] = useState<number | null>(null);
  const [results, setResults] = useState<SrdSummary[]>([]);
  const [preview, setPreview] = useState<{ index: string; statBlock: StatBlock } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const t = setTimeout(() => startTransition(async () => setResults(await search({ text, type, maxCr }))), 200);
    return () => clearTimeout(t);
  }, [text, type, maxCr, search]);

  const add = (category: Creature["category"], recruitable: boolean) => {
    if (!preview) return;
    onAdd({
      id: slug(preview.statBlock.name),
      source: { kind: "srd-2024", ref: preview.index },
      category,
      recruitable,
      tags: [preview.statBlock.creatureType.replace(/^\w/, (c) => c.toUpperCase())],
      description: "",
      statBlock: preview.statBlock,
      costOverride: null,
      upkeepOverride: null,
      visionRange: 0,
      unlocksActions: [],
      effects: [],
      harvest: [],
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-overlay p-4" role="dialog" aria-modal="true" aria-label="Add from the SRD">
      <div className="w-full max-w-5xl glass rounded-xl border border-border p-4 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Add a creature from the SRD 5.2</h3>
          <button type="button" className="rounded-md border border-border px-3 py-1 text-sm" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <input className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm" placeholder="Search by name…" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search" autoFocus />
          <select className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={type} onChange={(e) => setType(e.target.value)} aria-label="Creature type">
            <option value="">Any type</option>
            {["aberration", "beast", "celestial", "construct", "dragon", "elemental", "fey", "fiend", "giant", "humanoid", "monstrosity", "ooze", "plant", "undead"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <select className="rounded-md border border-border bg-background px-2 py-1.5 text-sm" value={maxCr ?? ""} onChange={(e) => setMaxCr(e.target.value === "" ? null : Number(e.target.value))} aria-label="Maximum CR">
            <option value="">Any CR</option>
            {[0.25, 0.5, 1, 2, 3, 5, 8, 12, 17].map((c) => (
              <option key={c} value={c}>
                CR ≤ {formatCr(c)}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-[18rem_1fr]">
          <ul className="max-h-[60vh] overflow-y-auto rounded-lg border border-border text-sm" aria-busy={pending}>
            {results.map((r) => (
              <li key={r.index}>
                <button
                  type="button"
                  onClick={() => startTransition(async () => setPreview(await fetchMonster(r.index)))}
                  className={`flex w-full justify-between gap-2 px-3 py-1.5 text-left hover:bg-background ${preview?.index === r.index ? "bg-background font-medium" : ""}`}
                >
                  <span className="truncate">{r.name}</span>
                  <span className="shrink-0 text-xs text-muted">CR {r.crLabel}</span>
                </button>
              </li>
            ))}
            {!results.length && <li className="px-3 py-2 text-muted">{pending ? "Searching…" : "No matches."}</li>}
          </ul>
          <div className="min-w-0">
            {preview ? (
              <>
                <div className="mb-2 flex flex-wrap gap-2">
                  <button type="button" className="rounded-lg bg-accent px-3 py-1.5 text-sm text-accent-foreground" onClick={() => add("monster", false)}>
                    Add as monster
                  </button>
                  <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-sm" onClick={() => add("standard", true)}>
                    Add as recruitable unit
                  </button>
                  <button type="button" className="rounded-lg border border-border px-3 py-1.5 text-sm" onClick={() => add("hero", true)}>
                    Add as hero
                  </button>
                </div>
                <StatBlockView sb={preview.statBlock} />
              </>
            ) : (
              <p className="text-sm text-muted">Pick a creature to preview its stat block.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CreaturesEditor({ ruleset, version, save, search, fetchMonster }: { ruleset: Ruleset; version: number; save: SaveSection; search: SrdSearch; fetchMonster: SrdFetch }) {
  const [browsing, setBrowsing] = useState(false);
  return (
    <SectionEditor
      section="creatures"
      title="Units & monsters"
      intro="Every creature uses a full D&D 5e stat block. Recruitable ones are your units; the rest form the monster library."
      ruleset={ruleset}
      version={version}
      save={save}
      label={(c: Creature) => `${c.statBlock.name} · CR ${formatCr(c.statBlock.cr)}${c.recruitable ? "" : " · monster"}`}
      newItem={(id) => ({
        id,
        source: { kind: "custom", ref: "" },
        category: "standard",
        recruitable: true,
        tags: [],
        description: "",
        statBlock: {
          name: "New creature",
          size: "medium",
          creatureType: "humanoid",
          subtypes: [],
          alignment: "",
          ac: 10,
          acNote: "",
          hp: 10,
          hitDice: "",
          speed: { walk: 30, fly: 0, swim: 0, climb: 0, burrow: 0, hover: false },
          abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
          saveProficiencies: [],
          skills: {},
          vulnerabilities: [],
          resistances: [],
          immunities: [],
          damageNote: "",
          conditionImmunities: [],
          senses: { darkvision: 0, blindsight: 0, tremorsense: 0, truesight: 0 },
          languages: "",
          cr: 0,
          proficiencyBonus: null,
          traits: [],
          actions: [],
          bonusActions: [],
          reactions: [],
          legendary: null,
        },
        costOverride: null,
        upkeepOverride: null,
        visionRange: 0,
        unlocksActions: [],
        effects: [],
        harvest: [],
      })}
      renderDetail={(item, onChange, ctx) => <CreatureDetail item={item as Creature} onChange={(v) => onChange(v as any)} ctx={ctx} />}
      extraToolbar={(add) => (
        <>
          <button type="button" className="rounded-md border border-accent px-2 py-1 text-xs text-link" onClick={() => setBrowsing(true)}>
            + From SRD…
          </button>
          {browsing && (
            <SrdBrowser
              search={search}
              fetchMonster={fetchMonster}
              onAdd={(c) => {
                add(c as any);
                setBrowsing(false);
              }}
              onClose={() => setBrowsing(false)}
            />
          )}
        </>
      )}
    />
  );
}
