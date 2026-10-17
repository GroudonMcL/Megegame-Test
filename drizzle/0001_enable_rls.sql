-- Supabase publishes the "public" schema through its auto-generated REST API.
-- Turning on row-level security with no policies means that API (and the
-- public "anon" key) can read nothing. The app itself connects as the database
-- owner from the server, which is not affected.
-- Every new table must get the same line in a later migration.
ALTER TABLE "games" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "players" ENABLE ROW LEVEL SECURITY;
