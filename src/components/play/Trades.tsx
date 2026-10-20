"use client";

import { useState, useTransition } from "react";
import { cancelTradeAction, proposeTradeAction, respondTradeAction } from "@/app/play/trades/actions";
import { NO_NOTE, noteFor, TeamNoteOption, useTeamNote } from "@/components/dm/TeamNoteOption";
import { tradeNote, type TradeStep } from "@/engine/dmEdits";
import type { TeamNote } from "@/engine/messages";
import type { TradeView } from "@/lib/trades";
import { TeamEmblem } from "@/components/icons/TeamEmblem";
import { useViewerInfo } from "./viewerInfo";

// The player's trades: a list with Accept / Decline / Call off, and a form to
// propose one to a faction the team has met. The DM editing as the team
// confirms each step, with the option to send the team a note about it.

const STATUS: Record<string, string> = {
  proposed: "waiting for an answer",
  accepted: "accepted: happens at the end of the round",
  declined: "declined",
  cancelled: "called off",
  executed: "done",
  failed: "failed",
};
const btn = "rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-50";
const primary = "rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-50";
const field = "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm";

const STEP_LABEL: Record<Exclude<TradeStep, "propose">, string> = { accept: "Accept", decline: "Decline", cancel: "Call off" };

export function TradeList({ trades }: { trades: TradeView[] }) {
  const { isDm } = useViewerInfo();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // The DM's step waiting to be confirmed, and its note.
  const [confirm, setConfirm] = useState<{ tradeId: string; step: Exclude<TradeStep, "propose"> } | null>(null);
  const [noteState, setNoteState] = useState(NO_NOTE);
  const run = (tradeId: string, step: Exclude<TradeStep, "propose">, note?: TeamNote) =>
    start(async () => {
      const r = step === "cancel" ? await cancelTradeAction(tradeId, note) : await respondTradeAction(tradeId, step === "accept", note);
      setError(r.ok ? null : (r.error ?? "Something went wrong."));
      if (r.ok) setConfirm(null);
    });
  const act = (tradeId: string, step: Exclude<TradeStep, "propose">) => {
    if (!isDm) return run(tradeId, step);
    setNoteState(NO_NOTE);
    setConfirm({ tradeId, step });
  };
  if (!trades.length) return <p className="mt-3 text-sm text-muted">None.</p>;
  return (
    <>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
      <ul className="mt-3 space-y-3">
        {trades.map((t) => (
          <li key={t.id} className="rounded-lg border border-border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <TeamEmblem team={t.otherTeam} size={18} />
              <strong>{t.direction === "out" ? `To ${t.otherTeam.name}` : `From ${t.otherTeam.name}`}</strong>
              <span className="text-xs text-muted">round {t.round}</span>
              <span className="ml-auto text-xs">{STATUS[t.status] ?? t.status}</span>
            </div>
            <p className="mt-1">
              <span className="text-muted">You give:</span> {t.give}
            </p>
            <p>
              <span className="text-muted">You get:</span> {t.get}
            </p>
            {t.message && <p className="mt-1 whitespace-pre-wrap border-l-2 border-border pl-2 italic">{t.message}</p>}
            {t.result && <p className={`mt-1 text-xs ${t.status === "failed" ? "text-danger" : "text-muted"}`}>{t.result}</p>}
            <div className="mt-2 flex flex-wrap gap-2">
              {t.direction === "in" && t.status === "proposed" && (
                <>
                  <button type="button" className={primary} disabled={pending} onClick={() => act(t.id, "accept")}>
                    Accept
                  </button>
                  <button type="button" className={btn} disabled={pending} onClick={() => act(t.id, "decline")}>
                    Decline
                  </button>
                </>
              )}
              {(t.status === "proposed" || t.status === "accepted") && (
                <button type="button" className={btn} disabled={pending} onClick={() => act(t.id, "cancel")}>
                  Call off
                </button>
              )}
            </div>
            {confirm?.tradeId === t.id && (
              <div className="mt-2 space-y-2 rounded-lg border border-accent/50 p-2">
                <TeamNoteOption suggested={tradeNote(confirm.step, t.otherTeam.name)} value={noteState} onChange={setNoteState} />
                <div className="flex gap-2">
                  <button type="button" className={primary} disabled={pending} onClick={() => run(t.id, confirm.step, noteFor(noteState, tradeNote(confirm.step, t.otherTeam.name)))}>
                    {STEP_LABEL[confirm.step]} (DM)
                  </button>
                  <button type="button" className={btn} onClick={() => setConfirm(null)}>
                    Back
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

type Option = { id: string; name: string };
interface Holdings {
  resources: { id: string; name: string; icon: string; have: number }[];
  items: { id: string; name: string; have: number }[];
  recipes: Option[];
  races: Option[];
  units: Option[];
  regions: Option[];
}
interface Side {
  resources: Record<string, number>;
  items: Record<string, number>;
  recipeIds: string[];
  raceIds: string[];
  unitIds: string[];
  regionIds: string[];
  map: boolean;
}
const empty = (): Side => ({ resources: {}, items: {}, recipeIds: [], raceIds: [], unitIds: [], regionIds: [], map: false });

function Amount({ label, value, max, onChange }: { label: string; value: number; max?: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-1 text-sm">
      {label}
      <input
        type="number"
        min={0}
        max={max}
        className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm"
        value={value || ""}
        onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
      />
    </label>
  );
}

function Checks({ label, options, chosen, onChange }: { label: string; options: Option[]; chosen: string[]; onChange: (ids: string[]) => void }) {
  if (!options.length) return null;
  return (
    <fieldset>
      <legend className="text-xs text-muted">{label}</legend>
      <div className="mt-0.5 flex max-h-32 flex-col gap-0.5 overflow-y-auto rounded-md border border-border p-1.5">
        {options.map((o) => (
          <label key={o.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={chosen.includes(o.id)} onChange={(e) => onChange(e.target.checked ? [...chosen, o.id] : chosen.filter((x) => x !== o.id))} />
            {o.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function TradeForm({ contacts, holdings, catalogue }: { contacts: { id: string; name: string }[]; holdings: Holdings; catalogue: Option[] }) {
  const [to, setTo] = useState(contacts[0]?.id ?? "");
  const [give, setGive] = useState<Side>(empty);
  const [get, setGet] = useState<Side>(empty);
  const [askItem, setAskItem] = useState("");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const { isDm } = useViewerInfo();
  const note = useTeamNote(tradeNote("propose", contacts.find((c) => c.id === to)?.name ?? "another faction"));

  const submit = () =>
    start(async () => {
      const r = await proposeTradeAction({ toTeamId: to, give, get, message, note: isDm ? note.value : undefined });
      if (r.ok) {
        setGive(empty());
        setGet(empty());
        setMessage("");
        note.reset();
        setStatus({ ok: true, text: "Trade proposed. They can accept or decline it on their Trades page." });
      } else setStatus({ ok: false, text: r.error });
    });

  return (
    <div className="mt-3 space-y-4 text-sm">
      <label className="block">
        <span className="text-xs text-muted">With</span>
        <select className={field} value={to} onChange={(e) => setTo(e.target.value)}>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="space-y-2 rounded-lg border border-border p-3">
        <legend className="px-1 font-medium">You give</legend>
        <div className="flex flex-wrap gap-3">
          {holdings.resources.map((r) => (
            <Amount key={r.id} label={`${r.icon} ${r.name} (have ${r.have})`} max={r.have} value={give.resources[r.id] ?? 0} onChange={(v) => setGive({ ...give, resources: { ...give.resources, [r.id]: v } })} />
          ))}
        </div>
        {holdings.items.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {holdings.items.map((i) => (
              <Amount key={i.id} label={`${i.name} (×${i.have})`} max={i.have} value={give.items[i.id] ?? 0} onChange={(v) => setGive({ ...give, items: { ...give.items, [i.id]: v } })} />
            ))}
          </div>
        )}
        <Checks label="Recipes you know" options={holdings.recipes} chosen={give.recipeIds} onChange={(ids) => setGive({ ...give, recipeIds: ids })} />
        <Checks label="Races you've gained" options={holdings.races} chosen={give.raceIds} onChange={(ids) => setGive({ ...give, raceIds: ids })} />
        <Checks label="Units" options={holdings.units} chosen={give.unitIds} onChange={(ids) => setGive({ ...give, unitIds: ids })} />
        <Checks label="Regions" options={holdings.regions} chosen={give.regionIds} onChange={(ids) => setGive({ ...give, regionIds: ids })} />
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={give.map} onChange={(e) => setGive({ ...give, map: e.target.checked })} /> a copy of your map (every region you know)
        </label>
      </fieldset>

      <fieldset className="space-y-2 rounded-lg border border-border p-3">
        <legend className="px-1 font-medium">You ask for</legend>
        <div className="flex flex-wrap gap-3">
          {holdings.resources.map((r) => (
            <Amount key={r.id} label={`${r.icon} ${r.name}`} value={get.resources[r.id] ?? 0} onChange={(v) => setGet({ ...get, resources: { ...get.resources, [r.id]: v } })} />
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-48 flex-1">
            <span className="text-xs text-muted">An item</span>
            <select className={field} value={askItem} onChange={(e) => setAskItem(e.target.value)}>
              <option value="">Choose an item…</option>
              {catalogue.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={btn} disabled={!askItem} onClick={() => setGet({ ...get, items: { ...get.items, [askItem]: (get.items[askItem] ?? 0) + 1 } })}>
            Add
          </button>
        </div>
        {Object.entries(get.items).filter(([, q]) => q > 0).length > 0 && (
          <div className="flex flex-wrap gap-3">
            {Object.entries(get.items)
              .filter(([, q]) => q > 0)
              .map(([id, q]) => (
                <Amount key={id} label={catalogue.find((c) => c.id === id)?.name ?? id} value={q} onChange={(v) => setGet({ ...get, items: { ...get.items, [id]: v } })} />
              ))}
          </div>
        )}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={get.map} onChange={(e) => setGet({ ...get, map: e.target.checked })} /> a copy of their map
        </label>
        <p className="text-xs text-muted">To ask for units, regions, recipes or races, say so in your message: they can offer them back.</p>
      </fieldset>

      <label className="block">
        <span className="text-xs text-muted">Message (optional)</span>
        <textarea className={field} rows={2} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} />
      </label>
      {isDm && note.ui}
      <button type="button" className={primary} disabled={pending || !to} onClick={submit}>
        Propose trade{isDm ? " (DM)" : ""}
      </button>
      {status && (
        <p role="status" className={status.ok ? "text-ok" : "text-danger"}>
          {status.text}
        </p>
      )}
    </div>
  );
}
