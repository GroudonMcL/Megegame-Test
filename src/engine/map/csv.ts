// A small, forgiving CSV reader (quotes, escaped quotes, newlines inside
// quotes, commas or semicolons) plus the region import format.

export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

export interface ImportedRegion {
  code: string;
  name: string;
  description: string;
  features: string;
  ruin: { name: string; description: string } | null;
  dungeon: { name: string; description: string } | null;
  settleable: boolean;
}

export interface RegionImport {
  regions: ImportedRegion[];
  problems: string[];
  /** Which spreadsheet column fed each field, to show the DM. */
  columns: Record<string, string>;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

function findColumn(headers: string[], tests: ((h: string) => boolean)[]): number {
  for (const test of tests) {
    const i = headers.findIndex((h) => test(norm(h)));
    if (i >= 0) return i;
  }
  return -1;
}

function truthy(v: string): boolean {
  const s = v.trim().toLowerCase();
  if (s === "") return true;
  return !["no", "n", "false", "0", "x", "-", "nope"].includes(s);
}

/**
 * Reads the region spreadsheet: Region ID, Name, Description, Features,
 * Ruin Name/Description, Dungeon Name/Description, Settleable. Column names
 * are matched loosely and may be in any order.
 */
export function parseRegionCsv(text: string): RegionImport {
  const rows = parseCsv(text);
  const problems: string[] = [];
  if (rows.length < 2) return { regions: [], problems: ["The file needs a header row and at least one region."], columns: {} };
  const headers = rows[0];
  const col = {
    code: findColumn(headers, [(h) => h === "regionid", (h) => h === "id", (h) => h === "code", (h) => h.includes("regionid")]),
    name: findColumn(headers, [(h) => h === "name", (h) => h === "regionname"]),
    description: findColumn(headers, [(h) => h === "description", (h) => h === "regiondescription"]),
    features: findColumn(headers, [(h) => h.startsWith("feature")]),
    ruinName: findColumn(headers, [(h) => h === "ruinname", (h) => h === "ruin"]),
    ruinDescription: findColumn(headers, [(h) => h === "ruindescription"]),
    dungeonName: findColumn(headers, [(h) => h === "dungeonname", (h) => h === "dungeon"]),
    dungeonDescription: findColumn(headers, [(h) => h === "dungeondescription"]),
    settleable: findColumn(headers, [(h) => h.startsWith("settle")]),
  };
  // "Ruin Name/Description" in one column: "Name: description" or just a name.
  const combinedRuin = col.ruinName < 0 ? findColumn(headers, [(h) => h.startsWith("ruin")]) : -1;
  const combinedDungeon = col.dungeonName < 0 ? findColumn(headers, [(h) => h.startsWith("dungeon")]) : -1;
  if (col.code < 0) return { regions: [], problems: ['No "Region ID" column found.'], columns: {} };

  const columns: Record<string, string> = {};
  for (const [k, i] of Object.entries({ ...col, ruin: combinedRuin, dungeon: combinedDungeon })) if (i >= 0) columns[k] = headers[i];

  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const split = (v: string) => {
    const m = /^([^:]+):\s*([\s\S]*)$/.exec(v);
    return m ? { name: m[1].trim(), description: m[2].trim() } : { name: v, description: "" };
  };
  const seen = new Set<string>();
  const regions: ImportedRegion[] = [];
  rows.slice(1).forEach((r, idx) => {
    const code = get(r, col.code);
    if (!code) {
      problems.push(`Row ${idx + 2}: no Region ID, skipped.`);
      return;
    }
    if (seen.has(code.toLowerCase())) {
      problems.push(`Row ${idx + 2}: Region ID "${code}" appears twice; the later row wins.`);
      const i = regions.findIndex((x) => x.code.toLowerCase() === code.toLowerCase());
      regions.splice(i, 1);
    }
    seen.add(code.toLowerCase());
    const ruin = combinedRuin >= 0 ? split(get(r, combinedRuin)) : { name: get(r, col.ruinName), description: get(r, col.ruinDescription) };
    const dungeon = combinedDungeon >= 0 ? split(get(r, combinedDungeon)) : { name: get(r, col.dungeonName), description: get(r, col.dungeonDescription) };
    const present = (x: { name: string; description: string }) => (x.name || x.description ? { name: x.name || "Unnamed", description: x.description } : null);
    regions.push({
      code,
      name: get(r, col.name),
      description: get(r, col.description),
      features: get(r, col.features),
      ruin: present(ruin),
      dungeon: present(dungeon),
      settleable: col.settleable >= 0 ? truthy(get(r, col.settleable)) : true,
    });
  });
  return { regions, problems, columns };
}
