"use client";

import { useId, useState, type ReactNode } from "react";
import type { Ruleset } from "@/engine/ruleset/ruleset";
import type { Effect } from "@/engine/ruleset/effects";
import { describeEffect, Effect as EffectSchema } from "@/engine/ruleset/effects";

// A small declarative form system. Each content type describes its fields as
// data (FieldSpec), and <Fields> renders and edits a plain JSON object with them.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Obj = Record<string, any>;

export type RefSection =
  | "resources"
  | "terrainTypes"
  | "settlementTiers"
  | "buildings"
  | "races"
  | "creatures"
  | "archetypes"
  | "spells"
  | "itemCategories"
  | "equipSlots"
  | "items"
  | "recipes"
  | "actionTypes"
  | "rollTables";

export interface Option {
  value: string;
  label: string;
}
type Options = Option[] | { ref: RefSection };

interface Base {
  key: string;
  label: string;
  help?: string;
  /** Takes the full row instead of sharing it. */
  wide?: boolean;
}

export type FieldSpec =
  | (Base & { kind: "text"; placeholder?: string })
  | (Base & { kind: "textarea"; rows?: number })
  | (Base & { kind: "number"; step?: number; nullable?: boolean; min?: number })
  | (Base & { kind: "checkbox" })
  | (Base & { kind: "select"; options: Options; nullable?: boolean; nullLabel?: string })
  | (Base & { kind: "multiselect"; options: Options })
  | (Base & { kind: "tags"; placeholder?: string })
  | (Base & { kind: "resources"; nullable?: boolean })
  | (Base & { kind: "colour" })
  | (Base & { kind: "object"; fields: FieldSpec[] })
  | (Base & { kind: "list"; fields: FieldSpec[]; newItem: () => Obj; itemLabel?: (item: Obj, i: number) => string })
  | (Base & { kind: "unionList"; discriminator: string; variants: Record<string, Variant>; describe?: (item: Obj) => string })
  | (Base & { kind: "effects" })
  | (Base & { kind: "keyValue"; keyLabel: string; valueLabel: string })
  | (Base & { kind: "json"; rows?: number })
  | (Base & { kind: "custom"; render: (value: any, onChange: (v: any) => void, ctx: FieldContext) => ReactNode });

export interface Variant {
  label: string;
  fields: FieldSpec[];
  template: () => Obj;
}

export interface FieldContext {
  ruleset: Ruleset;
}

export function optionsFor(o: Options, ctx: FieldContext): Option[] {
  if (Array.isArray(o)) return o;
  const list = ctx.ruleset[o.ref] as { id: string; name?: string; statBlock?: { name: string } }[];
  return list.map((x) => ({ value: x.id, label: x.name ?? x.statBlock?.name ?? x.id }));
}

const input =
  "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-60";
const smallButton = "rounded-md border border-border px-2 py-1 text-xs hover:bg-background";

function FieldLabel({ spec, htmlFor }: { spec: Base; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-muted">
      {spec.label}
      {spec.help && <span className="ml-1 font-normal opacity-80">— {spec.help}</span>}
    </label>
  );
}

export function Fields({ fields, value, onChange, ctx }: { fields: FieldSpec[]; value: Obj; onChange: (v: Obj) => void; ctx: FieldContext }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {fields.map((f) => (
        <div key={f.key} className={isWide(f) ? "sm:col-span-2" : ""}>
          <Field spec={f} value={value?.[f.key]} onChange={(v) => onChange({ ...value, [f.key]: v })} ctx={ctx} />
        </div>
      ))}
    </div>
  );
}

function isWide(f: FieldSpec) {
  return f.wide || ["textarea", "object", "list", "unionList", "effects", "keyValue", "json", "resources", "multiselect", "custom"].includes(f.kind);
}

export function Field({ spec, value, onChange, ctx }: { spec: FieldSpec; value: any; onChange: (v: any) => void; ctx: FieldContext }) {
  const id = useId();
  switch (spec.kind) {
    case "text":
      return (
        <div>
          <FieldLabel spec={spec} htmlFor={id} />
          <input id={id} className={input} value={value ?? ""} placeholder={spec.placeholder} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
    case "textarea":
      return (
        <div>
          <FieldLabel spec={spec} htmlFor={id} />
          <textarea id={id} className={input} rows={spec.rows ?? 3} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
    case "number":
      return (
        <div>
          <FieldLabel spec={spec} htmlFor={id} />
          <input
            id={id}
            type="number"
            className={input}
            step={spec.step ?? 1}
            min={spec.min}
            value={value ?? ""}
            placeholder={spec.nullable ? "none" : ""}
            onChange={(e) => onChange(e.target.value === "" ? (spec.nullable ? null : 0) : Number(e.target.value))}
          />
        </div>
      );
    case "checkbox":
      return (
        <label className="flex items-center gap-2 pt-5 text-sm">
          <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />
          {spec.label}
          {spec.help && <span className="text-xs text-muted">— {spec.help}</span>}
        </label>
      );
    case "colour":
      return (
        <div>
          <FieldLabel spec={spec} htmlFor={id} />
          <div className="flex gap-2">
            <input id={id} type="color" className="h-9 w-12 rounded-md border border-border" value={value || "#888888"} onChange={(e) => onChange(e.target.value)} />
            <input className={input} value={value ?? ""} onChange={(e) => onChange(e.target.value)} />
          </div>
        </div>
      );
    case "select": {
      const opts = optionsFor(spec.options, ctx);
      const known = value == null || opts.some((o) => o.value === value);
      return (
        <div>
          <FieldLabel spec={spec} htmlFor={id} />
          <select
            id={id}
            className={input}
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value === "" && spec.nullable ? null : e.target.value)}
          >
            {(spec.nullable || value == null) && <option value="">{spec.nullLabel ?? "— none —"}</option>}
            {!known && <option value={value}>{value} (missing!)</option>}
            {opts.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      );
    }
    case "multiselect": {
      const opts = optionsFor(spec.options, ctx);
      const selected: string[] = value ?? [];
      return (
        <div>
          <FieldLabel spec={spec} />
          <div className="flex flex-wrap gap-1.5">
            {opts.map((o) => {
              const on = selected.includes(o.value);
              return (
                <button
                  type="button"
                  key={o.value}
                  onClick={() => onChange(on ? selected.filter((s) => s !== o.value) : [...selected, o.value])}
                  className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? "border-accent bg-accent text-accent-foreground" : "border-border"}`}
                >
                  {o.label}
                </button>
              );
            })}
            {selected
              .filter((s) => !opts.some((o) => o.value === s))
              .map((s) => (
                <button type="button" key={s} onClick={() => onChange(selected.filter((x) => x !== s))} className="rounded-full border border-danger px-2.5 py-0.5 text-xs text-danger">
                  {s} (missing) ×
                </button>
              ))}
          </div>
        </div>
      );
    }
    case "tags":
      return <TagsField spec={spec} id={id} value={value ?? []} onChange={onChange} />;
    case "resources":
      return <ResourcesField spec={spec} value={value} onChange={onChange} ctx={ctx} />;
    case "object":
      return (
        <fieldset className="rounded-lg border border-border p-3">
          <legend className="px-1 text-xs font-medium text-muted">{spec.label}</legend>
          <Fields fields={spec.fields} value={value ?? {}} onChange={onChange} ctx={ctx} />
        </fieldset>
      );
    case "list":
      return <ListField spec={spec} value={value ?? []} onChange={onChange} ctx={ctx} />;
    case "unionList":
      return <UnionListField spec={spec} value={value ?? []} onChange={onChange} ctx={ctx} />;
    case "effects":
      return <UnionListField spec={{ ...effectsSpec, key: spec.key, label: spec.label, help: spec.help }} value={value ?? []} onChange={onChange} ctx={ctx} />;
    case "keyValue":
      return <KeyValueField spec={spec} value={value ?? {}} onChange={onChange} />;
    case "json":
      return <JsonField spec={spec} value={value} onChange={onChange} />;
    case "custom":
      return (
        <div>
          <FieldLabel spec={spec} />
          {spec.render(value, onChange, ctx)}
        </div>
      );
  }
}

function TagsField({ spec, id, value, onChange }: { spec: Base & { placeholder?: string }; id: string; value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join(", "));
  return (
    <div>
      <FieldLabel spec={spec} htmlFor={id} />
      <input
        id={id}
        className={input}
        value={text}
        placeholder={spec.placeholder ?? "Comma-separated"}
        onChange={(e) => {
          setText(e.target.value);
          onChange(
            e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          );
        }}
      />
    </div>
  );
}

function ResourcesField({ spec, value, onChange, ctx }: { spec: Base & { nullable?: boolean }; value: Record<string, number> | null; onChange: (v: any) => void; ctx: FieldContext }) {
  const resources = ctx.ruleset.resources;
  if (spec.nullable && value == null) {
    return (
      <div>
        <FieldLabel spec={spec} />
        <button type="button" className={smallButton} onClick={() => onChange({})}>
          Set a custom amount
        </button>
      </div>
    );
  }
  const v = value ?? {};
  const unknown = Object.keys(v).filter((k) => !resources.some((r) => r.id === k));
  return (
    <div>
      <FieldLabel spec={spec} />
      <div className="flex flex-wrap items-end gap-2">
        {resources.map((r) => (
          <label key={r.id} className="flex w-24 flex-col text-xs">
            <span className="mb-0.5 text-muted">
              {r.icon} {r.name}
            </span>
            <input
              type="number"
              className={input}
              value={v[r.id] ?? ""}
              placeholder="0"
              onChange={(e) => {
                const next = { ...v };
                if (e.target.value === "" || Number(e.target.value) === 0) delete next[r.id];
                else next[r.id] = Number(e.target.value);
                onChange(next);
              }}
            />
          </label>
        ))}
        {unknown.map((k) => (
          <span key={k} className="text-xs text-danger">
            {k}: {v[k]} (unknown resource)
          </span>
        ))}
        {spec.nullable && (
          <button type="button" className={smallButton} onClick={() => onChange(null)}>
            Use default
          </button>
        )}
        {resources.length === 0 && <span className="text-xs text-muted">Add resources first.</span>}
      </div>
    </div>
  );
}

function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

function RowButtons({ i, n, onMove, onRemove }: { i: number; n: number; onMove: (to: number) => void; onRemove: () => void }) {
  return (
    <div className="flex gap-1">
      <button type="button" className={smallButton} disabled={i === 0} onClick={() => onMove(i - 1)} aria-label="Move up">
        ↑
      </button>
      <button type="button" className={smallButton} disabled={i === n - 1} onClick={() => onMove(i + 1)} aria-label="Move down">
        ↓
      </button>
      <button type="button" className={`${smallButton} text-danger`} onClick={onRemove} aria-label="Remove">
        ✕
      </button>
    </div>
  );
}

function ListField({ spec, value, onChange, ctx }: { spec: Extract<FieldSpec, { kind: "list" }>; value: Obj[]; onChange: (v: Obj[]) => void; ctx: FieldContext }) {
  return (
    <fieldset className="rounded-lg border border-border p-3">
      <legend className="px-1 text-xs font-medium text-muted">
        {spec.label}
        {spec.help && <span className="ml-1 font-normal">— {spec.help}</span>}
      </legend>
      <div className="space-y-3">
        {value.map((item, i) => (
          <div key={i} className="rounded-md bg-background p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-medium">{spec.itemLabel ? spec.itemLabel(item, i) : `#${i + 1}`}</span>
              <RowButtons
                i={i}
                n={value.length}
                onMove={(to) => onChange(moveItem(value, i, to))}
                onRemove={() => onChange(value.filter((_, j) => j !== i))}
              />
            </div>
            <Fields fields={spec.fields} value={item} onChange={(v) => onChange(value.map((x, j) => (j === i ? v : x)))} ctx={ctx} />
          </div>
        ))}
        <button type="button" className={smallButton} onClick={() => onChange([...value, spec.newItem()])}>
          + Add
        </button>
      </div>
    </fieldset>
  );
}

function UnionListField({ spec, value, onChange, ctx }: { spec: Extract<FieldSpec, { kind: "unionList" }>; value: Obj[]; onChange: (v: Obj[]) => void; ctx: FieldContext }) {
  const [adding, setAdding] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const keys = Object.keys(spec.variants);
  return (
    <fieldset className="rounded-lg border border-border p-3">
      <legend className="px-1 text-xs font-medium text-muted">
        {spec.label}
        {spec.help && <span className="ml-1 font-normal">— {spec.help}</span>}
      </legend>
      <div className="space-y-2">
        {value.length === 0 && <p className="text-xs text-muted">None.</p>}
        {value.map((item, i) => {
          const variant = spec.variants[item[spec.discriminator]];
          return (
            <div key={i} className="rounded-md bg-background p-2">
              <div className="flex items-start justify-between gap-2">
                <button type="button" className="flex-1 text-left text-sm" onClick={() => setOpen(open === i ? null : i)}>
                  <span className="mr-1 text-xs text-muted">{open === i ? "▾" : "▸"}</span>
                  {spec.describe ? spec.describe(item) : (variant?.label ?? item[spec.discriminator])}
                </button>
                <RowButtons
                  i={i}
                  n={value.length}
                  onMove={(to) => onChange(moveItem(value, i, to))}
                  onRemove={() => onChange(value.filter((_, j) => j !== i))}
                />
              </div>
              {open === i && variant && (
                <div className="mt-2 border-t border-border pt-2">
                  <p className="mb-2 text-xs text-muted">{variant.label}</p>
                  <Fields fields={variant.fields} value={item} onChange={(v) => onChange(value.map((x, j) => (j === i ? v : x)))} ctx={ctx} />
                </div>
              )}
            </div>
          );
        })}
        <div className="flex gap-2">
          <select className={`${input} max-w-xs`} value={adding} onChange={(e) => setAdding(e.target.value)} aria-label={`Add to ${spec.label}`}>
            <option value="">Add…</option>
            {keys.map((k) => (
              <option key={k} value={k}>
                {spec.variants[k].label}
              </option>
            ))}
          </select>
          <button
            type="button"
            className={smallButton}
            disabled={!adding}
            onClick={() => {
              onChange([...value, spec.variants[adding].template()]);
              setOpen(value.length);
              setAdding("");
            }}
          >
            Add
          </button>
        </div>
      </div>
    </fieldset>
  );
}

function KeyValueField({ spec, value, onChange }: { spec: Extract<FieldSpec, { kind: "keyValue" }>; value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const entries = Object.entries(value);
  return (
    <fieldset className="rounded-lg border border-border p-3">
      <legend className="px-1 text-xs font-medium text-muted">
        {spec.label}
        {spec.help && <span className="ml-1 font-normal">— {spec.help}</span>}
      </legend>
      <div className="space-y-2">
        {entries.map(([k, v], i) => (
          <div key={i} className="flex gap-2">
            <input
              className={input}
              aria-label={spec.keyLabel}
              value={k}
              onChange={(e) => onChange(Object.fromEntries(entries.map(([kk, vv], j) => (j === i ? [e.target.value, vv] : [kk, vv]))))}
            />
            <span className="self-center text-muted">→</span>
            <input
              className={input}
              aria-label={spec.valueLabel}
              value={v}
              onChange={(e) => onChange({ ...value, [k]: e.target.value })}
            />
            <button type="button" className={`${smallButton} text-danger`} onClick={() => onChange(Object.fromEntries(entries.filter((_, j) => j !== i)))}>
              ✕
            </button>
          </div>
        ))}
        <button type="button" className={smallButton} onClick={() => onChange({ ...value, "": "" })}>
          + Add
        </button>
      </div>
    </fieldset>
  );
}

function sameJson(text: string, value: unknown) {
  try {
    return JSON.stringify(JSON.parse(text)) === JSON.stringify(value ?? null);
  } catch {
    return false;
  }
}

function JsonField({ spec, value, onChange }: { spec: Extract<FieldSpec, { kind: "json" }>; value: any; onChange: (v: any) => void }) {
  const [text, setText] = useState(() => JSON.stringify(value ?? null, null, 2));
  const [error, setError] = useState("");
  // Another field changed the value (e.g. the range boxes): show it, unless it's what's typed here.
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (!sameJson(text, value)) {
      setText(JSON.stringify(value ?? null, null, 2));
      setError("");
    }
  }
  return (
    <div>
      <FieldLabel spec={spec} />
      <textarea
        className={`${input} font-mono text-xs`}
        rows={spec.rows ?? 6}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            setError("");
          } catch {
            setError("Not valid JSON yet.");
          }
        }}
      />
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

// ——— Ranges ———

/**
 * Normal and long range (ft) of an action's combat profile, for ranged and
 * melee-or-ranged attacks, save effects and effects aimed at enemies. Its key
 * is "profile": it edits profile.range.
 */
export const rangeField: FieldSpec = {
  kind: "custom",
  key: "profile",
  label: "Range (ft)",
  help: "beyond normal range: disadvantage (saves: the target has advantage); beyond long range: can't be used; empty = only in melee",
  render: (p: Obj | undefined, onChange) => {
    const ranged = p && ((p.kind === "attack" && p.attackType !== "melee") || p.kind === "save" || (p.kind === "buff" && p.target === "enemy"));
    if (!ranged) return <p className="text-xs text-muted">Only ranged attacks, save effects and effects on enemies have a range (set the profile below).</p>;
    const range = (p.range ?? {}) as { normal?: number; long?: number };
    const set = (key: "normal" | "long", raw: string) => {
      const n = Math.round(Number(raw));
      const next = { ...range, [key]: raw === "" || !(n > 0) ? undefined : n };
      if (key === "normal" && next.normal === undefined) next.long = undefined;
      const rest = { ...p };
      delete rest.range;
      onChange(next.normal ? { ...rest, range: next.long ? { normal: next.normal, long: next.long } : { normal: next.normal } } : rest);
    };
    return (
      <div className="flex items-center gap-2 text-sm">
        <input type="number" min={5} step={5} className="w-24 rounded-md border border-border bg-background px-2 py-1.5" placeholder="normal" aria-label="Normal range (ft)" value={range.normal ?? ""} onChange={(e) => set("normal", e.target.value)} />
        <span className="text-muted">/</span>
        <input type="number" min={5} step={5} className="w-24 rounded-md border border-border bg-background px-2 py-1.5" placeholder="long" aria-label="Long range (ft)" value={range.long ?? ""} disabled={!range.normal} onChange={(e) => set("long", e.target.value)} />
      </div>
    );
  },
};

// ——— Effects ———

const conditionVariants: Record<string, Variant> = {
  inOwnFortifiedRegion: { label: "In a fortified region you control", fields: [], template: () => ({ when: "inOwnFortifiedRegion" }) },
  inOwnedRegion: { label: "In a region you own", fields: [], template: () => ({ when: "inOwnedRegion" }) },
  firstRound: { label: "First round of combat", fields: [], template: () => ({ when: "firstRound" }) },
  surprising: { label: "When surprising the enemy", fields: [], template: () => ({ when: "surprising" }) },
  alliesOutnumber: { label: "When allies outnumber enemies", fields: [], template: () => ({ when: "alliesOutnumber" }) },
  outnumbered: { label: "When outnumbered", fields: [], template: () => ({ when: "outnumbered" }) },
  forceMarching: { label: "While force-marching", fields: [], template: () => ({ when: "forceMarching" }) },
  vsCreatureType: {
    label: "Against a creature type",
    fields: [{ kind: "text", key: "creatureType", label: "Creature type", placeholder: "undead" }],
    template: () => ({ when: "vsCreatureType", creatureType: "undead" }),
  },
  alliedWithTag: {
    label: "Alongside a unit with a tag",
    fields: [{ kind: "text", key: "tag", label: "Tag", placeholder: "Beast" }],
    template: () => ({ when: "alliedWithTag", tag: "Beast" }),
  },
  vsSpells: { label: "Against spells", fields: [], template: () => ({ when: "vsSpells" }) },
};

const whenField: FieldSpec = {
  kind: "unionList",
  key: "when",
  label: "Only when (all must hold; none = always)",
  discriminator: "when",
  variants: conditionVariants,
  describe: (c) => conditionVariants[c.when]?.label ?? c.when,
};

const per: FieldSpec = { kind: "select", key: "per", label: "Per", options: [{ value: "round", label: "round" }, { value: "combat", label: "combat" }] };

export const effectVariants: Record<Effect["type"], Variant> = {
  modifier: {
    label: "Stat modifier",
    fields: [
      { kind: "text", key: "target", label: "Stat", help: "ac, toHit, damage, damageDice, attacks, saveDc, speed, perception, stealth, initiative, hp, ability:str, save:dex, save:all, check:<action id>" },
      { kind: "number", key: "value", label: "Amount" },
      { kind: "text", key: "dice", label: "Extra dice (optional)", placeholder: "1d6" },
      {
        kind: "custom",
        key: "tagMultiplier",
        label: "Multiplier for a tag (optional)",
        render: (v, onChange) => (
          <div className="flex gap-2">
            <input className={input} placeholder="Tag, e.g. Defender" value={v?.tag ?? ""} onChange={(e) => onChange(e.target.value ? { tag: e.target.value, factor: v?.factor ?? 2 } : undefined)} />
            <input className={`${input} w-20`} type="number" value={v?.factor ?? ""} placeholder="×2" onChange={(e) => onChange(v ? { ...v, factor: Number(e.target.value) } : undefined)} />
          </div>
        ),
      },
      whenField,
    ],
    template: () => ({ type: "modifier", target: "ac", value: 1, when: [] }),
  },
  advantage: {
    label: "Advantage / disadvantage",
    fields: [
      { kind: "select", key: "mode", label: "Mode", options: [{ value: "advantage", label: "Advantage" }, { value: "disadvantage", label: "Disadvantage" }] },
      { kind: "text", key: "on", label: "On", help: "attacks, attacksAgainst, saves, initiative, save:dex, check:<name>" },
      whenField,
    ],
    template: () => ({ type: "advantage", mode: "advantage", on: "attacks", when: [] }),
  },
  reduceDamage: {
    label: "Reduce damage taken",
    fields: [
      { kind: "select", key: "mode", label: "Mode", options: [{ value: "flat", label: "By a flat amount" }, { value: "halve", label: "Halve it" }] },
      { kind: "number", key: "amount", label: "Amount (flat only)" },
      { kind: "number", key: "times", label: "Times", min: 1 },
      per,
    ],
    template: () => ({ type: "reduceDamage", mode: "halve", amount: 0, times: 1, per: "round" }),
  },
  autoSucceedSave: {
    label: "Auto-succeed a failed save",
    fields: [{ kind: "number", key: "times", label: "Times", min: 1 }, per],
    template: () => ({ type: "autoSucceedSave", times: 1, per: "combat" }),
  },
  lifesteal: {
    label: "Lifesteal",
    fields: [{ kind: "number", key: "fraction", label: "Fraction of damage dealt (0–1)", step: 0.05 }],
    template: () => ({ type: "lifesteal", fraction: 0.5 }),
  },
  raiseSlain: {
    label: "Raise slain enemies",
    fields: [
      { kind: "text", key: "creatureType", label: "Creature type", placeholder: "humanoid" },
      { kind: "select", key: "asCreatureId", label: "Raised as", options: { ref: "creatures" } },
      { kind: "number", key: "times", label: "Times", min: 1 },
      per,
    ],
    template: () => ({ type: "raiseSlain", creatureType: "humanoid", asCreatureId: "", times: 1, per: "combat" }),
  },
  grantAction: {
    label: "Grant a combat action",
    fields: [{ kind: "json", key: "action", label: "Action (stat block action JSON)", rows: 10 }],
    template: () => ({
      type: "grantAction",
      action: { name: "New action", text: "", uses: { type: "perCombat", times: 1 }, profile: { kind: "text" }, review: "text" },
    }),
  },
  vision: { label: "Vision", fields: [{ kind: "number", key: "range", label: "Regions away", min: 0 }], template: () => ({ type: "vision", range: 1 }) },
  stealthDc: {
    label: "Stealth DC (watchtower)",
    fields: [
      { kind: "number", key: "dc", label: "DC" },
      { kind: "checkbox", key: "enemyDisadvantage", label: "Enemies have disadvantage on Stealth" },
      { kind: "number", key: "adjacentDc", label: "DC for stealthed units in adjacent regions", nullable: true },
    ],
    template: () => ({ type: "stealthDc", dc: 13, enemyDisadvantage: true }),
  },
  regionDamage: {
    label: "Region hazard damage",
    fields: [
      { kind: "text", key: "dice", label: "Dice", placeholder: "1d6" },
      { kind: "text", key: "damageType", label: "Damage type", placeholder: "fire" },
      { kind: "select", key: "trigger", label: "When", options: [{ value: "roundStart", label: "Start of each round" }, { value: "enter", label: "On entering" }] },
      { kind: "text", key: "unlessItemTag", label: "Unless carrying an item tagged" },
    ],
    template: () => ({ type: "regionDamage", dice: "1d6", damageType: "fire", trigger: "enter" }),
  },
  freeActions: {
    label: "Free action uses",
    fields: [
      { kind: "select", key: "actionTypeId", label: "Action", options: { ref: "actionTypes" } },
      { kind: "number", key: "uses", label: "Uses per round", min: 1 },
    ],
    template: () => ({ type: "freeActions", actionTypeId: "", uses: 1 }),
  },
  exchange: {
    label: "Resource exchange",
    fields: [
      {
        kind: "list",
        key: "rates",
        label: "Rates",
        newItem: () => ({ give: {}, get: {} }),
        fields: [
          { kind: "resources", key: "give", label: "Give" },
          { kind: "resources", key: "get", label: "Get" },
        ],
      },
    ],
    template: () => ({ type: "exchange", rates: [{ give: {}, get: {} }] }),
  },
  storage: {
    label: "Storage capacity",
    fields: [
      { kind: "number", key: "capacity", label: "Capacity", min: 1 },
      { kind: "text", key: "tag", label: "Unit tag stored", placeholder: "monster" },
    ],
    template: () => ({ type: "storage", capacity: 3, tag: "monster" }),
  },
  rollEachRound: {
    label: "Roll on a table each round",
    fields: [{ kind: "select", key: "tableId", label: "Table", options: { ref: "rollTables" } }],
    template: () => ({ type: "rollEachRound", tableId: "" }),
  },
  abilityChoiceBonus: {
    label: "Ability bonus chosen when built",
    fields: [{ kind: "number", key: "amount", label: "Amount" }],
    template: () => ({ type: "abilityChoiceBonus", amount: 2 }),
  },
  freeHeal: { label: "Free heal each round", fields: [{ kind: "number", key: "units", label: "Units healed", min: 1 }], template: () => ({ type: "freeHeal", units: 1 }) },
  portal: { label: "Portal capacity", fields: [{ kind: "number", key: "unitsPerAction", label: "Units per action", min: 1 }], template: () => ({ type: "portal", unitsPerAction: 1 }) },
  ignoreDifficultTerrain: {
    label: "Ignores difficult terrain",
    fields: [{ kind: "checkbox", key: "group", label: "Units travelling with it also ignore it" }],
    template: () => ({ type: "ignoreDifficultTerrain", group: true }),
  },
  spells: {
    label: "Can cast spells",
    fields: [
      { kind: "multiselect", key: "spellIds", label: "Spells", options: { ref: "spells" } },
      {
        kind: "custom",
        key: "uses",
        label: "Uses of each",
        render: (v, onChange) => (
          <div className="flex gap-2">
            <select className={input} value={v?.type ?? "perCombat"} aria-label="Uses" onChange={(e) => onChange(e.target.value === "atWill" ? { type: "atWill" } : { type: e.target.value, times: v?.times ?? 1 })}>
              <option value="perCombat">Per combat</option>
              <option value="perDay">Per round</option>
              <option value="atWill">At will</option>
            </select>
            {v?.type !== "atWill" && <input className={`${input} w-20`} type="number" min={1} value={v?.times ?? 1} aria-label="Times" onChange={(e) => onChange({ ...v, times: Number(e.target.value) })} />}
          </div>
        ),
      },
    ],
    template: () => ({ type: "spells", spellIds: [], uses: { type: "perCombat", times: 1 } }),
  },
  waiveUpkeep: {
    label: "Pays no upkeep in…",
    fields: [{ kind: "multiselect", key: "resourceIds", label: "Resources", options: { ref: "resources" } }],
    template: () => ({ type: "waiveUpkeep", resourceIds: [] }),
  },
  equipLimit: {
    label: "Equipped item limit",
    fields: [{ kind: "number", key: "max", label: "Max equipped items", min: 0 }],
    template: () => ({ type: "equipLimit", max: 4 }),
  },
  text: { label: "Text only (DM handles it)", fields: [{ kind: "textarea", key: "text", label: "Text" }], template: () => ({ type: "text", text: "" }) },
};

function describeLoose(item: Obj, ctx?: FieldContext): string {
  const parsed = EffectSchema.safeParse(item);
  if (!parsed.success) return `${effectVariants[item.type as Effect["type"]]?.label ?? item.type} (incomplete)`;
  const name = (list: { id: string; name?: string }[] | undefined) => (id: string) => list?.find((x) => x.id === id)?.name ?? id;
  return describeEffect(parsed.data, {
    action: name(ctx?.ruleset.actionTypes),
    table: name(ctx?.ruleset.rollTables),
  });
}

const effectsSpec: Extract<FieldSpec, { kind: "unionList" }> = {
  kind: "unionList",
  key: "effects",
  label: "Effects",
  discriminator: "type",
  variants: effectVariants,
  describe: (item) => describeLoose(item),
};
