import { Card } from "@/components/ui";
import { describeEffect, fmtRes, namesFrom } from "@/engine/ruleset/effects";
import { loadTeamView } from "@/lib/teamView";
import { requireViewer } from "@/lib/viewer";

export default async function InventoryPage() {
  const viewer = await requireViewer();
  const { view, rules, fullRuleset } = await loadTeamView(viewer.gameId, viewer.teamId, { record: !viewer.isDm });
  const names = namesFrom(rules);
  const item = (id: string) => rules.items.find((x) => x.id === id);
  const itemName = (id: string) => item(id)?.name ?? id;
  const owned = Object.entries(view.inventory).filter(([, q]) => q > 0);
  const known = rules.recipes;
  const knownIds = new Set(known.map((r) => r.id));

  const craftable = (rec: (typeof known)[number]) =>
    rec.inputs.every((i) => (view.inventory[i.itemId] ?? 0) >= i.qty) && Object.entries(rec.resources).every(([k, v]) => (view.team.resources[k] ?? 0) >= v);

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <h2 className="text-lg font-medium">Items</h2>
        {owned.length === 0 && <p className="mt-2 text-sm text-muted">Your inventory is empty.</p>}
        <ul className="mt-3 space-y-3">
          {owned.map(([id, qty]) => {
            const it = item(id);
            const category = rules.itemCategories.find((c) => c.id === it?.categoryId);
            const slot = rules.augmentSlots.find((s) => s.id === it?.slotId);
            const into = known.filter((rec) => rec.inputs.some((i) => i.itemId === id));
            const unknown = fullRuleset.recipes.filter((rec) => !knownIds.has(rec.id) && rec.inputs.some((i) => i.itemId === id)).length;
            return (
              <li key={id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <strong>{it?.name ?? id}</strong>
                  <span className="tabular-nums">×{qty}</span>
                  <span className="text-muted">
                    {[category?.name, slot ? `${slot.name} augment` : "", it?.rarity].filter(Boolean).join(" · ")}
                  </span>
                </div>
                {it?.description && <p className="mt-1">{it.description}</p>}
                {it && it.effects.length > 0 && (
                  <ul className="mt-1 list-inside list-disc text-muted">
                    {it.effects.map((e, i) => (
                      <li key={i}>{describeEffect(e, names)}</li>
                    ))}
                  </ul>
                )}
                {it && (it.requiresUnitTags.length > 0 || it.requiresRaces.length > 0) && (
                  <p className="mt-1 text-xs text-muted">
                    Needs: {[...it.requiresUnitTags.map((t) => `${t} unit`), ...it.requiresRaces.map((r) => rules.races.find((x) => x.id === r)?.name ?? r)].join(", ")}
                  </p>
                )}
                <p className="mt-1 text-xs">
                  <span className="font-medium">Can be crafted into: </span>
                  {into.length ? into.map((rec) => rec.outputs.map((o) => itemName(o.itemId)).join(" + ")).join("; ") : <span className="text-muted">nothing you know</span>}
                  {unknown > 0 && <span className="text-muted"> · {unknown} recipe{unknown === 1 ? "" : "s"} you haven&apos;t learned (use Research)</span>}
                </p>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <h2 className="text-lg font-medium">Known recipes</h2>
        {known.length === 0 && <p className="mt-2 text-sm text-muted">You don&apos;t know any recipes yet. Research items to learn some.</p>}
        <ul className="mt-3 space-y-2">
          {known.map((rec) => {
            const ok = craftable(rec);
            return (
              <li key={rec.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-2">
                  <strong>{rec.outputs.map((o) => `${o.qty > 1 ? `${o.qty}× ` : ""}${itemName(o.itemId)}`).join(" + ")}</strong>
                  <span className={`ml-auto text-xs ${ok ? "text-ok" : "text-muted"}`}>{ok ? "✓ can craft now" : "missing materials"}</span>
                </div>
                <p className="mt-1 text-muted">
                  From:{" "}
                  {rec.inputs.map((i) => {
                    const have = view.inventory[i.itemId] ?? 0;
                    return (
                      <span key={i.itemId} className={have < i.qty ? "text-danger" : ""}>
                        {i.qty}× {itemName(i.itemId)} ({have}){" "}
                      </span>
                    );
                  })}
                  {Object.keys(rec.resources).length > 0 && `+ ${fmtRes(rec.resources, rules.resources)}`}
                </p>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
