import { ABILITIES, formatCr, signed } from "@/engine/ruleset/common";
import { attackBonus, damageText, deriveStats, saveDcValue, type Bonus, type Breakdown } from "@/engine/ruleset/derive";
import { describeEffect } from "@/engine/ruleset/effects";
import { SKILL_ABILITY, type StatAction, type StatBlock } from "@/engine/ruleset/statblock";

// Renders a stat block the way D&D prints it, with live numbers from the
// effective stats (race, archetype, academy and equipment bonuses included). Hovering a
// number shows where it came from.

function why(b: Breakdown) {
  return b.parts.map((p) => `${p.label} ${signed(p.value)}`).join(", ");
}

function usesLabel(a: StatAction) {
  switch (a.uses.type) {
    case "atWill":
      return "";
    case "perDay":
      return ` (${a.uses.times}/Day)`;
    case "perCombat":
      return ` (${a.uses.times}/Combat)`;
    case "recharge":
      return a.uses.min === 6 ? " (Recharge 6)" : ` (Recharge ${a.uses.min}–6)`;
  }
}

const REVIEW_BADGE: Record<string, { text: string; className: string; title: string }> = {
  needsReview: { text: "check", className: "border-warn text-warn", title: "Imported automatically — worth checking the combat numbers" },
  text: { text: "text only", className: "border-border text-muted", title: "The combat engine won't automate this; the DM handles it" },
};

function ActionLine({ a, stats }: { a: StatAction; stats: ReturnType<typeof deriveStats> }) {
  const badge = REVIEW_BADGE[a.review];
  const hit = attackBonus(a, stats);
  const p = a.profile;
  let summary = "";
  if (p.kind === "attack" && hit) summary = `${signed(hit.total)} to hit, ${damageText(a, stats)}`;
  if (p.kind === "save") summary = `DC ${saveDcValue(p.dc, stats)} ${p.dc.save.toUpperCase()} save${p.damage.length ? `, ${damageText(a, stats)}` : ""}${p.condition ? `, ${p.condition.condition}` : ""}${p.area ? `, ${p.area.size}-ft ${p.area.shape}` : ""}`;
  return (
    <p className="mt-1.5 text-sm leading-snug">
      <span className="font-semibold italic">
        {a.name}
        {usesLabel(a)}.
      </span>{" "}
      {a.text}
      {(summary || badge) && (
        <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
          {summary && <span className="rounded bg-background px-1.5 py-0.5 font-mono text-[11px]" title="Live numbers, including bonuses">{summary}</span>}
          {badge && (
            <span className={`rounded border px-1.5 py-0.5 text-[11px] ${badge.className}`} title={badge.title}>
              {badge.text}
            </span>
          )}
        </span>
      )}
    </p>
  );
}

export function StatBlockView({ sb, bonuses = [] }: { sb: StatBlock; bonuses?: Bonus[] }) {
  const s = deriveStats(sb, bonuses);
  const speeds = [
    `${s.speed.total} ft.`,
    sb.speed.fly ? `Fly ${sb.speed.fly} ft.${sb.speed.hover ? " (hover)" : ""}` : "",
    sb.speed.swim ? `Swim ${sb.speed.swim} ft.` : "",
    sb.speed.climb ? `Climb ${sb.speed.climb} ft.` : "",
    sb.speed.burrow ? `Burrow ${sb.speed.burrow} ft.` : "",
  ].filter(Boolean);
  const senses = [
    sb.senses.blindsight ? `Blindsight ${sb.senses.blindsight} ft.` : "",
    sb.senses.darkvision ? `Darkvision ${sb.senses.darkvision} ft.` : "",
    sb.senses.tremorsense ? `Tremorsense ${sb.senses.tremorsense} ft.` : "",
    sb.senses.truesight ? `Truesight ${sb.senses.truesight} ft.` : "",
    `Passive Perception ${s.passivePerception.total}`,
  ].filter(Boolean);
  const skills = Object.entries(sb.skills).map(([k, mult]) => {
    const ability = SKILL_ABILITY[k as keyof typeof SKILL_ABILITY];
    return `${k.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase())} ${signed(s.mods[ability] + (mult ?? 0) * s.proficiency)}`;
  });
  const row = (label: string, value: string) =>
    value ? (
      <p className="text-sm">
        <span className="font-semibold">{label}</span> {value}
      </p>
    ) : null;

  return (
    <article className="rounded-lg border-y-4 border-accent bg-card p-4 shadow-sm">
      <h3 className="text-xl font-bold">{sb.name}</h3>
      <p className="text-sm italic text-muted">
        {sb.size[0].toUpperCase() + sb.size.slice(1)} {sb.creatureType}
        {sb.subtypes.length ? ` (${sb.subtypes.join(", ")})` : ""}
        {sb.alignment ? `, ${sb.alignment}` : ""}
      </p>
      <hr className="my-2 border-accent/40" />
      <p className="text-sm" title={why(s.ac)}>
        <span className="font-semibold">AC</span> {s.ac.total}
        {sb.acNote ? ` (${sb.acNote})` : ""}
        <span className="ml-4 font-semibold">Initiative</span> {signed(s.initiative.total)}
      </p>
      <p className="text-sm" title={why(s.maxHp)}>
        <span className="font-semibold">HP</span> {s.maxHp.total}
        {sb.hitDice ? ` (${sb.hitDice})` : ""}
      </p>
      {row("Speed", speeds.join(", "))}
      <hr className="my-2 border-accent/40" />
      <div className="grid grid-cols-3 gap-1 text-center @xl:grid-cols-6">
        {ABILITIES.map((a) => (
          <div key={a} title={s.abilities[a].parts.map((p) => `${p.label} ${p.value}`).join(", ")}>
            <div className="text-xs font-semibold">{a.toUpperCase()}</div>
            <div className="text-sm">
              {s.abilities[a].total} ({signed(s.mods[a])})
            </div>
            <div className="text-[11px] text-muted">save {signed(s.saves[a].total)}</div>
          </div>
        ))}
      </div>
      <hr className="my-2 border-accent/40" />
      {row("Skills", skills.join(", "))}
      {row("Vulnerabilities", sb.vulnerabilities.join(", "))}
      {row("Resistances", sb.resistances.join(", "))}
      {row("Immunities", [...sb.immunities, ...sb.conditionImmunities].join(", "))}
      {row("Damage notes", sb.damageNote)}
      {row("Senses", senses.join(", "))}
      {row("Languages", sb.languages || "—")}
      <p className="text-sm">
        <span className="font-semibold">CR</span> {formatCr(sb.cr)} <span className="text-muted">(proficiency {signed(s.proficiency)})</span>
      </p>

      {sb.traits.length > 0 && (
        <>
          <h4 className="mt-3 border-b border-accent/40 text-base font-semibold">Traits</h4>
          {sb.traits.map((a, i) => (
            <ActionLine key={i} a={a} stats={s} />
          ))}
        </>
      )}
      {[
        ["Actions", sb.actions],
        ["Bonus actions", sb.bonusActions],
        ["Reactions", sb.reactions],
      ].map(([title, list]) =>
        (list as StatAction[]).length ? (
          <div key={title as string}>
            <h4 className="mt-3 border-b border-accent/40 text-base font-semibold">{title as string}</h4>
            {(list as StatAction[]).map((a, i) => (
              <ActionLine key={i} a={a} stats={s} />
            ))}
          </div>
        ) : null,
      )}
      {sb.legendary && (
        <>
          <h4 className="mt-3 border-b border-accent/40 text-base font-semibold">Legendary actions ({sb.legendary.perRound} per round)</h4>
          {sb.legendary.actions.map((a, i) => (
            <ActionLine key={i} a={a} stats={s} />
          ))}
        </>
      )}
      {s.otherEffects.length > 0 && (
        <>
          <h4 className="mt-3 border-b border-accent/40 text-base font-semibold">From race, archetype, academy and equipment</h4>
          <ul className="mt-1 list-disc pl-5 text-sm">
            {s.otherEffects.map((o, i) => (
              <li key={i}>
                <span className="font-medium">{o.source}:</span> {describeEffect(o.effect)}
              </li>
            ))}
          </ul>
        </>
      )}
    </article>
  );
}
