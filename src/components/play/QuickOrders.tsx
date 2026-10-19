"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui";
import type { Ruleset } from "@/engine/ruleset/ruleset";
import { ACTIVE_STATUSES } from "@/engine/world/types";
import { quickActions, type QuickTarget } from "./quickActions";

// Orders that can start from what's selected on the map. Each one opens the
// Orders window with a new order already filled in (see OrderBuilder's prefill);
// the order is checked there and again on the server, as usual.

/** Counts presses, so each one is a new request and the same order can be added twice. */
let presses = 0;

/** Can this thing be given orders at all right now? */
function usable(target: QuickTarget) {
  if (target.kind === "unit") return ACTIVE_STATUSES.has(target.unit.status) && !!target.unit.regionId;
  if (target.kind === "other") return !target.unit.dead;
  return target.region.state === "visible";
}

export function QuickOrders({ rules, target, open }: { rules: Ruleset; target: QuickTarget; open: { open: boolean; reason: string } }) {
  const router = useRouter();
  const [other, setOther] = useState("");
  if (!usable(target)) return null;
  const actions = quickActions(rules, target);
  if (!actions.length) return null;

  const start = (actionId: string) => {
    const id = target.kind === "region" ? target.region.id : target.unit.id;
    const param = target.kind === "unit" ? "unit" : target.kind === "other" ? "target" : "region";
    router.push(`/play/orders?add=${encodeURIComponent(actionId)}&${param}=${id}&n=${++presses}`);
  };
  // Movement gets its own buttons (up to three); the rest go in a list.
  const buttons = actions.filter((a) => a.handler === "move").slice(0, 3);
  const rest = actions.filter((a) => !buttons.includes(a));

  return (
    <section className="mt-4 border-t border-border pt-3" aria-label="Give an order">
      <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Give an order</h3>
      {!open.open && <p className="mt-1 text-xs text-muted">{open.reason}</p>}
      {open.open && (
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
