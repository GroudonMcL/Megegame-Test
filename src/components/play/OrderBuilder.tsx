"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveOrdersAction } from "@/app/play/actions";
import { milesPerRound, modeMultiplier, type MoveMode } from "@/engine/orders/movement";
import { parsePath, traceRoute, type PathStep } from "@/engine/orders/route";
import { routeMapFromView } from "@/engine/orders/routeMap";
import { allowedKinds, UNKNOWN_REGION, validateOrders, type OrderCheck, type OrderDraft, type OrderKind } from "@/engine/orders/validate";
import { ABILITIES, ABILITY_NAMES } from "@/engine/ruleset/common";
import { creatureCosts, unitTags } from "@/engine/ruleset/derive";
import { fmtRes } from "@/engine/ruleset/effects";
import type { Ruleset } from "@/engine/ruleset/ruleset";
import type { TeamView } from "@/engine/world/teamView";
import { ACTIVE_STATUSES } from "@/engine/world/types";
import { EconomyTable } from "./EconomyTable";
import { unitLabel } from "./RegionDetails";
import { regionTitle } from "./format";
import { TeamMap } from "./TeamMap";

// The player's order list: numbered actions, free actions and conditional
// backups, checked live with the same engine code the server uses.

type ActionType = Ruleset["actionTypes"][number];
type Input = ActionType["inputs"][number];

const field = "w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm";
const KIND_LABEL: Record<OrderKind, string> = { numbered: "Numbered action", free: "Free action", conditional: "Backup: only if the action above fails" };

export interface OrderBuilderProps {
  view: TeamView;
  rules: Ruleset;
  mapImage: { width: number; height: number; url: string } | null;
  initialOrders: OrderDraft[];
  version: number;
  submitted: { at: string; by: string } | null;
  open: { open: boolean; reason: string };
  isDm: boolean;
  roundNumber: number | null;
  /** A new order to add, from a quick action on the map (see QuickOrders). */
  prefill?: OrderPrefill | null;
}

export interface OrderPrefill {
  /** Different for every press, so the same quick action can be used twice. */
  key: string;
  /** The new order's ID (made on the server, so server and browser render the same). */
  id: string;
  actionTypeId: string;
  unitId?: string;
  regionId?: string;
  targetId?: string;
}

/** The order a quick action asks for, with its unit, region or target filled in. */
function prefillOrder(rules: Ruleset, p: OrderPrefill, slotsFree: boolean): OrderDraft | null {
  const action = rules.actionTypes.find((a) => a.id === p.actionTypeId);
  if (!action) return null;
  const kinds = allowedKinds(action.kind);
  const inputs: Record<string, unknown> = {};
  action.inputs.forEach((input, i) => {
    if (input.type === "unit" && p.unitId) inputs[String(i)] = input.multiple ? [p.unitId] : p.unitId;
    if (input.type === "region" && p.regionId) inputs[String(i)] = p.regionId;
    if (input.type === "targetUnit" && p.targetId) inputs[String(i)] = p.targetId;
  });
  return { id: p.id, kind: kinds.includes("numbered") && slotsFree ? "numbered" : kinds[0], actionTypeId: action.id, inputs, notes: "" };
}

function newId() {
  return crypto.randomUUID();
}

export function OrderBuilder(props: OrderBuilderProps) {
  const { view, rules } = props;
  const router = useRouter();
  const [orders, setOrders] = useState<OrderDraft[]>(props.initialOrders);
  const [version, setVersion] = useState(props.version);
  const [submitted, setSubmitted] = useState(props.submitted);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [adding, setAdding] = useState("");
  const [picking, setPicking] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [bypass, setBypass] = useState(false);
  const [pending, startTransition] = useTransition();
  const editable = props.open.open || props.isDm;

  // When the server has a newer version than ours (a teammate saved), take theirs.
  const [seenVersion, setSeenVersion] = useState(props.version);
  if (props.version !== seenVersion) {
    setSeenVersion(props.version);
    if (props.version !== version) {
      setOrders(props.initialOrders);
      setVersion(props.version);
      setSubmitted(props.submitted);
      setDirty(false);
    }
  }

  const check = useMemo(() => validateOrders(rules, view, orders), [rules, view, orders]);
  const byId = new Map(check.orders.map((c) => [c.id, c]));

  // A quick action from the map: add its order to the list (keeping any unsaved
  // changes), and for a move, go straight to picking the path.
  const [seenPrefill, setSeenPrefill] = useState<string | null>(null);
  const [scrollTo, setScrollTo] = useState<string | null>(null);
  if (props.prefill && props.prefill.key !== seenPrefill) {
    setSeenPrefill(props.prefill.key);
    const order = editable && !orders.some((o) => o.id === props.prefill!.id) ? prefillOrder(rules, props.prefill, check.slotsUsed < check.slotsTotal) : null;
    if (order) {
      setOrders([...orders, order]);
      setDirty(true);
      setMessage({ ok: true, text: `Added ${rules.actionTypes.find((a) => a.id === order.actionTypeId)?.name ?? "an order"}. Finish it below, then save or submit.` });
      setScrollTo(order.id);
      if (rules.actionTypes.find((a) => a.id === order.actionTypeId)?.handler === "move") setPicking(order.id);
    }
  }
  useEffect(() => {
    if (!props.prefill) return;
    // Drop the quick action from the address, so a reload doesn't add it again.
    router.replace("/play/orders", { scroll: false });
  }, [props.prefill, router]);
  useEffect(() => {
    if (scrollTo) document.querySelector(`[data-order-id="${scrollTo}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [scrollTo]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const change = (next: OrderDraft[]) => {
    setOrders(next);
    setDirty(true);
    setMessage(null);
  };
  const update = (id: string, patch: Partial<OrderDraft>) => change(orders.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  const setInput = (id: string, index: number, value: unknown) => {
    const o = orders.find((x) => x.id === id)!;
    update(id, { inputs: { ...o.inputs, [String(index)]: value } });
  };
  const move = (id: string, delta: number) => {
    const i = orders.findIndex((o) => o.id === id);
    const j = i + delta;
    if (j < 0 || j >= orders.length) return;
    const next = [...orders];
    [next[i], next[j]] = [next[j], next[i]];
    change(next);
  };
  const moveTo = (id: string, beforeId: string) => {
    if (id === beforeId) return;
    const item = orders.find((o) => o.id === id)!;
    const rest = orders.filter((o) => o.id !== id);
    const at = rest.findIndex((o) => o.id === beforeId);
    rest.splice(at, 0, item);
    change(rest);
  };
  const add = () => {
    const action = rules.actionTypes.find((a) => a.id === adding);
    if (!action) return;
    const kinds = allowedKinds(action.kind);
    const kind = kinds.includes("numbered") && check.slotsUsed < check.slotsTotal ? "numbered" : kinds[0];
    change([...orders, { id: newId(), kind, actionTypeId: action.id, inputs: {}, notes: "" }]);
    setAdding("");
  };

  const save = (submit: boolean) =>
    startTransition(async () => {
      const r = await saveOrdersAction({ orders, baseVersion: version, submit, bypass });
      if (!r.ok) {
        setMessage({ ok: false, text: r.error });
        return;
      }
      setVersion(r.value.version);
      setDirty(false);
      setSubmitted(r.value.submitted ? { at: new Date().toISOString(), by: props.isDm ? "DM" : "you" } : null);
      setMessage({ ok: true, text: r.value.submitted ? "Orders submitted. You can still change them until the deadline; you'll need to submit again." : "Draft saved. Remember to submit before the deadline." });
      router.refresh();
    });

  const numbered = rules.actionTypes.filter((a) => a.kind === "numbered" || a.kind === "numberedAndFree");
  const free = rules.actionTypes.filter((a) => a.kind === "free");
  const conditionalOnly = rules.actionTypes.filter((a) => a.kind === "conditional");

  return (
    <div className="grid gap-4 @3xl:grid-cols-[1fr_24rem] [&>*]:min-w-0">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{props.roundNumber ? `Round ${props.roundNumber}` : "No round open"}</span>
          <span className={check.slotsUsed > check.slotsTotal ? "text-danger" : "text-muted"}>
            · {check.slotsUsed}/{check.slotsTotal} numbered
          </span>
          <span className={check.conditionalsUsed > check.conditionalLimit ? "text-danger" : "text-muted"}>
            · {check.conditionalsUsed}/{check.conditionalLimit} backups
          </span>
          <span className="ml-auto">
            {submitted && !dirty ? <span className="text-ok">✓ Submitted by {submitted.by}</span> : orders.length ? <span className="text-danger">Not submitted</span> : null}
            {dirty && <span className="ml-2 text-muted">· unsaved changes</span>}
          </span>
        </div>
        {!props.open.open && <p className="rounded-lg border border-border bg-card p-3 text-sm">{props.open.reason}{props.isDm ? " As the DM you can still edit them." : ""}</p>}

        {orders.length === 0 && <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted">No orders yet. Add your first action below.</p>}

        <ol className="space-y-3">
          {orders.map((o, i) => {
            const c = byId.get(o.id)!;
            const action = rules.actionTypes.find((a) => a.id === o.actionTypeId);
            return (
              <li
                key={o.id}
                data-order-id={o.id}
                draggable={editable}
                onDragStart={() => setDragId(o.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragId) moveTo(dragId, o.id);
                  setDragId(null);
                }}
                className={o.kind === "conditional" ? "ml-6 border-l-2 border-dashed border-border pl-3" : ""}
              >
                <OrderCard
                  order={o}
                  index={i}
                  count={orders.length}
                  check={c}
                  action={action}
                  props={props}
                  editable={editable}
                  orders={orders}
                  picking={picking === o.id}
                  onPick={(on) => setPicking(on ? o.id : null)}
                  onKind={(kind) => update(o.id, { kind })}
                  onInput={(index, v) => setInput(o.id, index, v)}
                  onNotes={(notes) => update(o.id, { notes })}
                  onMove={(d) => move(o.id, d)}
                  onRemove={() => change(orders.filter((x) => x.id !== o.id))}
                />
              </li>
            );
          })}
        </ol>

        {editable && (
          <div className="flex flex-wrap gap-2 glass rounded-xl border border-border shadow-panel p-3">
            <select className={`${field} flex-1`} value={adding} onChange={(e) => setAdding(e.target.value)} aria-label="Action to add">
              <option value="">Add an action…</option>
              <optgroup label="Numbered actions">
                {numbered.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.icon} {a.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Free actions">
                {free.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.icon} {a.name}
                  </option>
                ))}
              </optgroup>
              {conditionalOnly.length > 0 && (
                <optgroup label="Backup only">
                  {conditionalOnly.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.icon} {a.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <button type="button" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50" disabled={!adding} onClick={add}>
              Add
            </button>
          </div>
        )}

        {editable && (
          <div className="sticky bottom-2 z-10 flex flex-wrap items-center gap-2 glass rounded-xl border border-border p-3 shadow-lg">
            <button type="button" className="rounded-lg border border-border px-4 py-2 text-sm font-medium disabled:opacity-50" disabled={pending} onClick={() => save(false)}>
              Save draft
            </button>
            <button
              type="button"
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground disabled:opacity-50"
              disabled={pending || (!check.ok && !(props.isDm && bypass))}
              onClick={() => save(true)}
              title={check.ok ? "" : "Fix the problems marked in red first"}
            >
              Submit orders
            </button>
            {props.isDm && (
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" checked={bypass} onChange={(e) => setBypass(e.target.checked)} /> Bypass checks (DM)
              </label>
            )}
            {!check.ok && <span className="text-sm text-danger">Some orders have problems.</span>}
            {pending && <span className="text-sm text-muted">Saving…</span>}
            {message && (
              <span role="status" className={`w-full text-sm ${message.ok ? "text-ok" : "text-danger"}`}>
                {message.text}
              </span>
            )}
          </div>
        )}
      </div>

      <aside className="space-y-3 @3xl:sticky @3xl:top-4 @3xl:self-start">
        <div className="glass rounded-xl border border-border shadow-panel p-3">
          <h2 className="font-medium">Projection</h2>
          <div className="mt-2">
            <EconomyTable economy={check.economy} resources={rules.resources} />
          </div>
        </div>
        <div className="glass rounded-xl border border-border shadow-panel p-3 text-sm">
          <h2 className="font-medium">Movement left</h2>
          {check.movement.length === 0 && <p className="mt-1 text-muted">No units on the map.</p>}
          <ul className="mt-1 space-y-1">
            {check.movement.map((m) => (
              <li key={m.unitId} className="flex items-center gap-2">
                <span className="flex-1 truncate">{m.name}</span>
                <span className="h-2 w-20 overflow-hidden rounded bg-background">
                  <span className="block h-full bg-accent" style={{ width: `${Math.round((1 - m.used) * 100)}%` }} />
                </span>
                <span className="w-16 text-right tabular-nums text-muted">{Math.floor(m.milesLeft)} mi</span>
              </li>
            ))}
          </ul>
        </div>
        {check.freeUses.length > 0 && (
          <div className="glass rounded-xl border border-border shadow-panel p-3 text-sm">
            <h2 className="font-medium">Free actions</h2>
            <ul className="mt-1 space-y-0.5">
              {check.freeUses.map((f) => (
                <li key={f.actionTypeId} className={f.available !== null && f.used > f.available ? "text-danger" : ""}>
                  {f.name}: {f.used} used{f.available !== null ? ` of ${f.available}` : ""}
                </li>
              ))}
            </ul>
            {rules.settings.freeActionsPerUnit !== null && <p className="mt-1 text-xs text-muted">Each unit can take {rules.settings.freeActionsPerUnit} free action{rules.settings.freeActionsPerUnit === 1 ? "" : "s"} per round.</p>}
          </div>
        )}
      </aside>
    </div>
  );
}

function OrderCard(p: {
  order: OrderDraft;
  index: number;
  count: number;
  check: OrderCheck;
  action: ActionType | undefined;
  props: OrderBuilderProps;
  editable: boolean;
  orders: OrderDraft[];
  picking: boolean;
  onPick: (on: boolean) => void;
  onKind: (k: OrderKind) => void;
  onInput: (index: number, value: unknown) => void;
  onNotes: (s: string) => void;
  onMove: (delta: number) => void;
  onRemove: () => void;
}) {
  const { order: o, check: c, action, editable } = p;
  const { rules } = p.props;
  const heading = o.kind === "numbered" ? `Action ${c.slot}` : o.kind === "free" ? "Free" : "Backup";
  const bad = c.problems.length > 0;
  return (
    <div className={`rounded-xl border bg-card p-3 ${bad ? "border-danger" : "border-border"}`}>
      <div className="flex flex-wrap items-center gap-2">
        {editable && (
          <span className="cursor-grab select-none text-muted" title="Drag to reorder" aria-hidden>
            ⠿
          </span>
        )}
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${o.kind === "numbered" ? "bg-accent text-accent-foreground" : "border border-border"}`}>{heading}</span>
        <strong className="text-sm">
          {action?.icon} {action?.name ?? o.actionTypeId}
        </strong>
        {action && allowedKinds(action.kind).length > 1 && (
          <select className="rounded-md border border-border bg-background px-1 py-0.5 text-xs" value={o.kind} disabled={!editable} onChange={(e) => p.onKind(e.target.value as OrderKind)} aria-label="Use as">
            {allowedKinds(action.kind).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        )}
        {editable && (
          <span className="ml-auto flex gap-1">
            <button type="button" className="rounded border border-border px-2 text-sm disabled:opacity-30" disabled={p.index === 0} onClick={() => p.onMove(-1)} aria-label="Move up">
              ↑
            </button>
            <button type="button" className="rounded border border-border px-2 text-sm disabled:opacity-30" disabled={p.index === p.count - 1} onClick={() => p.onMove(1)} aria-label="Move down">
              ↓
            </button>
            <button type="button" className="rounded border border-border px-2 text-sm text-danger" onClick={p.onRemove} aria-label="Remove order">
              ✕
            </button>
          </span>
        )}
      </div>
      {action?.description && (
        <details className="mt-1">
          <summary className="cursor-pointer text-xs text-muted">How it works</summary>
          <p className="mt-1 text-xs">{action.description}</p>
        </details>
      )}

      {action && (
        <div className="mt-2 grid gap-2 @xl:grid-cols-2">
          {action.inputs.map((inp, i) => (
            <InputField key={i} input={inp} index={i} p={p} />
          ))}
        </div>
      )}

      <label className="mt-2 block">
        <span className="text-xs text-muted">Flavour and notes for the DM</span>
        <textarea className={`${field} mt-0.5`} rows={2} maxLength={5000} value={o.notes} disabled={!editable} onChange={(e) => p.onNotes(e.target.value)} placeholder="What does this look like? Anything the DM should know?" />
      </label>

      <div className="mt-2 space-y-0.5 text-sm">
        {(Object.keys(c.cost).length > 0 || Object.keys(c.gain).length > 0) && (
          <p className="text-muted">
            {Object.values(c.cost).some((v) => v) && <>Costs {fmtRes(c.cost, rules.resources)}</>}
            {Object.values(c.gain).some((v) => v) && <> · Gains {fmtRes(c.gain, rules.resources)}</>}
            {o.kind === "conditional" && " (only if it happens)"}
          </p>
        )}
        {c.problems.map((x, i) => (
          <p key={i} className="text-danger">
            ✕ {x}
          </p>
        ))}
        {c.notes.map((x, i) => (
          <p key={i} className="text-muted">
            ⓘ {x}
          </p>
        ))}
      </div>
    </div>
  );
}

function InputField({ input, index, p }: { input: Input; index: number; p: Parameters<typeof OrderCard>[0] }) {
  const { view, rules } = p.props;
  const value = p.order.inputs[String(index)];
  const set = (v: unknown) => p.onInput(index, v);
  const disabled = !p.editable;
  const action = p.action!;
  const inputOf = (type: string) => {
    const i = action.inputs.findIndex((x) => x.type === type);
    return i < 0 ? undefined : p.order.inputs[String(i)];
  };
  const units = view.ownUnits.filter((u) => ACTIVE_STATUSES.has(u.status) && u.regionId);
  const regionName = (id: string | null) => {
    const r = view.regions.find((x) => x.id === id);
    return r ? regionTitle(r) : "?";
  };
  const label = <span className="text-xs text-muted">{input.label}</span>;
  const select = (options: { value: string; label: string }[], placeholder = "Choose…") => (
    <label className="block">
      {label}
      <select className={field} value={typeof value === "string" ? value : ""} disabled={disabled} onChange={(e) => set(e.target.value || undefined)}>
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  switch (input.type) {
    case "unit": {
      const eligible = input.tag ? units.filter((u) => {
        const c = rules.creatures.find((x) => x.id === u.creatureId);
        return c && unitTags(rules, c, u.archetypeId).includes(input.tag!);
      }) : units;
      const opt = (u: (typeof units)[number]) => `${unitLabel(rules, u)} · ${regionName(u.regionId)}`;
      if (!input.multiple) return select(eligible.map((u) => ({ value: u.id, label: opt(u) })), eligible.length ? "Choose a unit…" : "No eligible units");
      const chosen = new Set(Array.isArray(value) ? (value as string[]) : []);
      return (
        <fieldset className="@xl:col-span-2">
          {label}
          {eligible.length === 0 && <p className="text-sm text-muted">No eligible units.</p>}
          <div className="mt-0.5 flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded-md border border-border p-1.5">
            {eligible.map((u) => (
              <label key={u.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={chosen.has(u.id)}
                  onChange={(e) => {
                    const next = new Set(chosen);
                    if (e.target.checked) next.add(u.id);
                    else next.delete(u.id);
                    set([...next]);
                  }}
                />
                {opt(u)}
              </label>
            ))}
          </div>
        </fieldset>
      );
    }
    case "region": {
      const regions = view.regions.filter((r) => r.state === "visible").sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
      return select(regions.map((r) => ({ value: r.id, label: `${regionTitle(r)}${r.ownerTeamId === view.team.id ? " (yours)" : ""}` })));
    }
    case "path":
      return <PathField index={index} p={p} />;
    case "targetUnit": {
      const raw = inputOf("unit");
      const actingIds = Array.isArray(raw) ? raw : typeof raw === "string" ? [raw] : [];
      const acting = units.find((u) => actingIds.includes(u.id));
      const where = acting?.regionId ?? null;
      const list = view.otherUnits.filter((u) => !u.dead && (!where || u.regionId === where) && (!input.monstersOnly || u.ownerTeamId === null));
      const owner = (id: string | null) => (id ? (view.teams.find((t) => t.id === id)?.name ?? "another faction") : "wild");
      return select(
        list.map((u) => ({ value: u.id, label: `${u.creatureName} (${owner(u.ownerTeamId)}) · ${regionName(u.regionId)}` })),
        list.length ? "Choose a target…" : acting ? "Nothing to target in that region" : "Choose your units first…",
      );
    }
    case "creature": {
      const list = rules.creatures.filter((c) => c.recruitable);
      return select(list.map((c) => ({ value: c.id, label: `${c.statBlock.name} (${c.category}) · ${fmtRes(creatureCosts(c, rules).cost, rules.resources)}` })));
    }
    case "race": {
      const ids = [...new Set([...(view.team.baseRaceId ? [view.team.baseRaceId] : []), ...view.team.raceIds])];
      const races = ids.map((id) => rules.races.find((r) => r.id === id)).filter((r): r is NonNullable<typeof r> => Boolean(r));
      if (!races.length) return <p className="text-xs text-muted">{input.label}: your faction has no races set yet.</p>;
      return select(races.map((r) => ({ value: r.id, label: r.name })));
    }
    case "archetype": {
      const creature = rules.creatures.find((c) => c.id === inputOf("creature"));
      const list = rules.archetypes.filter((a) => !creature || a.categories.includes(creature.category));
      return select(
        list.map((a) => ({ value: a.id, label: `${a.name}${Object.keys(a.extraCost).length ? ` (+${fmtRes(a.extraCost, rules.resources)})` : ""}` })),
        creature ? "Choose an archetype…" : "Choose a unit type first…",
      );
    }
    case "spell":
      return select(rules.spells.filter((s) => s.when === "outOfCombat").map((s) => ({ value: s.id, label: s.name })));
    case "building": {
      const regionId = typeof inputOf("region") === "string" ? (inputOf("region") as string) : null;
      const region = view.regions.find((r) => r.id === regionId);
      const existing = ["upgradeBuilding", "demolish"].includes(action.handler);
      const list = existing
        ? (region?.buildings ?? []).map((b) => rules.buildings.find((x) => x.id === b.buildingId)).filter((b): b is NonNullable<typeof b> => Boolean(b))
        : rules.buildings;
      return select(
        list.map((b) => ({ value: b.id, label: existing ? b.name : `${b.name} · ${fmtRes(b.tiers[0].cost, rules.resources)}` })),
        existing && !region ? "Choose the region first…" : "Choose a building…",
      );
    }
    case "settlementTier":
      return select(rules.settlementTiers.map((t) => ({ value: t.id, label: t.name })));
    case "item": {
      const owned = Object.entries(view.inventory).filter(([, q]) => q > 0);
      const augmentsOnly = action.handler === "applyAugment";
      const list = owned
        .map(([id, q]) => ({ item: rules.items.find((x) => x.id === id), q, id }))
        .filter((x) => !augmentsOnly || x.item?.slotId);
      return select(list.map((x) => ({ value: x.id, label: `${x.item?.name ?? x.id} (×${x.q})` })), list.length ? "Choose an item…" : "Nothing suitable in your inventory");
    }
    case "recipe":
      return select(
        rules.recipes.map((r) => ({ value: r.id, label: r.outputs.map((o) => rules.items.find((x) => x.id === o.itemId)?.name ?? o.itemId).join(" + ") })),
        rules.recipes.length ? "Choose a recipe…" : "You don't know any recipes",
      );
    case "team":
      return select(view.teams.map((t) => ({ value: t.id, label: t.name })), view.teams.length ? "Choose a faction…" : "You haven't met anyone yet");
    case "ability":
      return select(ABILITIES.map((a) => ({ value: a, label: ABILITY_NAMES[a] })));
    case "choice":
      return select(input.options.map((o) => ({ value: o, label: o })));
    case "number":
      return (
        <label className="block">
          {label}
          <input type="number" className={field} min={input.min} value={typeof value === "number" ? value : ""} disabled={disabled} onChange={(e) => set(e.target.value === "" ? undefined : Number(e.target.value))} />
        </label>
      );
    case "resources": {
      const amounts = (value && typeof value === "object" ? value : {}) as Record<string, number>;
      return (
        <fieldset className="@xl:col-span-2">
          {label}
          <div className="mt-0.5 flex flex-wrap gap-2">
            {rules.resources
              .filter((r) => r.kind === "stockpile")
              .map((r) => (
                <label key={r.id} className="flex items-center gap-1 text-sm">
                  {r.icon} {r.name}
                  <input
                    type="number"
                    min={0}
                    className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm"
                    value={amounts[r.id] ?? ""}
                    disabled={disabled}
                    onChange={(e) => {
                      const next = { ...amounts };
                      if (e.target.value === "" || Number(e.target.value) === 0) delete next[r.id];
                      else next[r.id] = Number(e.target.value);
                      set(next);
                    }}
                  />
                </label>
              ))}
          </div>
        </fieldset>
      );
    }
    case "text":
      return (
        <label className="block @xl:col-span-2">
          {label}
          <textarea className={field} rows={2} maxLength={2000} value={typeof value === "string" ? value : ""} disabled={disabled} onChange={(e) => set(e.target.value)} />
        </label>
      );
  }
}

function PathField({ index, p }: { index: number; p: Parameters<typeof OrderCard>[0] }) {
  const { view, rules, mapImage } = p.props;
  const action = p.action!;
  const steps = parsePath(p.order.inputs[String(index)]);
  const unitIndex = action.inputs.findIndex((x) => x.type === "unit");
  const unitIds = unitIndex < 0 ? [] : ([] as string[]).concat((p.order.inputs[String(unitIndex)] as string[] | string | undefined) ?? []);
  const mode = (["normal", "forceMarch", "stealth"].includes(action.config.mode as string) ? action.config.mode : "normal") as MoveMode;
  const routeMap = useMemo(() => routeMapFromView(view), [view]);

  // Where the units stand and how much movement they've used before this order.
  const position = p.orders.findIndex((o) => o.id === p.order.id);
  const before = useMemo(() => validateOrders(rules, view, p.orders.slice(0, position)).units, [rules, view, p.orders, position]);
  const first = unitIds.length ? before[unitIds[0]] : undefined;
  const startAt = first?.at ?? null;
  const startRegion = first?.regionId && first.regionId !== UNKNOWN_REGION ? first.regionId : null;
  const group = unitIds
    .map((id) => view.ownUnits.find((u) => u.id === id))
    .filter((u): u is NonNullable<typeof u> => Boolean(u))
    .map((u) => ({ unit: u, used: before[u.id]?.used ?? 1 }));
  const route = startAt && startRegion && group.length ? traceRoute(rules, routeMap, startAt, startRegion, steps, group, mode) : null;

  // The line to draw: from the start through each stop (a link jumps to the far region's centre).
  const line: [number, number][] = startAt ? [startAt] : [];
  let region = startRegion;
  for (const st of steps) {
    if (Array.isArray(st)) line.push(st);
    else {
      const c = view.connections.find((x) => x.id === st.link);
      const to = c && region ? (c.regionA === region ? c.regionB : c.regionA) : null;
      const dest = to ? view.regions.find((r) => r.id === to) : undefined;
      if (dest) {
        line.push([dest.x, dest.y]);
        region = dest.id;
      }
    }
  }
  const endRegion = route?.endRegion ?? null;
  const links = endRegion ? view.connections.filter((c) => c.kind === "link" && !c.blocked && (c.regionA === endRegion || c.regionB === endRegion)) : [];
  const code = (id: string | null) => (id ? (view.regions.find((r) => r.id === id)?.code ?? "?") : "?");
  const left = route
    ? Math.min(...group.map((g, i) => Math.max(0, (1 - route.used[i]) * milesPerRound(rules, g.unit) * modeMultiplier(rules, mode))))
    : 0;
  const set = (next: PathStep[]) => p.onInput(index, next);

  return (
    <div className="@xl:col-span-2">
      <span className="text-xs text-muted">{p.action!.inputs[index].label}</span>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">
          {!startAt || !startRegion
            ? "Choose the units first"
            : steps.length === 0
              ? `From ${code(startRegion)}: no stops yet`
              : `${code(startRegion)} → ${route?.unknown ? "unknown ground" : code(endRegion)} · ${steps.length} stop${steps.length === 1 ? "" : "s"} · ${Math.round(Math.max(0, ...(route?.miles ?? [0])))} mi, ${Math.floor(left)} left`}
        </span>
        {p.editable && startAt && startRegion && (
          <>
            <button type="button" className="rounded border border-border px-2 py-0.5" onClick={() => p.onPick(!p.picking)}>
              {p.picking ? "Done" : steps.length ? "Change route on map" : "Draw route on map"}
            </button>
            {steps.length > 0 && (
              <>
                <button type="button" className="rounded border border-border px-2 py-0.5" onClick={() => set(steps.slice(0, -1))}>
                  Undo stop
                </button>
                <button type="button" className="rounded border border-border px-2 py-0.5" onClick={() => set([])}>
                  Clear
                </button>
              </>
            )}
          </>
        )}
      </div>
      {p.picking && startAt && startRegion && (
        <div className="mt-2">
          <p className="mb-1 text-xs text-muted">
            Tap the map to add a stop; your units walk in straight lines from stop to stop. You can go into ground you can&apos;t see: they go as far as they can.
          </p>
          {links.length > 0 && (
            <div className="mb-1 flex flex-wrap gap-1.5 text-xs">
              {links.map((c) => (
                <button key={c.id} type="button" className="rounded border border-border px-2 py-0.5" onClick={() => set([...steps, { link: c.id }])}>
                  Take the way to {code(c.regionA === endRegion ? c.regionB : c.regionA)}
                </button>
              ))}
            </div>
          )}
          <TeamMap
            view={view}
            rules={rules}
            mapImage={mapImage}
            selectedId={endRegion}
            path={line}
            onPointClick={([x, y]) => set([...steps, [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4]])}
            className="h-[50vh]"
          />
        </div>
      )}
    </div>
  );
}
