"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  acceptAction,
  acceptAllReadyAction,
  applyEndAction,
  backToQueueAction,
  computeEndAction,
  failAction,
  fightSettingsAction,
  oddsAction,
  prepareStepAction,
  publishAction,
  rerollAction,
  startResolvingAction,
  undoAction,
  type Result,
} from "@/app/dm/games/[gameId]/resolve/actions";
import { EconomyTable } from "@/components/play/EconomyTable";
import { FightLog } from "@/components/combat/FightLog";
import type { CombatOdds, LogEntry } from "@/engine/combat/types";
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
      fights: FightView[];
    } | null;
    fightSettings: { priority: Record<string, string>; byHand: boolean; shareLog: boolean; overrides: Overrides };
    odds: CombatOdds[] | null;
  } | null;
}

type Overrides = Record<string, { hp?: number; outcome?: "standing" | "dead" | "retreated" }>;

export interface FightView {
  regionName: string;
  sides: { id: string; name: string }[];
  winner: string | null;
  endReason: string;
  rounds: number;
  units: { unitId: string; sideId: string; label: string; startHp: number; hp: number; maxHp: number; outcome: string; raised: boolean }[];
  warnings: string[];
  log: LogEntry[];
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
    events: { tableId: string; teamIds: string[] } | null;
    eventTables: { id: string; name: string }[];
    trades: { summary: string; ok: boolean; problems: string[] }[];
  } | null;
}

const STATUS_STYLE: Record<string, string> = {
  ready: "bg-ok/15 text-ok",
  needsReview: "bg-warn/15 text-warn",
  needsDm: "bg-accent/15 text-link",
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
  const [stepFilter, setStepFilter] = useState(0);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState(false);
  // Where the keyboard focus goes once the order just decided by a shortcut is done.
  const advanceTo = useRef<string | null | undefined>(undefined);

  const act = (fn: () => Promise<Result>) =>
    start(async () => {
      const r = await fn();
      setMessage(r.ok ? (r.message ? { ok: true, text: r.message } : null) : { ok: false, text: r.error });
      if (r.ok && advanceTo.current !== undefined) setFocusId(advanceTo.current);
      advanceTo.current = undefined;
    });

  useEffect(() => {
    if (focusId) document.querySelector(`[data-order-card="${focusId}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusId]);

  // Keyboard shortcuts for the queue (see SHORTCUTS). Ignored while typing in a box.
  const resolving = round?.status === "resolving";
  useEffect(() => {
    if (!resolving) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]")) {
        if (e.key === "Escape") target.blur();
        return;
      }
      const cards = [...document.querySelectorAll<HTMLElement>("[data-order-card]")];
      const at = cards.findIndex((c) => c.dataset.orderCard === focusId);
      const card = cards[at];
      const goTo = (i: number) => {
        const c = cards[Math.max(0, Math.min(cards.length - 1, i))];
        if (c) setFocusId(c.dataset.orderCard!);
      };
      const press = (el: Element | null | undefined, advance: boolean) => {
        if (!(el instanceof HTMLButtonElement) || el.disabled) return;
        if (advance) advanceTo.current = cards[at + 1]?.dataset.orderCard ?? cards[at - 1]?.dataset.orderCard ?? null;
        el.click();
      };
      const button = (name: string) => card?.querySelector(`[data-shortcut="${name}"]`);
      switch (e.key) {
        case "j":
          goTo(at + 1);
          break;
        case "k":
          goTo(at < 0 ? 0 : at - 1);
          break;
        case "a":
          press(button("accept"), true);
          break;
        case "f":
          press(button("fail"), true);
          break;
        case "s":
          press(button("skip"), true);
          break;
        case "r":
          press(button("reroll"), false);
          break;
        case "e":
          card?.querySelector("textarea")?.focus();
          break;
        case "A":
          press(card?.closest("section")?.querySelector('[data-shortcut="accept-all"]') ?? document.querySelector('[data-shortcut="accept-all"]'), false);
          break;
        case "p":
          press(document.querySelector('[data-shortcut="prepare"]'), false);
          break;
        case "?":
          setShowKeys((v) => !v);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [resolving, focusId]);

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
        <div className="glass rounded-xl border border-border shadow-panel p-4 text-sm">
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
        <div className="glass rounded-xl border border-border shadow-panel p-4 text-sm">
          <p>Round {round.number} is published: teams can see their results.</p>
          <Link href={`/dm/games/${gameId}`} className="mt-2 inline-block text-link underline">
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
            <label className="flex items-center gap-1">
              Action
              <select className="rounded-md border border-border bg-background px-2 py-1" value={stepFilter} onChange={(e) => setStepFilter(Number(e.target.value))}>
                <option value={0}>All</option>
                {props.steps.map((s) => (
                  <option key={s.step} value={s.step}>
                    {s.step}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1" title="Orders grouped into a scene because they meet, target each other or end up in the same region">
              <input type="checkbox" checked={onlyFlagged} onChange={(e) => setOnlyFlagged(e.target.checked)} /> Only flagged
            </label>
            <span className="text-muted">{totalPending} still to decide</span>
            <button type="button" className={`${primary} ml-auto`} disabled={pending} onClick={() => act(() => computeEndAction(gameId, false))}>
              Go to end of round →
            </button>
          </div>
          <div className="text-xs text-muted">
            <button type="button" className="underline" onClick={() => setShowKeys(!showKeys)} aria-expanded={showKeys}>
              Keyboard shortcuts
            </button>{" "}
            (press <kbd>?</kbd>)
            {showKeys && (
              <dl className="mt-2 grid max-w-md grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-lg border border-border bg-card p-3 text-foreground">
                {SHORTCUTS.map(([k, what]) => (
                  <div key={k} className="contents">
                    <dt>
                      <kbd className="rounded border border-border px-1 font-mono">{k}</kbd>
                    </dt>
                    <dd>{what}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          {props.steps.length === 0 && <p className="text-sm text-muted">No orders this round.</p>}
          {props.steps
            .filter((s) => !stepFilter || s.step === stepFilter)
            .map((s) => (
              <Step key={s.step} step={s} props={props} filter={{ team, showDone, onlyFlagged }} focusId={focusId} setFocusId={setFocusId} act={act} busy={pending} />
            ))}
        </>
      )}

      {round.status === "review" && props.endOfRound && <EndOfRound props={props} act={act} busy={pending} />}
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ["j / k", "Next / previous order"],
  ["a", "Accept the highlighted order and move on"],
  ["f", "Mark it failed"],
  ["s", "Skip it"],
  ["r", "Re-roll it"],
  ["e", "Edit its outcome text (Esc to leave the box)"],
  ["Shift + A", "Accept all ready orders in this action"],
  ["p", "Prepare the next action"],
  ["?", "Show or hide this list"],
];

interface StepProps {
  step: Props["steps"][number];
  props: Props;
  filter: { team: string; showDone: boolean; onlyFlagged: boolean };
  focusId: string | null;
  setFocusId: (id: string) => void;
  act: (fn: () => Promise<Result>) => void;
  busy: boolean;
}

function Step({ step: s, props, filter: { team, showDone, onlyFlagged }, focusId, setFocusId, act, busy }: StepProps) {
  const items = s.items.filter((i) => (!team || i.teamId === team) && (showDone || !DONE.has(i.status)) && (!onlyFlagged || i.scene !== null));
  const unprepared = s.items.some((i) => !DONE.has(i.status) && i.status !== "prepared" && i.backup !== "waiting");
  const ready = s.items.filter((i) => i.status === "prepared" && i.outcome?.proposal?.status === "ready" && i.backup !== "waiting").length;
  return (
    <section className="glass rounded-xl border border-border shadow-panel p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-medium">Action {s.step}</h3>
        <span className="text-sm text-muted">
          {s.pending ? `${s.pending} to decide` : "all decided ✓"} · {s.items.length} order{s.items.length === 1 ? "" : "s"}
        </span>
        <span className="ml-auto flex gap-2">
          {unprepared && (
            <button type="button" className={primary} data-shortcut="prepare" disabled={busy} onClick={() => act(() => prepareStepAction(props.gameId, s.step))}>
              Prepare action {s.step}
            </button>
          )}
          {ready > 0 && (
            <button type="button" className={btn} data-shortcut="accept-all" disabled={busy} onClick={() => act(() => acceptAllReadyAction(props.gameId, s.step))}>
              Accept all ready ({ready})
            </button>
          )}
        </span>
      </div>
      {s.flags.length > 0 && (
        <ul className="mt-2 space-y-1 text-sm">
          {s.flags.map((f, i) => (
            <li key={i} className={f.kind === "meeting" ? "text-danger" : "text-warn"}>
              ⚑ {f.text}
            </li>
          ))}
        </ul>
      )}
      <ol className="mt-3 space-y-3">
        {items.map((i) => (
          <OrderItem key={i.id} item={i} props={props} act={act} busy={busy} focused={focusId === i.id} onFocus={() => setFocusId(i.id)} />
        ))}
        {items.length === 0 && <li className="text-sm text-muted">Nothing to show.</li>}
      </ol>
    </section>
  );
}

interface OrderItemProps {
  item: ResolveItem;
  props: Props;
  act: (fn: () => Promise<Result>) => void;
  busy: boolean;
  /** Highlighted for the keyboard shortcuts. */
  focused: boolean;
  onFocus: () => void;
}

function OrderItem({ item: i, props, act, busy, focused, onFocus }: OrderItemProps) {
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
    <li
      data-order-card={i.id}
      onClick={onFocus}
      className={`scroll-mt-4 rounded-lg border p-3 ${done ? "border-border opacity-70" : p?.status === "invalid" ? "border-danger" : "border-border"} ${focused ? "ring-2 ring-accent" : ""}`}
    >
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="h-3 w-3 rounded-full" style={{ background: i.teamColour }} />
        <strong>{i.teamName}</strong>
        <span className="rounded border border-border px-1.5 text-xs">{label}</span>
        <span className="font-medium">{i.actionName}</span>
        {!i.submitted && <span className="rounded bg-danger/15 px-1.5 text-xs text-danger" title="This team saved but never submitted its orders">draft</span>}
        {i.scene && <span className="rounded bg-warn/15 px-1.5 text-xs text-warn">scene {i.scene}</span>}
        {waiting && <span className="text-xs text-muted">waits for the action above to fail</span>}
        {p && !done && <span className={`ml-auto rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[p.status]}`}>{STATUS_LABEL[p.status]}</span>}
        {done && <span className="ml-auto rounded border border-border px-2 py-0.5 text-xs">{i.status}</span>}
      </div>
      {i.inputs.length > 0 && <p className="mt-1 text-sm text-muted">{i.inputs.join(" · ")}</p>}
      {i.notes && <p className="mt-1 whitespace-pre-wrap border-l-2 border-border pl-2 text-sm italic">{i.notes}</p>}

      {done ? (
        <>
          <p className="mt-2 whitespace-pre-wrap text-sm">{o?.text}</p>
          {i.status === "resolved" && p?.fights.map((f, k) => <FightLog key={k} log={f.log} title={`Fight log: ${f.regionName}`} />)}
        </>
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
            <p key={k} className="text-warn">
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
          {(p.fights.length > 0 || o!.fightSettings.byHand) && <FightPanel item={i} props={props} act={act} busy={busy} />}
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
            <button type="button" className={primary} data-shortcut="accept" disabled={busy || waiting || p.status === "invalid"} onClick={() => act(() => acceptAction(props.gameId, i.id, { text, adjust, hideRolls }))}>
              Accept
            </button>
            {(p.rolls.length > 0 || p.fights.length > 0) && (
              <button type="button" className={btn} data-shortcut="reroll" disabled={busy} onClick={() => act(() => rerollAction(props.gameId, i.id))} title="New dice for every roll and fight in this order">
                Re-roll
              </button>
            )}
            <button
              type="button"
              className={btn}
              data-shortcut="fail"
              disabled={busy || waiting}
              onClick={() => act(() => failAction(props.gameId, i.id, text || "This action failed.", "failed"))}
              title="Nothing happens; a backup order after it becomes active"
            >
              Mark failed
            </button>
            <button type="button" className={btn} data-shortcut="skip" disabled={busy} onClick={() => act(() => failAction(props.gameId, i.id, text || "Not carried out.", "skipped"))}>
              Skip
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

const OUTCOME_LABEL: Record<string, string> = { standing: "", dead: "dead", retreated: "retreated", captured: "captured" };

/** A simulated fight: who was in it, how it went, the log, and the DM's controls. */
function FightPanel({ item: i, props, act, busy }: { item: ResolveItem; props: Props; act: (fn: () => Promise<Result>) => void; busy: boolean }) {
  const o = i.outcome!;
  const fights = o.proposal?.fights ?? [];
  const [priority, setPriority] = useState(o.fightSettings.priority);
  const [byHand, setByHand] = useState(o.fightSettings.byHand);
  const [shareLog, setShareLog] = useState(o.fightSettings.shareLog);
  const [overrides, setOverrides] = useState<Overrides>(o.fightSettings.overrides);
  const [editing, setEditing] = useState(Object.keys(o.fightSettings.overrides).length > 0);
  const sentOverrides = editing ? overrides : {};
  const changed =
    JSON.stringify(priority) !== JSON.stringify(o.fightSettings.priority) ||
    byHand !== o.fightSettings.byHand ||
    shareLog !== o.fightSettings.shareLog ||
    JSON.stringify(sentOverrides) !== JSON.stringify(o.fightSettings.overrides);
  const override = (unitId: string, patch: Overrides[string]) => {
    const next = { ...overrides, [unitId]: { ...overrides[unitId], ...patch } };
    for (const k of Object.keys(next[unitId])) if (next[unitId][k as keyof Overrides[string]] === undefined) delete next[unitId][k as keyof Overrides[string]];
    if (!Object.keys(next[unitId]).length) delete next[unitId];
    setOverrides(next);
  };
  const sides = [...new Map(fights.flatMap((f) => f.sides.map((x) => [x.id, x.name] as const))).entries()];
  const enemiesOf = (sideId: string) => fights.flatMap((f) => f.units.filter((u) => u.sideId !== sideId && !u.raised));
  const name = (f: FightView, id: string | null) => f.sides.find((x) => x.id === id)?.name ?? "nobody";

  return (
    <div className="space-y-2 rounded-lg border border-warn/40 p-2">
      {fights.map((f, k) => {
        const odds = o.odds?.[k];
        return (
          <div key={k} className="space-y-1">
            <p className="font-medium">
              ⚔ Fight in {f.regionName}:{" "}
              {f.endReason === "noFight"
                ? "nobody to fight"
                : f.endReason === "captured"
                  ? `${name(f, f.winner)} captured the monster after ${f.rounds} round${f.rounds === 1 ? "" : "s"}`
                  : f.winner
                    ? `${name(f, f.winner)} won after ${f.rounds} round${f.rounds === 1 ? "" : "s"}`
                    : `undecided after ${f.rounds} rounds`}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <tbody>
                  {f.units.map((u) => (
                    <tr key={u.unitId} className="border-t border-border">
                      <td className="py-0.5 pr-2">{u.label}</td>
                      <td className="py-0.5 pr-2 tabular-nums">
                        {u.startHp} → {u.hp}/{u.maxHp} HP
                      </td>
                      <td className={`py-0.5 ${u.outcome === "dead" ? "text-danger" : u.outcome === "standing" ? "" : "text-warn"}`}>{OUTCOME_LABEL[u.outcome] ?? u.outcome}</td>
                      {editing && !u.raised && u.outcome !== "captured" && (
                        <td className="py-0.5 pl-2">
                          <span className="flex items-center gap-1">
                            <input
                              type="number"
                              min={0}
                              max={u.maxHp}
                              aria-label={`Final HP of ${u.label}`}
                              placeholder={String(u.hp)}
                              className="w-16 rounded border border-border bg-background px-1"
                              value={overrides[u.unitId]?.hp ?? ""}
                              onChange={(e) => override(u.unitId, { hp: e.target.value === "" ? undefined : Number(e.target.value) })}
                            />
                            <select
                              aria-label={`Outcome of ${u.label}`}
                              className="rounded border border-border bg-background px-1"
                              value={overrides[u.unitId]?.outcome ?? ""}
                              onChange={(e) => override(u.unitId, { outcome: (e.target.value || undefined) as Overrides[string]["outcome"] })}
                            >
                              <option value="">as simulated</option>
                              <option value="standing">standing</option>
                              <option value="retreated">retreated</option>
                              <option value="dead">dead</option>
                            </select>
                          </span>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {f.warnings.length > 0 && (
              <details className="text-xs text-warn">
                <summary className="cursor-pointer">Not automated ({f.warnings.length}): check whether these would change the result</summary>
                <ul className="list-inside list-disc">
                  {f.warnings.map((w, j) => (
                    <li key={j}>{w}</li>
                  ))}
                </ul>
              </details>
            )}
            <FightLog log={f.log} />
            {odds && (
              <p className="text-xs">
                🎲 Odds over {odds.runs} fights:{" "}
                {f.sides.map((x) => `${x.name} win ${Math.round((odds.wins[x.id] ?? 0) * 100)}% (lose ${(odds.losses[x.id] ?? 0).toFixed(1)} units, keep ${Math.round((odds.hpLeft[x.id] ?? 0) * 100)}% HP)`).join(" · ")}
                {odds.draws > 0 ? ` · undecided ${Math.round(odds.draws * 100)}%` : ""} · about {odds.rounds.toFixed(1)} rounds
              </p>
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap items-end gap-3 border-t border-border pt-2 text-xs">
        {!byHand &&
          sides.map(([id, sideName]) => (
            <label key={id} className="flex flex-col">
              <span className="text-muted">{sideName} focus on</span>
              <select
                className="rounded border border-border bg-background px-1 py-0.5"
                value={priority[id] ?? ""}
                onChange={(e) => {
                  const next = { ...priority };
                  if (e.target.value) next[id] = e.target.value;
                  else delete next[id];
                  setPriority(next);
                }}
              >
                <option value="">Automatic</option>
                {enemiesOf(id).map((u) => (
                  <option key={u.unitId} value={u.unitId}>
                    {u.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={byHand} onChange={(e) => setByHand(e.target.checked)} /> resolve by hand
        </label>
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={shareLog} onChange={(e) => setShareLog(e.target.checked)} /> show the log to the teams
        </label>
        {fights.length > 0 && !byHand && (
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={editing} onChange={(e) => setEditing(e.target.checked)} /> edit results by hand
          </label>
        )}
        <button type="button" className={btn} disabled={busy || !changed} onClick={() => act(() => fightSettingsAction(props.gameId, i.id, { priority, byHand, shareLog, overrides: sentOverrides }))}>
          Apply these settings
        </button>
        {fights.length > 0 && (
          <button type="button" className={btn} disabled={busy} onClick={() => act(() => oddsAction(props.gameId, i.id))}>
            Show odds
          </button>
        )}
      </div>
    </div>
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
      <div className="flex flex-wrap items-center gap-2 glass rounded-xl border border-border shadow-panel p-4 text-sm">
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
      {!eor.applied && eor.eventTables.length > 0 && <EventPicker props={props} act={act} busy={busy} />}
      {eor.trades.length > 0 && (
        <section className="glass rounded-xl border border-border shadow-panel p-4 text-sm">
          <h3 className="font-medium">Trades</h3>
          <p className="text-xs text-muted">Accepted trades go through last, if both sides still have what they offered.</p>
          <ul className="mt-2 space-y-1">
            {eor.trades.map((t, i) => (
              <li key={i} className={t.ok ? "" : "text-danger"}>
                {t.ok ? "⇄ " : "✕ "}
                {t.summary}
                {!t.ok && ` Fails: ${t.problems.join(" ")}`}
              </li>
            ))}
          </ul>
        </section>
      )}
      {eor.teams.map((t) => (
        <section key={t.teamId} className="glass rounded-xl border border-border shadow-panel p-4">
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
            <p key={i} className="mt-1 text-sm text-warn">
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
        <section className="glass rounded-xl border border-border shadow-panel p-4 text-sm">
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

/** Which teams roll on the random-event table this round. */
function EventPicker({ props, act, busy }: { props: Props; act: (fn: () => Promise<Result>) => void; busy: boolean }) {
  const eor = props.endOfRound!;
  const [tableId, setTableId] = useState(eor.events?.tableId ?? eor.eventTables[0].id);
  const [teamIds, setTeamIds] = useState<string[]>(eor.events?.teamIds ?? []);
  const all = eor.teams.map((t) => t.teamId);
  return (
    <section className="glass rounded-xl border border-border shadow-panel p-4 text-sm">
      <h3 className="font-medium">Random events</h3>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1">
          Table
          <select className="rounded-md border border-border bg-background px-2 py-1" value={tableId} onChange={(e) => setTableId(e.target.value)}>
            {eor.eventTables.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        {eor.teams.map((t) => (
          <label key={t.teamId} className="flex items-center gap-1">
            <input type="checkbox" checked={teamIds.includes(t.teamId)} onChange={(e) => setTeamIds(e.target.checked ? [...teamIds, t.teamId] : teamIds.filter((x) => x !== t.teamId))} />
            {t.teamName}
          </label>
        ))}
        <button type="button" className={btn} onClick={() => setTeamIds(teamIds.length === all.length ? [] : all)}>
          {teamIds.length === all.length ? "None" : "All"}
        </button>
        <button type="button" className={primary} disabled={busy} onClick={() => act(() => computeEndAction(props.gameId, false, teamIds.length ? { tableId, teamIds } : null))}>
          {teamIds.length ? `Roll events for ${teamIds.length} team${teamIds.length === 1 ? "" : "s"}` : "No events this round"}
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">
        {eor.events?.teamIds.length ? `Rolled this round for ${eor.events.teamIds.length} team${eor.events.teamIds.length === 1 ? "" : "s"}: see each team below.` : "No events rolled yet this round."}
      </p>
    </section>
  );
}
