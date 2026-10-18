import { notFound } from "next/navigation";
import { CreaturesEditor } from "@/components/editor/CreaturesEditor";
import { JsonTab } from "@/components/editor/JsonTab";
import { SettingsEditor } from "@/components/editor/SettingsEditor";
import { RULESET_TABS } from "@/components/editor/tabs";
import { findReferenceProblems } from "@/engine/ruleset/validate";
import { loadRuleset } from "@/lib/rulesets";
import { requireDm } from "@/lib/session";
import { PRESETS } from "@/presets";
import { fetchSrdAction, presetAction, saveSectionAction, saveWholeAction, searchSrdAction } from "../actions";
// Field configs contain functions, so a client wrapper picks them.
import { SectionClient } from "./SectionClient";

export default async function RulesetTab({ params, searchParams }: PageProps<"/dm/games/[gameId]/ruleset/[tab]">) {
  await requireDm();
  const [{ gameId, tab }, query] = await Promise.all([params, searchParams]);
  const meta = RULESET_TABS.find((t) => t.slug === tab);
  if (!meta) notFound();
  const { ruleset, version } = await loadRuleset(gameId);
  const saveSection = saveSectionAction.bind(null, gameId);
  const saveWhole = saveWholeAction.bind(null, gameId);

  if (tab === "settings") return <SettingsEditor ruleset={ruleset} version={version} save={saveWhole} />;
  if (tab === "json") {
    return (
      <JsonTab
        gameId={gameId}
        version={version}
        problems={findReferenceProblems(ruleset)}
        save={saveWhole}
        presets={PRESETS.map(({ id, name }) => ({ id, name }))}
        loadPreset={presetAction}
      />
    );
  }
  if (meta.section === "creatures") {
    return <CreaturesEditor ruleset={ruleset} version={version} save={saveSection} search={searchSrdAction} fetchMonster={fetchSrdAction} />;
  }
  const section = meta.section;
  if (!section) notFound();
  return <SectionClient section={section} ruleset={ruleset} version={version} save={saveSection} selected={typeof query.id === "string" ? query.id : undefined} />;
}
