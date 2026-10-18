CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"round_id" uuid,
	"actor" text NOT NULL,
	"kind" text NOT NULL,
	"description" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"undone" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"region_a" uuid NOT NULL,
	"region_b" uuid NOT NULL,
	"miles" real,
	"terrain_id" text DEFAULT 'normal' NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_rulesets" (
	"game_id" uuid PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"team_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"qty" integer NOT NULL,
	CONSTRAINT "inventory_team_id_item_id_pk" PRIMARY KEY("team_id","item_id")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"slot" integer,
	"parent_order_id" uuid,
	"action_type_id" text NOT NULL,
	"inputs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"outcome" jsonb,
	"bypassed" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"x" real NOT NULL,
	"y" real NOT NULL,
	"settleable" boolean DEFAULT true NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"owner_team_id" uuid,
	"settlement_tier_id" text,
	"buildings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"structures" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deposits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"features" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roll_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"round_id" uuid,
	"order_id" uuid,
	"label" text NOT NULL,
	"expression" text NOT NULL,
	"seed" text NOT NULL,
	"result" jsonb NOT NULL,
	"total" integer NOT NULL,
	"table_id" text,
	"overridden" boolean DEFAULT false NOT NULL,
	"hidden_from_players" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"deadline" timestamp with time zone,
	"opened_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"snapshot" jsonb
);
--> statement-breakpoint
CREATE TABLE "team_connection_knowledge" (
	"team_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	CONSTRAINT "team_connection_knowledge_team_id_connection_id_pk" PRIMARY KEY("team_id","connection_id")
);
--> statement-breakpoint
CREATE TABLE "team_contacts" (
	"team_a" uuid NOT NULL,
	"team_b" uuid NOT NULL,
	"since_round" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "team_contacts_team_a_team_b_pk" PRIMARY KEY("team_a","team_b")
);
--> statement-breakpoint
CREATE TABLE "team_region_knowledge" (
	"team_id" uuid NOT NULL,
	"region_id" uuid NOT NULL,
	"discovered" boolean DEFAULT true NOT NULL,
	"searched" boolean DEFAULT false NOT NULL,
	"permanent_vision" boolean DEFAULT false NOT NULL,
	"last_seen" jsonb,
	"last_seen_round" integer,
	CONSTRAINT "team_region_knowledge_team_id_region_id_pk" PRIMARY KEY("team_id","region_id")
);
--> statement-breakpoint
CREATE TABLE "team_unit_detections" (
	"team_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"round" integer NOT NULL,
	CONSTRAINT "team_unit_detections_team_id_unit_id_pk" PRIMARY KEY("team_id","unit_id")
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"owner_team_id" uuid,
	"creature_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"race_id" text,
	"academy_bonus" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"augment_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"hp" integer NOT NULL,
	"region_id" uuid,
	"miles_used" real DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"is_leader" boolean DEFAULT false NOT NULL,
	"uses_spent" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"harvest_left" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "preset_id" text DEFAULT 'blank' NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "current_round" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "is_npc" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "emblem" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "base_race_id" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "race_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "resources" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "known_recipe_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "secret_objectives" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "notes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "discord_webhook_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_region_a_regions_id_fk" FOREIGN KEY ("region_a") REFERENCES "public"."regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_region_b_regions_id_fk" FOREIGN KEY ("region_b") REFERENCES "public"."regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_rulesets" ADD CONSTRAINT "game_rulesets_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regions" ADD CONSTRAINT "regions_owner_team_id_teams_id_fk" FOREIGN KEY ("owner_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roll_log" ADD CONSTRAINT "roll_log_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roll_log" ADD CONSTRAINT "roll_log_round_id_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."rounds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roll_log" ADD CONSTRAINT "roll_log_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_connection_knowledge" ADD CONSTRAINT "team_connection_knowledge_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_connection_knowledge" ADD CONSTRAINT "team_connection_knowledge_connection_id_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_contacts" ADD CONSTRAINT "team_contacts_team_a_teams_id_fk" FOREIGN KEY ("team_a") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_contacts" ADD CONSTRAINT "team_contacts_team_b_teams_id_fk" FOREIGN KEY ("team_b") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_region_knowledge" ADD CONSTRAINT "team_region_knowledge_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_region_knowledge" ADD CONSTRAINT "team_region_knowledge_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_unit_detections" ADD CONSTRAINT "team_unit_detections_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_unit_detections" ADD CONSTRAINT "team_unit_detections_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_owner_team_id_teams_id_fk" FOREIGN KEY ("owner_team_id") REFERENCES "public"."teams"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_region_id_regions_id_fk" FOREIGN KEY ("region_id") REFERENCES "public"."regions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_game_idx" ON "audit_log" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "connections_game_idx" ON "connections" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "orders_round_team_idx" ON "orders" USING btree ("round_id","team_id");--> statement-breakpoint
CREATE INDEX "regions_game_idx" ON "regions" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "regions_game_code_idx" ON "regions" USING btree ("game_id","code");--> statement-breakpoint
CREATE INDEX "roll_log_game_idx" ON "roll_log" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rounds_game_number_idx" ON "rounds" USING btree ("game_id","number");--> statement-breakpoint
CREATE INDEX "units_game_idx" ON "units" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "units_region_idx" ON "units" USING btree ("region_id");