"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  acceptAction,
  acceptAllReadyAction,
  applyEndAction,
  backToQueueAction,
  computeEndAction,
  failAction,
  prepareStepAction,
  publishAction,
  rerollAction,
  startResolvingAction,
  undoAction,
  type Result,
} from "@/app/dm/games/[gameId]/resolve/actions";
import { EconomyTable } from "@/components/play/EconomyTable";
import type { Economy } from "@/engine/orders/economy";

// The DM's resolution queue: every team's action 1, then action 2… Each order
// shows what the app worked out; the DM accepts, edits, re-rolls or rejects it.

export interface ResolveItem {
  id: string;
  teamId: string;
  teamName: string;
  teamColour: string;
  kind: string;
  slot: number | null;
  status: string;
  submitted: boolean;
  backup: "waiting" | "active" | "notNeeded" | null;
  scene: number | null;
  actionName: string;
  inputs: string[];
  notes: string;
  outcome: {
    text: string;
    adjust: Record<string, number>;
    hideRolls: boolean;
    delta: Record<string, number> | null;
    proposal: {
      status: string;
      problems: string[];
      notes: string[];
      rolls: { label: string; breakdown: string }[];
      changes: string[];
    } | null;
  } | null;
}

type Resource = { id: string; name: string; icon: string; kind: string };

interface Props {
  gameId: string;
  round: { number: number; status: string } | null;
  steps: { step: number; pending: number; flags: { kind: string; text: string; orderIds: string[] }[]; items: ResolveItem[] }[];
  resources: Resource[];
  lastUndo: string | null;
  endOfRound: {
    applied: boolean;
    adjust: Record<string, Record<string, number>>;
    teams: { teamId: string; teamName: string; economy: Economy; rolls: { label: string; breakdown: string }[]; lines: string[]; notes: string[] }[];
    wild: string[];
  } | null;
}

const STATUS_STYLE: Record<string, string> = {
  ready: "bg-ok/15 text-ok",
  needsReview: "bg-amber-500/15 text-amber-600",
  needsDm: "bg-accent/15 text-accent",
  invalid: "bg-danger/15 text-danger",
};
const STATUS_LABEL: Record<string, string> = { ready: "Ready", needsReview: "Needs review", needsDm: "Needs DM", invalid: "Can't happen" };
const DONE = new Set(["resolved", "failed", "skipped"]);
const btn = "rounded-lg border border-border px-3 py-1.5 text-sm disabled:opacity-50";
const primary = "rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground disabled:opacity-50";

export function ResolveClient(props: Props) {
  const { gameId, round } = props;
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [team, setTeam] = useState("");
  const [showDone, setShowDone] = useState(false);

  const act = (fn: () => Promise<Result>) =>
    start(async () => {
      const r = await fn();
      setMessage(r.ok ? (r.message ? { ok: true, text: r.message } : null) : { ok: false, text: r.error });
    });

  if (!round) return <p className="text-sm text-muted">Open a round on the Teams page first.</p>;
  const teams = [...new Map(props.steps.flatMap((s) => s.items.map((i) => [i.teamId, i.teamName] as const))).entries()];
  const totalPending = props.steps.reduce((n, s) => n + s.pending, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-medium">
          Round {round.number}: {round.status}
        </h2>
        {(round.status === "resolving" || round.status === "review") && (
          <button type="button" className={btn} disabled={pending || !props.lastUndo} onClick={() => act(() => undoAction(gameId))} title={props.lastUndo ?? ""}>
            ↶ Undo last{props.lastUndo ? `: ${props.lastUndo.slice(0, 50)}${props.lastUndo.length > 50 ? "…" : ""}` : ""}
          </button>
        )}
        {pending && <span className="text-sm text-muted">Working…</span>}
      </div>
      {message && (
        <p role="status" className={`text-sm ${message.ok ? "text-ok" : "text-danger"}`}>
          {message.text}
        </p>
      )}

      {(round.status === "open" || round.status === "locked") && (
        <div className="rounded-xl border border-border bg-card p-4 text-sm">
          <p>
            {round.status === "open" ? "Orders are still open. " : "Orders are locked. "}
            Starting resolution locks orders and freezes what players see until you publish.
          </p>
          <button type="button" className={`${primary} mt-3`} disabled={pending} onClick={() => act(() => startResolvingAction(gameId))}>
            Start resolving
          </button>
        </div>
      )}

      {round.status === "published" && (
        <div className="rounded-xl border border-border bg-card p-4 text-sm">
          <p>Round {round.number} is published: teams can see their results.</p>
          <Link href={`/dm/games/${gameId}`} className="mt-2 inline-block text-accent underline">
            Open round {round.number + 1} on the Teams page →
          </Link>
        </div>
      )}

      {round.status === "resolving" && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-1">
              Team
              <select className="rounded-md border border-border bg-background px-2 py-1" value={team} onChange={(e) => setTeam(e.target.value)}>
                <option value="">All</option>
                {teams.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show decided orders
            </label>
            <span className="text-muted">{totalPending} still to decide</span>
            <button type="button" className={`${primary} ml-auto`} disabled={pending} onClick={() => act(() => computeEndAction(gameId, false))}>
              Go to end of round →
            </button>
          </div>
          {props.steps.length === 0 && <p className="text-sm text-muted">No orders this round.</p>}
          {props.steps.map((s) => (
            <Step key={s.step} step={s} props={props} team={team} showDone={showDone} act={act} busy={pending} />
          ))}
        </>
      )}

      {round.status === "review" && props.endOfRound && <EndOfRound props={props} act={act} busy={pending} />}
    </div>
  );
}

function Step({ step: s, props, team, showDone, act, busy }: { step: Props["steps"][number]; props: Props; team: string; showDone: boolean; act: (fn: () => Promise<Result>) => void; busy: boolean }) {
  const items = s.items.filter((i) => (!team || i.teamId === team) && (showDone || !DONE.has(i.status)));
  const unprepared = s.items.some((i) => !DONE.has(i.status) && i.status !== "prepared" && i.backup !== "waiting");
  const ready = s.items.filter((i) => i.status === "prepared" && i.outcome?.proposal?.status === "ready" && i.backup !== "waiting").length;
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">Action {s.step}</h3>
        <span className="text-sm text-muted">
          {s.pending ? `${s.pending} to decide` : "all decided ✓"} · {s.items.length} order{s.items.length === 1 ? "" : "s"}
        </span>
        <span className="ml-auto flex gap-2">
          {unprepared && (
            <button type="button" className={primary} disabled={busy} onClick={() => act(() => prepareStepAction(props.gameId, s.step))}>
              Prepare action {s.step}
            </button>
          )}
          {ready > 0 && (
            <button type="button" className={btn} disabled={busy} onClick={() => act(() => acceptAllReadyAction(props.gameId, s.step))}>
              Accept all ready ({ready})
            </button>
          )}
        </span>
      </div>
      {s.flags.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {s.flags.map((f, i) => (
            <li key={i} className={f.kind === "meeting" ? "text-danger" : "text-amber-600"}>
              ⚑ {f.text}
            </li>
          ))}
        </ul>
      )}
      <ol className="mt-3 space-y-3">
        {items.map((i) => (
          <OrderItem key={i.id} item={i} props={props} act={act} busy={busy} />
        ))}
        {items.length === 0 && <li className="text-sm text-muted">Nothing to show.</li>}
      </ol>
    </section>
  );
}

function OrderItem({ item: i, props, act, busy }: { item: ResolveItem; props: Props; act: (fn: () => Promise<Result>) => void; busy: boolean }) {
  const o = i.outcome;
  const p = o?.proposal ?? null;
  const [text, setText] = useState(o?.text ?? "");
  const [adjust, setAdjust] = useState<Record<string, number>>(o?.adjust ?? {});
  const [hideRolls, setHideRolls] = useState(o?.hideRolls ?? false);
  // Pick up a new proposal (after a re-roll or re-prepare).
  const [seen, setSeen] = useState(o);
  if (seen !== o) {
    setSeen(o);
    setText(o?.text ?? "");
    setAdjust(o?.adjust ?? {});
    setHideRolls(o?.hideRolls ?? false);
  }
  const done = DONE.has(i.status);
  const waiting = i.backup === "waiting";
  const label = i.kind === "numbered" ? `Action ${i.slot}` : i.kind === "free" ? "Free" : "Backup";

  return (
    <li className={`rounded-lg border p-3 ${done ? "border-border opacity-70" : p?.status === "invalid" ? "border-danger" : "border-border"}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="h-3 w-3 rounded-full" style={{ background: i.teamColour }} />
        <strong>{i.teamName}</strong>
        <span className="rounded border border-border px-1.5 text-xs">{label}</span>
        <span className="font-medium">{i.actionName}</span>
        {!i.submitted && <span className="rounded bg-danger/15 px-1.5 text-xs text-danger" title="This team saved but never submitted its orders">draft</span>}
        {i.scene && <span className="rounded bg-amber-500/15 px-1.5 text-xs text-amber-600">scene {i.scene}</span>}
        {waiting && <span className="text-xs text-muted">waits for the action above to fail</span>}
        {p && !done && <span className={`ml-auto rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[p.status]}`}>{STATUS_LABEL[p.status]}</span>}
        {done && <span className="ml-auto rounded border border-border px-2 py-0.5 text-xs">{i.status}</span>}
      </div>
      {i.inputs.length > 0 && <p className="mt-1 text-sm text-muted">{i.inputs.join(" · ")}</p>}
      {i.notes && <p className="mt-1 whitespace-pre-wrap border-l-2 border-border pl-2 text-sm italic">{i.notes}</p>}

      {done ? (
        <p className="mt-2 whitespace-pre-wrap text-sm">{o?.text}</p>
      ) : !p ? (
        <p className="mt-2 text-sm text-muted">{waiting ? "" : "Not prepared yet."}</p>
      ) : (
        <div className="mt-2 space-y-2 text-sm">
          {p.problems.map((x, k) => (
            <p key={k} className="text-danger">
              ✕ {x}
            </p>
          ))}
          {p.notes.map((x, k) => (
            <p key={k} className="text-amber-600">
              ⓘ {x}
            </p>
          ))}
          {p.rolls.length > 0 && (
            <ul className="rounded-md bg-background p-2 font-mono text-xs">
              {p.rolls.map((r, k) => (
                <li key={k}>
                  🎲 {r.label}: {r.breakdown}
                </li>
              ))}
            </ul>
          )}
          {p.changes.length > 0 && (
            <ul className="list-inside list-disc text-xs text-muted">
              {p.changes.map((c, k) => (
                <li key={k}>{c}</li>
              ))}
            </ul>
          )}
          <label className="block">
            <span className="text-xs text-muted">Outcome text for the team</span>
            <textarea className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          </label>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-muted">Extra resources:</span>
            {props.resources.map((r) => (
              <label key={r.id} className="flex items-center gap-1">
                {r.icon || r.name}
                <input
                  type="number"
                  aria-label={`Adjust ${r.name}`}
                  className="w-16 rounded border border-border bg-background px-1 py-0.5"
                  value={adjust[r.id] ?? ""}
                  onChange={(e) => {
                    const next = { ...adjust };
                    if (e.target.value === "" || Number(e.target.value) === 0) delete next[r.id];
                    else next[r.id] = Number(e.target.value);
                    setAdjust(next);
                  }}
                />
              </label>
            ))}
            {p.rolls.length > 0 && (
              <label className="flex items-center gap-1">
                <input type="checkbox" checked={hideRolls} onChange={(e) => setHideRolls(e.target.checked)} /> hide rolls from the team
              </label>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={primary} disabled={busy || waiting || p.status === "invalid"} onClick={() => act(() => acceptAction(props.gameId, i.id, { text, adjust, hideRolls }))}>
              Accept
            </button>
            {p.rolls.length > 0 && (
              <button type="button" className={btn} disabled={busy} onClick={() => act(() => rerollAction(props.gameId, i.id))}>
                Re-roll
              </button>
            )}
            <button
              type="button"
              className={btn}
              disabled={busy || waiting}
              onClick={() => act(() => failAction(props.gameId, i.id, text || "This action failed.", "failed"))}
              title="Nothing happens; a backup order after it becomes active"
            >
              Mark failed
            </button>
            <button type="button" className={btn} disabled={busy} onClick={() => act(() => failAction(props.gameId, i.id, text || "Not carried out.", "skipped"))}>
              Skip
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function EndOfRound({ props, act, busy }: { props: Props; act: (fn: () => Promise<Result>) => void; busy: boolean }) {
  const eor = props.endOfRound!;
  const [adjust, setAdjust] = useState(eor.adjust);
  const set = (teamId: string, res: string, v: string) => {
    const t = { ...(adjust[teamId] ?? {}) };
    if (v === "" || Number(v) === 0) delete t[res];
    else t[res] = Number(v);
    setAdjust({ ...adjust, [teamId]: t });
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-4 text-sm">
        <p className="w-full">
          {eor.applied
            ? "The end of round has been applied: income, upkeep and rolls are in, and movement has been reset. Publish to release the results."
            : "Production, upkeep, per-round rolls, hazards and deficit rolls for every team. Adjust anything, then apply it."}
        </p>
        {!eor.applied && (
          <>
            <button type="button" className={btn} disabled={busy} onClick={() => act(() => backToQueueAction(props.gameId))}>
              ← Back to the queue
            </button>
            <button type="button" className={btn} disabled={busy} onClick={() => act(() => computeEndAction(props.gameId, true))}>
              Recalculate and re-roll
            </button>
            <button type="button" className={primary} disabled={busy} onClick={() => act(() => applyEndAction(props.gameId, adjust))}>
              Apply end of round
            </button>
          </>
        )}
        {eor.applied && (
          <button type="button" className={primary} disabled={busy} onClick={() => act(() => publishAction(props.gameId))}>
            Publish round {props.round!.number}
          </button>
        )}
      </div>
      {eor.teams.map((t) => (
        <section key={t.teamId} className="rounded-xl border border-border bg-card p-4">
          <h3 className="font-medium">{t.teamName}</h3>
          <div className="mt-2">
            <EconomyTable economy={t.economy} resources={props.resources} />
          </div>
          {t.lines.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-sm">
              {t.lines.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          )}
          {t.rolls.length > 0 && (
            <ul className="mt-2 rounded-md bg-background p-2 font-mono text-xs">
              {t.rolls.map((r, i) => (
                <li key={i}>
                  🎲 {r.label}: {r.breakdown}
                </li>
              ))}
            </ul>
          )}
          {t.notes.map((n, i) => (
            <p key={i} className="mt-1 text-sm text-amber-600">
              ⓘ {n}
            </p>
          ))}
          {!eor.applied && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted">Adjust:</span>
              {props.resources.map((r) => (
                <label key={r.id} className="flex items-center gap-1">
                  {r.icon || r.name}
                  <input type="number" aria-label={`Adjust ${r.name} for ${t.teamName}`} className="w-16 rounded border border-border bg-background px-1 py-0.5" value={adjust[t.teamId]?.[r.id] ?? ""} onChange={(e) => set(t.teamId, r.id, e.target.value)} />
                </label>
              ))}
            </div>
          )}
        </section>
      ))}
      {eor.wild.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-4 text-sm">
          <h3 className="font-medium">Wild monsters</h3>
          <ul className="mt-1 list-inside list-disc">
            {eor.wild.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
