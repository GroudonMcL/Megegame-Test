-- See 0001_enable_rls.sql: lock every table away from Supabase's public REST API.
ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;
