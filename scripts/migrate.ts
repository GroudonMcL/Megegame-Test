// Applies any new SQL files in ./drizzle to the database in DATABASE_URL.
// Runs automatically on every Vercel deploy (see "vercel-build" in package.json),
// and can be run by hand with `npm run db:migrate`.
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

config({ path: ".env.local" });
config();

async function main() {
  // Vercel also builds "preview" copies of unmerged changes. Only the real
  // (production) deploy may change the shared database.
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") {
    console.log(`Skipping migrations on a ${process.env.VERCEL_ENV} deploy.`);
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set, so migrations cannot run. See docs/SETUP.md.");
    process.exit(1);
  }
  const client = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  await client.end();
  console.log("Migrations complete.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
