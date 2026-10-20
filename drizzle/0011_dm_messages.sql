CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"from_dm" boolean NOT NULL,
	"author_name" text NOT NULL,
	"body" text NOT NULL,
	"kind" text DEFAULT 'message' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "messages_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "dm_read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_team_idx" ON "messages" USING btree ("team_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_game_idx" ON "messages" USING btree ("game_id");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- See 0001_enable_rls.sql: lock every table away from Supabase's public REST API.
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;