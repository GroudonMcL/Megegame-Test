"use client";

import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { SECTION_SCHEMAS, type Ruleset, type RulesetSection } from "@/engine/ruleset/ruleset";
import type { Problem } from "@/engine/ruleset/validate";
import { Fields, type FieldContext, type FieldSpec } from "./fields";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Item = Record<string, any> & { id: string };

export type SaveSection = (section: RulesetSection, items: unknown[], version: number) => Promise<
  { ok: true; version: number; warnings: Problem[] } | { ok: false; error: string; problems: Problem[] }
>;

interface Props {
  section: RulesetSection;
  title: string;
  intro: string;
  ruleset: Ruleset;
  version: number;
  save: SaveSection;
  label: (item: any) => string;
  newItem: (id: string) => Item;
  /** Either a field list, or a custom detail editor. */
  fields?: FieldSpec[];
  renderDetail?: (item: Item, onChange: (v: Item) => void, ctx: FieldContext) => ReactNode;
  /** Extra controls above the list (e.g. "Add from SRD"). */
  extraToolbar?: (add: (item: Item) => void) => ReactNode;
  initialSelectedId?: string;
}

function issuesFor(section: RulesetSection, item: Item): string[] {
  const r = SECTION_SCHEMAS[section].safeParse(item);
  if (r.success) return [];
  return r.error.issues.map((i) => `${i.path.join(" › ") || "item"}: ${i.message}`);
}

function uniqueId(base: string, items: Item[]) {
  let id = base;
  let n = 2;
  while (items.some((x) => x.id === id)) id = `${base}-${n++}`;
  return id;
}

export function SectionEditor(props: Props) {
  const { section } = props;
  const [items, setItems] = useState<Item[]>(() => props.ruleset[section] as Item[]);
  const [version, setVersion] = useState(props.version);
  const [selected, setSelected] = useState<number>(() => {
    const i = (props.ruleset[section] as Item[]).findIndex((x) => x.id === props.initialSelectedId);
    return i >= 0 ? i : 0;
  });
  const [dirty, setDirty] = useState(false);
  const [filter, setFilter] = useState("");
  const [asJson, setAsJson] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string; problems: Problem[] } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const ctx: FieldContext = useMemo(() => ({ ruleset: { ...props.ruleset, [section]: items } as Ruleset }), [props.ruleset, section, items]);
  const issues = useMemo(() => items.map((x) => issuesFor(section, x)), [items, section]);
  const current = items[selected];

  const update = (next: Item[]) => {
    setItems(next);
    setDirty(true);
    setStatus(null);
  };
  const add = (item: Item) => {
    const withId = { ...item, id: uniqueId(item.id, items) };
    update([...items, withId]);
    setSelected(items.length);
  };

  const onSave = () =>
    startTransition(async () => {
      const result = await props.save(section, items, version);
      if (result.ok) {
        setVersion(result.version);
        setDirty(false);
        const mine = result.warnings;
        setStatus({ kind: "ok", text: mine.length ? `Saved, with ${mine.length} problem${mine.length === 1 ? "" : "s"} to fix:` : "Saved.", problems: mine });
      } else {
        setStatus({ kind: "error", text: result.error, problems: result.problems });
      }
    });

  const visible = items.map((x, i) => ({ x, i })).filter(({ x }) => !filter || props.label(x).toLowerCase().includes(filter.toLowerCase()) || x.id.includes(filter.toLowerCase()));
  const totalIssues = issues.reduce((s, x) => s + (x.length ? 1 : 0), 0);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{props.title}</h2>
          <p className="text-sm text-muted">{props.intro}</p>
        </div>
        <div className="flex items-center gap-3">
          {dirty && <span className="text-sm text-muted">Unsaved changes</span>}
          <button
            type="button"
            onClick={onSave}
            disabled={pending || !dirty || totalIssues > 0}
            title={totalIssues ? "Fix the items marked ⚠ first" : undefined}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      {status && (
        <div className={`mt-3 rounded-lg border p-3 text-sm ${status.kind === "ok" ? "border-ok/40" : "border-danger/50"}`} role="status">
          <p className={status.kind === "ok" ? "text-ok" : "text-danger"}>{status.text}</p>
          {status.problems.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {status.problems.slice(0, 30).map((p, i) => (
                <li key={i}>
                  <span className="font-mono">{p.path}</span>: {p.message}
                </li>
              ))}
              {status.problems.length > 30 && <li>…and {status.problems.length - 30} more (see the Import / export tab).</li>}
            </ul>
          )}
        </div>
      )}

      <div className="mt-4 grid gap-4 md:grid-cols-[16rem_1fr]">
        <aside className="space-y-2">
          <input
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            aria-label="Filter"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-md border border-border px-2 py-1 text-xs hover:bg-background" onClick={() => add(props.newItem("new"))}>
              + New
            </button>
            {props.extraToolbar?.(add)}
          </div>
          <ul className="max-h-[32rem] overflow-y-auto rounded-lg border border-border md:max-h-[70vh]">
            {visible.map(({ x, i }) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(i);
                    setAsJson(false);
                  }}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm ${i === selected ? "bg-accent text-accent-foreground" : "hover:bg-background"}`}
                >
                  <span className="truncate">{props.label(x) || x.id}</span>
                  {issues[i].length > 0 && <span title="Has problems">⚠</span>}
                </button>
              </li>
            ))}
            {items.length === 0 && <li className="px-3 py-2 text-sm text-muted">Nothing yet.</li>}
          </ul>
        </aside>

        <section className="min-w-0 glass rounded-xl border border-border shadow-panel p-4">
          {!current ? (
            <p className="text-sm text-muted">Pick something on the left, or add a new one.</p>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-lg font-medium">{props.label(current) || current.id}</h3>
                <div className="flex gap-2 text-xs">
                  <button type="button" className="rounded-md border border-border px-2 py-1" onClick={() => setAsJson(!asJson)}>
                    {asJson ? "Form" : "Edit as JSON"}
                  </button>
                  <button type="button" className="rounded-md border border-border px-2 py-1" onClick={() => add({ ...structuredClone(current), id: `${current.id}-copy` })}>
                    Duplicate
                  </button>
                  <button
                    type="button"
                    className="rounded-md border border-border px-2 py-1 text-danger"
                    onClick={() => {
                      if (!confirm(`Delete “${props.label(current) || current.id}”? Anything that refers to it will show a problem.`)) return;
                      update(items.filter((_, j) => j !== selected));
                      setSelected(Math.max(0, selected - 1));
                    }}
                  >
                    Delete
                  </button>
                </div>
              </div>

              {issues[selected].length > 0 && (
                <ul className="mb-3 list-disc rounded-lg border border-danger/50 p-3 pl-7 text-xs text-danger">
                  {issues[selected].map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              )}

              {asJson ? (
                <ItemJson key={selected} item={current} onChange={(v) => update(items.map((x, j) => (j === selected ? v : x)))} />
              ) : props.renderDetail ? (
                props.renderDetail(current, (v) => update(items.map((x, j) => (j === selected ? v : x))), ctx)
              ) : (
                <Fields key={selected} fields={props.fields ?? []} value={current} onChange={(v) => update(items.map((x, j) => (j === selected ? (v as Item) : x)))} ctx={ctx} />
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function ItemJson({ item, onChange }: { item: Item; onChange: (v: Item) => void }) {
  const [text, setText] = useState(() => JSON.stringify(item, null, 2));
  const [error, setError] = useState("");
  return (
    <div>
      <textarea
        className="h-[60vh] w-full rounded-md border border-border bg-background p-2 font-mono text-xs"
        value={text}
        aria-label="JSON"
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
