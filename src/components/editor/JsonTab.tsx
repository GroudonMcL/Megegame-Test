"use client";

import { useState, useTransition } from "react";
import type { Problem } from "@/engine/ruleset/validate";
import type { SaveWhole } from "./SettingsEditor";

export function JsonTab({ gameId, version: initialVersion, problems, save, presets, loadPreset }: {
  gameId: string;
  version: number;
  problems: Problem[];
  save: SaveWhole;
  presets: { id: string; name: string }[];
  loadPreset: (presetId: string) => Promise<unknown>;
}) {
  const [text, setText] = useState("");
  const [version, setVersion] = useState(initialVersion);
  const [result, setResult] = useState<{ ok: boolean; text: string; problems: Problem[] } | null>(null);
  const [pending, startTransition] = useTransition();

  const replaceWith = (data: unknown, what: string) =>
    startTransition(async () => {
      const r = await save(data, version);
      if (r.ok) {
        setVersion(r.version);
        setResult({ ok: true, text: `${what} The ruleset has been replaced.`, problems: r.warnings });
        setText("");
      } else setResult({ ok: false, text: r.error, problems: r.problems });
    });

  const onImport = () => {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      setResult({ ok: false, text: "That isn't valid JSON. Check you copied the whole file.", problems: [] });
      return;
    }
    if (!confirm("Replace this game's whole ruleset with the imported one? Export a backup first if you might want it back.")) return;
    replaceWith(data, "Imported.");
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Import / export</h2>
        <p className="text-sm text-muted">The whole ruleset is one JSON file: back it up, share it, or move it to another game.</p>
      </div>

      <section className="glass rounded-xl border border-border shadow-panel p-4">
        <h3 className="font-medium">Problems</h3>
        {problems.length === 0 ? (
          <p className="text-sm text-ok">No broken references. ✓</p>
        ) : (
          <ul className="mt-1 list-disc pl-5 text-sm">
            {problems.map((p, i) => (
              <li key={i}>
                <span className="font-mono text-xs">{p.path}</span>: {p.message}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="glass rounded-xl border border-border shadow-panel p-4">
        <h3 className="font-medium">Export</h3>
        <a href={`/dm/games/${gameId}/ruleset/export`} className="mt-2 inline-block rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground">
          Download ruleset JSON
        </a>
      </section>

      <section className="glass rounded-xl border border-border shadow-panel p-4">
        <h3 className="font-medium">Import</h3>
        <p className="text-sm text-muted">Choose a ruleset .json file, or paste its contents below. It&apos;s checked before anything is replaced.</p>
        <input
          type="file"
          accept="application/json,.json"
          className="mt-2 text-sm"
          aria-label="Ruleset file"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) setText(await f.text());
          }}
        />
        <textarea className="mt-2 h-48 w-full rounded-md border border-border bg-background p-2 font-mono text-xs" value={text} onChange={(e) => setText(e.target.value)} placeholder="{ … }" aria-label="Ruleset JSON" />
        <button type="button" disabled={!text || pending} onClick={onImport} className="mt-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50">
          {pending ? "Importing…" : "Check and import"}
        </button>
      </section>

      <section className="glass rounded-xl border border-border shadow-panel p-4">
        <h3 className="font-medium">Reset to a preset</h3>
        <p className="text-sm text-muted">Replaces the whole ruleset with a fresh copy of a preset.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.id}
              type="button"
              disabled={pending}
              className="rounded-lg border border-border px-3 py-1.5 text-sm"
              onClick={() => {
                if (!confirm(`Replace this game's ruleset with a fresh “${p.name}”? Your edits will be lost unless you've exported them.`)) return;
                startTransition(async () => replaceWith(await loadPreset(p.id), `Reset to ${p.name}.`));
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      </section>

      {result && (
        <div className={`rounded-lg border p-3 text-sm ${result.ok ? "border-ok/40" : "border-danger/50"}`} role="status">
          <p className={result.ok ? "text-ok" : "text-danger"}>{result.text}</p>
          {result.problems.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {result.problems.slice(0, 50).map((p, i) => (
                <li key={i}>
                  <span className="font-mono">{p.path}</span>: {p.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
