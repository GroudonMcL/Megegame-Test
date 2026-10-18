-- See 0001_enable_rls.sql: lock every table away from Supabase's public REST API.
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "game_rulesets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "regions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roll_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rounds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_connection_knowledge" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_region_knowledge" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_unit_detections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "units" ENABLE ROW LEVEL SECURITY;
