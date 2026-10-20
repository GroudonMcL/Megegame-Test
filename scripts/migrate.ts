// Applies any new SQL files in ./drizzle to the database in DATABASE_URL.
// Runs automatically on every Vercel deploy (see "vercel-build" in package.json),
// and can be run by hand with `npm run db:migrate`.
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { parseConnectionString } from "../src/db/connectionString";
import * as schema from "../src/db/schema";
import { convertMaps } from "./convert-maps";
import { fillRangesInGames } from "./fill-ranges";
import { untagActions } from "./untag-actions";

config({ path: ".env.local" });
config();

async function main() {
  // Vercel also builds "preview" copies of unmerged changes. Only the real
  // (production) deploy may change the shared database, unless MIGRATE_PREVIEWS
  // is "true" (for testing a branch whose migrations only add things, so the
  // live site keeps working).
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production" && process.env.MIGRATE_PREVIEWS !== "true") {
    console.log(`Skipping migrations on a ${process.env.VERCEL_ENV} deploy.`);
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set, so migrations cannot run. See docs/SETUP.md.");
    process.exit(1);
  }
  const client = postgres({ ...parseConnectionString(url), prepare: false, max: 1, onnotice: () => {} });
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  // One-off data changes that need app code, not just SQL.
  await convertMaps(drizzle(client, { schema }));
  await untagActions(drizzle(client, { schema }));
  await fillRangesInGames(drizzle(client, { schema }));
  await client.end();
  console.log("Migrations complete.");
}

main().catch((err) => {
  console.error(`Migration failed: ${explain(err)}`);
  console.error(err);
  process.exit(1);
});

/** Plain-language hints for the mistakes people usually make when setting up. */
function explain(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/password authentication failed/i.test(msg)) {
    return "the database password in DATABASE_URL is wrong. Check it, or reset it in Supabase → Project Settings → Database.";
  }
  if (/tenant or user not found/i.test(msg)) {
    return "Supabase doesn't recognise the user name in DATABASE_URL. Copy the Transaction pooler string again.";
  }
  if (/ENOTFOUND|getaddrinfo/i.test(msg)) return "the host name in DATABASE_URL can't be found. Copy the string again.";
  if (/ETIMEDOUT|ECONNREFUSED/i.test(msg)) {
    return "couldn't reach the database. Check that you used the Transaction pooler string (port 6543) and that the Supabase project isn't paused.";
  }
  return msg;
}
