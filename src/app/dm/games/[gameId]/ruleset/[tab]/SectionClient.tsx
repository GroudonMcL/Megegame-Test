"use client";

import { SECTION_CONFIG } from "@/components/editor/sections";
import { SectionEditor, type SaveSection } from "@/components/editor/SectionEditor";
import type { Ruleset, RulesetSection } from "@/engine/ruleset/ruleset";

export function SectionClient({ section, ruleset, version, save, selected }: {
  section: Exclude<RulesetSection, "creatures">;
  ruleset: Ruleset;
  version: number;
  save: SaveSection;
  selected?: string;
}) {
  const config = SECTION_CONFIG[section];
  return (
    <SectionEditor
      key={section}
      section={section}
      title={config.title}
      intro={config.intro}
      ruleset={ruleset}
      version={version}
      save={save}
      fields={config.fields}
      label={config.label}
      newItem={(id) => config.newItem(id) as { id: string }}
      initialSelectedId={selected}
    />
  );
}
