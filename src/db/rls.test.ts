import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getTableName, isTable } from "drizzle-orm";
import * as schema from "./schema";

// Guards against forgetting to lock a new table away from Supabase's public REST API.
describe("row-level security", () => {
  it("is enabled for every table in the schema", () => {
    const dir = join(process.cwd(), "drizzle");
    const sql = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(join(dir, f), "utf8"))
      .join("\n");
    const tables = Object.values(schema).filter(isTable).map(getTableName);
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      expect(sql, `missing: ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`).toContain(`ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY`);
    }
  });
});
