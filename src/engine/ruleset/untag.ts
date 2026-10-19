// Drops "needs a <tag> unit" requirements from actions (e.g. only Regiments
// can raid, only Miners can excavate), so any unit can take them. Used once
// on saved game rulesets when the Utterdark preset stopped having them
// (scripts/untag-actions.ts). The DM can still add them back in the ruleset editor.

interface RawAction {
  name?: string;
  requirements?: { type?: string }[];
  inputs?: { type?: string; tag?: string }[];
}

/** The actions without unit-type requirements, and the names of those that changed. */
export function dropUnitRequirements<A extends RawAction>(actions: A[]): { actions: A[]; changed: string[] } {
  const changed: string[] = [];
  const out = actions.map((a) => {
    const requirements = a.requirements?.filter((r) => r.type !== "unitWithTag");
    const inputs = a.inputs?.map((i) => {
      if (i.type !== "unit" || !("tag" in i)) return i;
      const rest = { ...i };
      delete rest.tag;
      return rest;
    });
    const same = requirements?.length === a.requirements?.length && !a.inputs?.some((i) => i.type === "unit" && "tag" in i);
    if (same) return a;
    changed.push(a.name ?? "an action");
    return { ...a, ...(requirements && { requirements }), ...(inputs && { inputs }) };
  });
  return { actions: out, changed };
}
