// Regenerates src/data/srd-2024-monsters.json from the 5e-bits "5e-database"
// project (https://github.com/5e-bits/5e-database), which publishes the SRD 5.2
// as JSON. Only needed when updating the bundled monster library:
//
//   git clone --depth 1 https://github.com/5e-bits/5e-database.git ../5e-database
//   npx tsx scripts/build-srd.ts ../5e-database
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { convertMonster } from "../src/engine/srd/convert2024";

const root = process.argv[2];
if (!root) {
  console.error("Usage: npx tsx scripts/build-srd.ts <path to 5e-database checkout>");
  process.exit(1);
}
const raw = JSON.parse(readFileSync(join(root, "src/2024/en/5e-SRD-Monsters.json"), "utf8"));
const monsters = raw.map(convertMonster);

const counts = { auto: 0, needsReview: 0, text: 0 };
for (const m of monsters) {
  const sb = m.statBlock;
  for (const a of [...sb.traits, ...sb.actions, ...sb.bonusActions, ...sb.reactions, ...(sb.legendary?.actions ?? [])]) {
    counts[a.review as keyof typeof counts]++;
  }
}
const out = join(process.cwd(), "src/data/srd-2024-monsters.json");
writeFileSync(out, JSON.stringify(monsters));
console.log(`Wrote ${monsters.length} monsters to ${out}`);
console.log("Actions and traits:", counts);
