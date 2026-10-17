import "server-only";
import { sql } from "drizzle-orm";

export interface HealthReport {
  ok: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
}

/** Plain-language checks for the setup steps in docs/SETUP.md. Never reveals secret values. */
export async function checkHealth(): Promise<HealthReport> {
  const checks: HealthReport["checks"] = [];

  const secret = process.env.SESSION_SECRET ?? "";
  checks.push({
    name: "SESSION_SECRET",
    ok: secret.length >= 32,
    detail: secret.length >= 32 ? "set" : "missing or shorter than 32 characters",
  });
  checks.push({
    name: "DM_PASSWORD",
    ok: Boolean(process.env.DM_PASSWORD),
    detail: process.env.DM_PASSWORD ? "set" : "missing",
  });

  if (!process.env.DATABASE_URL) {
    checks.push({ name: "Database", ok: false, detail: "DATABASE_URL is missing" });
  } else {
    try {
      const { db } = await import("@/db");
      const rows = await db.execute<{ exists: boolean }>(
        sql`select to_regclass('public.teams') is not null as exists`,
      );
      const migrated = Boolean(rows[0]?.exists);
      checks.push({
        name: "Database",
        ok: migrated,
        detail: migrated ? "connected" : "connected, but tables are missing (migrations haven't run)",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      checks.push({ name: "Database", ok: false, detail: `can't connect (${message.slice(0, 120)})` });
    }
  }

  return { ok: checks.every((c) => c.ok), checks };
}
