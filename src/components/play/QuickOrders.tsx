"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui";
import { validateOrders } from "@/engine/orders/validate";
import type { Ruleset } from "@/engine/ruleset/ruleset";
import type { TeamView } from "@/engine/world/teamView";
import { ACTIVE_STATUSES } from "@/engine/world/types";
import { newOrder } from "./movePlan";
import { useOrdersDraft } from "./ordersDraft";
import { quickActions, type QuickTarget } from "./quickActions";

// Orders that can start from what's selected on the map. Each one adds a new
// order with the unit, region or target filled in, and opens the Orders window
// on it to finish there; the order is checked there and again on the server.

/** Can this thing be given orders at all right now? */
function usable(target: QuickTarget) {
  if (target.kind === "unit") return ACTIVE_STATUSES.has(target.unit.status) && !!target.unit.regionId;
  if (target.kind === "other") return !target.unit.dead;
  return target.region.state === "visible";
}

export function QuickOrders({ rules, view, target, open }: { rules: Ruleset; view: TeamView; target: QuickTarget; open: { open: boolean; reason: string } }) {
  const router = useRouter();
  const draft = useOrdersDraft();
  const [other, setOther] = useState("");
  if (!usable(target)) return null;
  const actions = quickActions(rules, target);
  if (!actions.length) return null;

  const start = (actionId: string) => {
    const action = rules.actionTypes.find((a) => a.id === actionId);
    if (!action) return;
    const check = validateOrders(rules, view, draft.orders);
    const fill = target.kind === "unit" ? { unitIds: [target.unit.id] } : target.kind === "other" ? { targetId: target.unit.id } : { regionId: target.region.id };
    draft.add(newOrder(rules, action, fill, check.slotsUsed < check.slotsTotal, crypto.randomUUID()), { pick: action.handler === "move" });
    router.push("/play/orders");
  };
  // Movement gets its own buttons (up to three); the rest go in a list.
  const buttons = actions.filter((a) => a.handler === "move").slice(0, 3);
  const rest = actions.filter((a) => !buttons.includes(a));

  return (
    <section className="mt-4 border-t border-border pt-3" aria-label="Give an order">
      <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Give an order</h3>
      {!draft.editable && <p className="mt-1 text-xs text-muted">{open.reason}</p>}
      {draft.editable && (
        <div className="mt-2 space-y-2">
          {buttons.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {buttons.map((a) => (
                <button key={a.id} type="button" className={buttonClass("secondary", "px-3! py-1.5! text-xs")} onClick={() => start(a.id)} title={a.description}>
                  {a.name}
                </button>
              ))}
            </div>
          )}
          {rest.length > 0 && (
            <div className="flex gap-1.5">
              <select aria-label="Other orders" className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1.5 text-xs" value={other} onChange={(e) => setOther(e.target.value)}>
                <option value="">{buttons.length ? "Other orders…" : "Choose an order…"}</option>
                {rest.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <button type="button" className={buttonClass("primary", "px-3! py-1.5! text-xs")} disabled={!other} onClick={() => start(other)}>
                Add
              </button>
            </div>
          )}
          <p className="text-xs text-muted">Opens your orders with it filled in, to finish there.</p>
        </div>
      )}
    </section>
  );
}
