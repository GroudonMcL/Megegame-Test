CREATE TABLE "team_round_orders" (
	"round_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text,
	CONSTRAINT "team_round_orders_round_id_team_id_pk" PRIMARY KEY("round_id","team_id")
);
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "seen_creature_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "team_round_orders" ADD CONSTRAINT "team_round_orders_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_round_orders" ADD CONSTRAINT "team_round_orders_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- See 0001_enable_rls.sql: lock every table away from Supabase's public REST API.
ALTER TABLE "team_round_orders" ENABLE ROW LEVEL SECURITY;
