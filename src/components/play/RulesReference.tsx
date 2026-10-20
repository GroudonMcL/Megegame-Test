import type { ReactNode } from "react";
import { StatBlockView } from "@/components/StatBlockView";
import { ABILITY_NAMES, formatCr } from "@/engine/ruleset/common";
import { creatureCosts } from "@/engine/ruleset/derive";
import { describeEffect, fmtRes, namesFrom } from "@/engine/ruleset/effects";
import type { Ruleset } from "@/engine/ruleset/ruleset";

// The rules reference, generated from the ruleset itself so it can never
// drift from the data the app uses. Given the player ruleset, it only shows
// what that team is allowed to know.

type Requirement = Ruleset["actionTypes"][number]["requirements"][number];

function describeRequirement(r: Ruleset, req: Requirement): string {
  switch (req.type) {
    case "unitWithTag":
      return `a ${req.tag} unit`;
    case "unitOfCreature":
      return `a ${r.creatures.find((c) => c.id === req.creatureId)?.statBlock.name ?? req.creatureId}`;
    case "buildingInRegion":
      return `a ${r.buildings.find((b) => b.id === req.buildingId)?.name ?? req.buildingId}${req.minTier > 1 ? ` (tier ${req.minTier}+)` : ""} in the region`;
    case "regionOwner":
      return req.owner === "self" ? "a region you own" : req.owner === "unowned" ? "an unowned region" : "a region owned by another faction";
    case "noHostileUnits":
      return "no hostile units in the region";
    case "ownUnitInRegion":
      return "one of your units in the region";
    case "unitHasMovement":
      return "the unit has movement left";
    case "unitStealthed":
      return "the unit is stealthed";
    case "settlementPresent":
      return req.minTierId ? `at least a ${r.settlementTiers.find((t) => t.id === req.minTierId)?.name ?? req.minTierId}` : "a settlement in the region";
    case "freeSlot":
      return "a free building slot";
    case "itemInInventory":
      return req.itemId ? `a ${r.items.find((x) => x.id === req.itemId)?.name ?? req.itemId} in your inventory` : "the item in your inventory";
    case "text":
      return req.text;
  }
}

const KIND_LABEL = { numbered: "Numbered action", free: "Free action", conditional: "Conditional only", numberedAndFree: "Free, or numbered for extra uses" };

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4 glass rounded-xl border border-border shadow-panel p-4 @xl:p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left">
            {head.map((h) => (
              <th key={h} className="px-2 py-1 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/60 align-top">
              {r.map((c, j) => (
                <td key={j} className="px-2 py-1">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RulesReference({ rules, metCreatureIds }: { rules: Ruleset; metCreatureIds: string[] }) {
  const names = namesFrom(rules);
  const res = (a: Record<string, number>) => (Object.keys(a).length ? fmtRes(a, rules.resources) : "–");
  const recruitable = rules.creatures.filter((c) => c.recruitable);
  const met = rules.creatures.filter((c) => !c.recruitable && metCreatureIds.includes(c.id));
  const m = rules.settings.movement;
  const effectList = (effects: Parameters<typeof describeEffect>[0][]) =>
    effects.length ? (
      <ul className="list-inside list-disc">
        {effects.map((e, i) => (
          <li key={i}>{describeEffect(e, names)}</li>
        ))}
      </ul>
    ) : null;

  const sections = [
    ...rules.rulesSections.map((s) => ({ id: `rules-${s.id}`, title: s.title })),
    { id: "turns", title: "Turns" },
    { id: "resources", title: "Resources" },
    { id: "settlements", title: "Settlements" },
    { id: "buildings", title: "Buildings" },
    { id: "actions", title: "Actions" },
    { id: "units", title: "Units" },
    { id: "archetypes", title: "Archetypes" },
    ...(rules.spells.length ? [{ id: "spells", title: "Spells" }] : []),
    ...(rules.races.length ? [{ id: "races", title: "Races" }] : []),
    { id: "items", title: "Items and augments" },
    { id: "movement", title: "Movement and terrain" },
    ...(met.length ? [{ id: "monsters", title: "Monsters you've met" }] : []),
  ];

  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap gap-2 text-sm">
        {sections.map((s) => (
          <a key={s.id} href={`#${s.id}`} className="rounded-md border border-border px-2 py-1 hover:bg-card">
            {s.title}
          </a>
        ))}
      </nav>

      {rules.rulesSections.map((s) => (
        <Section key={s.id} id={`rules-${s.id}`} title={s.title}>
          <div className="whitespace-pre-wrap text-sm">{s.body}</div>
        </Section>
      ))}

      <Section id="turns" title="Turns">
        <ul className="list-inside list-disc text-sm">
          <li>Each round you have {rules.settings.actionSlots} numbered actions. Everyone&apos;s action 1 is resolved first, then everyone&apos;s action 2, and so on.</li>
          <li>Free actions can go anywhere in your list and happen at that point.{rules.settings.freeActionsPerUnit !== null ? ` Each unit can take ${rules.settings.freeActionsPerUnit} free action${rules.settings.freeActionsPerUnit === 1 ? "" : "s"} per round, not counting moves.` : ""}</li>
          <li>Moving is free and limited only by each unit&apos;s movement: a unit can move several times a round while it has miles left. Moves happen between the numbered actions (the ones listed before your action 1 before everyone&apos;s action 1, and so on), all teams&apos; at the same time.</li>
          <li>Up to {rules.settings.conditionalLimit} conditional actions per round. A conditional action goes straight after another action and only happens if that action fails.</li>
          <li>Units can carry up to {rules.settings.maxAugmentsPerUnit} augments.</li>
        </ul>
      </Section>

      <Section id="resources" title="Resources">
        <Table
          head={["Resource", "Kind", "Starting amount"]}
          rows={rules.resources.map((r) => [`${r.icon} ${r.name}`, r.kind === "stockpile" ? "Spendable" : "Accumulates", r.startingAmount])}
        />
      </Section>

      <Section id="settlements" title="Settlements">
        <Table
          head={["Tier", "Cost", "Slots", "Production", "Upkeep", "Notes"]}
          rows={rules.settlementTiers.map((t) => [
            <div key="n">
              <strong>{t.name}</strong>
              {t.description && <p className="text-xs text-muted">{t.description}</p>}
            </div>,
            res(t.cost),
            t.buildingSlots,
            res(t.production),
            res(t.upkeep),
            <ul key="x" className="text-xs">
              {t.upgradesFrom && <li>Upgrades from {rules.settlementTiers.find((x) => x.id === t.upgradesFrom)?.name}</li>}
              {t.maxPerTeam !== null && <li>Max {t.maxPerTeam} per faction</li>}
              {t.ratio.map((x) => (
                <li key={x.tierId}>Needs {x.count} {rules.settlementTiers.find((y) => y.id === x.tierId)?.name ?? x.tierId} each</li>
              ))}
              {t.recruitCategories.length > 0 && <li>Recruits: {t.recruitCategories.join(", ")}</li>}
              {t.heroLimit !== null && <li>{t.heroLimit} hero each</li>}
              {t.discounts.map((d, i) => (
                <li key={i}>{fmtRes(d.amount, rules.resources)} cheaper if a ruin is present</li>
              ))}
              {t.effects.map((e, i) => (
                <li key={`e${i}`}>{describeEffect(e, names)}</li>
              ))}
            </ul>,
          ])}
        />
      </Section>

      <Section id="buildings" title="Buildings">
        <div className="space-y-3">
          {rules.buildings.map((b) => (
            <div key={b.id}>
              <h3 className="font-medium">{b.name}</h3>
              {b.description && <p className="text-sm text-muted">{b.description}</p>}
              <Table
                head={["Tier", "Cost", "Upkeep", "Production", "Effects"]}
                rows={b.tiers.map((t, i) => [i + 1, res(t.cost), res(t.upkeep), res(t.production), <div key="e">{t.description && <p className="text-xs">{t.description}</p>}{effectList(t.effects)}</div>])}
              />
            </div>
          ))}
        </div>
      </Section>

      <Section id="actions" title="Actions">
        <div className="grid gap-3 @2xl:grid-cols-2 [&>*]:min-w-0">
          {rules.actionTypes.map((a) => (
            <div key={a.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-2">
                <strong>
                  {a.icon} {a.name}
                </strong>
                <span className="text-xs text-muted">{KIND_LABEL[a.kind]}</span>
              </div>
              {a.description && <p className="mt-1">{a.description}</p>}
              <ul className="mt-1 text-xs text-muted">
                {Object.keys(a.cost).length > 0 && <li>Cost: {fmtRes(a.cost, rules.resources)}</li>}
                {a.limit.times !== null && <li>Limit: {a.limit.times}× per {a.limit.per === "team" ? "round" : a.limit.per}</li>}
                {a.requirements.length > 0 && <li>Needs: {a.requirements.map((x) => describeRequirement(rules, x)).join("; ")}</li>}
                {a.check && <li>Check: d20 + the best of {a.check.abilities.map((x) => ABILITY_NAMES[x]).join(", ")}</li>}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section id="units" title="Units">
        <p className="mb-3 text-sm text-muted">Every unit uses a full D&amp;D stat block. Pick an archetype when you recruit to give it a role.</p>
        <div className="space-y-2">
          {recruitable.map((c) => {
            const costs = creatureCosts(c, rules);
            return (
              <details key={c.id} className="rounded-lg border border-border p-3">
                <summary className="cursor-pointer text-sm">
                  <strong>{c.statBlock.name}</strong> <span className="text-muted">· {c.category} · CR {formatCr(c.statBlock.cr)} · costs {res(costs.cost)} · upkeep {res(costs.upkeep)}</span>
                </summary>
                <div className="mt-2 space-y-2">
                  {c.effects.length > 0 && <div className="text-sm">{effectList(c.effects)}</div>}
                  <StatBlockView sb={c.statBlock} />
                </div>
              </details>
            );
          })}
        </div>
      </Section>

      <Section id="archetypes" title="Archetypes">
        <div className="grid gap-3 @2xl:grid-cols-2 [&>*]:min-w-0">
          {rules.archetypes.map((a) => (
            <div key={a.id} className="rounded-lg border border-border p-3 text-sm">
              <div className="flex flex-wrap items-baseline gap-2">
                <strong>{a.name}</strong>
                <span className="text-xs text-muted">for {a.categories.join(", ")} units</span>
              </div>
              {a.description && <p className="mt-1">{a.description}</p>}
              <ul className="mt-1 text-xs text-muted">
                {a.tags.length > 0 && <li>Tags: {a.tags.join(", ")}</li>}
                {a.visionRange !== null && <li>Vision: {a.visionRange} region{a.visionRange === 1 ? "" : "s"} away</li>}
                {a.recruitRequiresBuildingId && <li>Recruit where there&apos;s a {rules.buildings.find((b) => b.id === a.recruitRequiresBuildingId)?.name}</li>}
                {Object.keys(a.extraCost).length > 0 && <li>Extra cost: {fmtRes(a.extraCost, rules.resources)}</li>}
                {Object.keys(a.extraUpkeep).length > 0 && <li>Extra upkeep: {fmtRes(a.extraUpkeep, rules.resources)}</li>}
                {a.unlocksActions.length > 0 && <li>Unlocks: {a.unlocksActions.map((x) => names.action?.(x) ?? x).join(", ")}</li>}
              </ul>
              {a.effects.length > 0 && <div className="mt-1">{effectList(a.effects)}</div>}
            </div>
          ))}
        </div>
      </Section>

      {rules.spells.length > 0 && (
        <Section id="spells" title="Spells">
          <Table
            head={["Spell", "Tradition", "Who", "When", "Cost", "Description"]}
            rows={rules.spells.map((s) => [<strong key="n">{s.name}</strong>, s.tradition, s.restriction, s.when === "combat" ? "In combat" : "Out of combat", res(s.cost), s.description])}
          />
        </Section>
      )}

      {rules.races.length > 0 && (
        <Section id="races" title="Races">
          <Table
            head={["Race", "Ability bonuses", "Abilities"]}
            rows={rules.races.map((x) => [
              <div key="n">
                <strong>{x.name}</strong>
                {x.description && <p className="text-xs text-muted">{x.description}</p>}
              </div>,
              Object.entries(x.abilityBonuses)
                .map(([k, v]) => `${k.toUpperCase()} ${v! > 0 ? "+" : ""}${v}`)
                .join(", ") || "–",
              effectList(x.effects),
            ])}
          />
        </Section>
      )}

      <Section id="items" title="Items and augments">
        {rules.augmentSlots.length > 0 && (
          <p className="mb-3 text-sm">
            Augment slots: {rules.augmentSlots.map((s) => `${s.name} (max ${s.maxPerUnit})`).join(", ")}. Up to {rules.settings.maxAugmentsPerUnit} augments per unit.
          </p>
        )}
        <Table
          head={["Item", "Type", "Needs", "Effects"]}
          rows={rules.items.map((it) => [
            <div key="n">
              <strong>{it.name}</strong>
              {it.description && <p className="text-xs text-muted">{it.description}</p>}
            </div>,
            [rules.itemCategories.find((c) => c.id === it.categoryId)?.name, rules.augmentSlots.find((s) => s.id === it.slotId)?.name, it.consumable ? "consumable" : ""].filter(Boolean).join(" · "),
            [...it.requiresUnitTags.map((t) => `${t} unit`), ...it.requiresRaces.map((id) => rules.races.find((x) => x.id === id)?.name ?? id)].join(", ") || "–",
            effectList(it.effects),
          ])}
        />
      </Section>

      <Section id="movement" title="Movement and terrain">
        <ul className="list-inside list-disc text-sm">
          <li>
            A unit with a 30 ft walking speed travels {m.milesPerDayAt30ft} miles a day, and {m.travelDaysPerRound === 1 ? "each round is one day" : `each round is ${m.travelDaysPerRound} days`}. Faster units go further. Flyers use their flying speed if it&apos;s faster.
          </li>
          <li>Paths between regions are {m.defaultConnectionMiles} miles long unless marked otherwise.</li>
          <li>
            Force marching moves ×{m.forceMarchMultiplier} as far, with disadvantage in combat. Moving stealthily moves ×{m.stealthMultiplier} as far.
          </li>
          <li>Movement is a budget for the whole round, shared by every move a unit makes.</li>
        </ul>
        {rules.terrainTypes.length > 0 && (
          <div className="mt-3">
            <Table
              head={["Terrain", "Effect"]}
              rows={rules.terrainTypes.map((t) => [
                t.name,
                [
                  t.costMultiplier !== 1 ? `costs ×${t.costMultiplier} movement` : "",
                  t.bypassedByFlying ? "flyers ignore it" : "",
                  t.bypassedByNaturalExplorer ? "natural explorers (and their group) ignore it" : "",
                  t.requiresMovement.length ? `needs a ${t.requiresMovement.join(" or ")} speed` : "",
                ]
                  .filter(Boolean)
                  .join("; ") || "normal",
              ])}
            />
          </div>
        )}
      </Section>

      {met.length > 0 && (
        <Section id="monsters" title="Monsters you've met">
          <div className="space-y-2">
            {met.map((c) => (
              <details key={c.id} className="rounded-lg border border-border p-3">
                <summary className="cursor-pointer text-sm">
                  <strong>{c.statBlock.name}</strong> <span className="text-muted">· CR {formatCr(c.statBlock.cr)}</span>
                </summary>
                <div className="mt-2">
                  <StatBlockView sb={c.statBlock} />
                </div>
              </details>
            ))}
          </div>
        </Section>
      )}

      {rules.meta.attributions.length > 0 && (
        <footer className="space-y-1 text-xs text-muted">
          {rules.meta.attributions.map((a, i) => (
            <p key={i}>{a}</p>
          ))}
        </footer>
      )}
    </div>
  );
}
