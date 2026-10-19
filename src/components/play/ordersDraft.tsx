"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { saveOrdersAction } from "@/app/play/actions";
import type { OrderDraft } from "@/engine/orders/validate";

// The team's order list for this round, shared by the Orders window and the
// map (dragging units queues moves). It lives in the player shell, so it
// survives opening and closing the Orders window, and unsaved changes made in
// one place show in the other. Saving goes through saveOrdersAction as before;
// a version number stops two teammates overwriting each other.

export interface OrdersServerState {
  /** Changes when a new round starts (the list starts again). */
  roundKey: string;
  orders: OrderDraft[];
  version: number;
  submitted: { at: string; by: string } | null;
  open: { open: boolean; reason: string };
  isDm: boolean;
  roundNumber: number | null;
}

export interface OrdersDraft extends OrdersServerState {
  dirty: boolean;
  /** Can the list be changed now? (The DM viewing as a team always can.) */
  editable: boolean;
  /** Replace the list (marks it unsaved). */
  change: (next: OrderDraft[]) => void;
  /** Add an order; focus = show it in the Orders window (and start picking its route if it's a move). */
  add: (order: OrderDraft, focus?: { pick: boolean }) => void;
  /** Show an order in the Orders window (and start picking its route if pick). */
  reveal: (id: string, pick: boolean) => void;
  /** The Orders window has shown the focused order (so reopening it doesn't again). */
  clearFocus: () => void;
  /** The order the Orders window should scroll to, once. */
  focus: { id: string; pick: boolean; key: number } | null;
  save: (opts: { submit: boolean; bypass?: boolean; orders?: OrderDraft[] }) => Promise<{ ok: boolean; text: string }>;
}

const Ctx = createContext<OrdersDraft | null>(null);

export function useOrdersDraft(): OrdersDraft {
  const v = useContext(Ctx);
  if (!v) throw new Error("useOrdersDraft needs an OrdersDraftProvider (the player shell)");
  return v;
}

export function OrdersDraftProvider({ server, children }: { server: OrdersServerState; children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState({ roundKey: server.roundKey, orders: server.orders, version: server.version, submitted: server.submitted, dirty: false });
  const [seen, setSeen] = useState({ roundKey: server.roundKey, version: server.version });
  const [focus, setFocus] = useState<OrdersDraft["focus"]>(null);

  // A new round starts a new list; a newer version from the server (a teammate saved) replaces ours.
  if (seen.roundKey !== server.roundKey || seen.version !== server.version) {
    setSeen({ roundKey: server.roundKey, version: server.version });
    if (server.roundKey !== state.roundKey || server.version !== state.version) {
      setState({ roundKey: server.roundKey, orders: server.orders, version: server.version, submitted: server.submitted, dirty: false });
    }
  }

  // Warn before leaving the page with unsaved orders.
  useEffect(() => {
    if (!state.dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [state.dirty]);

  const value: OrdersDraft = {
    ...server,
    orders: state.orders,
    version: state.version,
    submitted: state.submitted,
    dirty: state.dirty,
    editable: server.open.open || server.isDm,
    focus,
    change: (next) => setState((s) => ({ ...s, orders: next, dirty: true })),
    add: (order, f) => {
      setState((s) => ({ ...s, orders: [...s.orders, order], dirty: true }));
      if (f) setFocus((old) => ({ id: order.id, pick: f.pick, key: (old?.key ?? 0) + 1 }));
    },
    reveal: (id, pick) => setFocus((old) => ({ id, pick, key: (old?.key ?? 0) + 1 })),
    clearFocus: () => setFocus(null),
    save: async ({ submit, bypass = false, orders }) => {
      const list = orders ?? state.orders;
      const r = await saveOrdersAction({ orders: list, baseVersion: state.version, submit, bypass });
      if (!r.ok) return { ok: false, text: r.error };
      setState((s) => ({
        ...s,
        orders: list,
        version: r.value.version,
        dirty: false,
        submitted: r.value.submitted ? { at: new Date().toISOString(), by: server.isDm ? "DM" : "you" } : null,
      }));
      setSeen((x) => ({ ...x, version: r.value.version }));
      router.refresh();
      return {
        ok: true,
        text: r.value.submitted ? "Orders submitted. You can still change them until the deadline; you'll need to submit again." : "Draft saved. Remember to submit before the deadline.",
      };
    },
  };
  return <Ctx value={value}>{children}</Ctx>;
}
