CREATE TABLE "terrain_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"terrain_id" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"polygon" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "kind" text DEFAULT 'link' NOT NULL;--> statement-breakpoint
ALTER TABLE "connections" ADD COLUMN "blocked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "map_miles_across" real DEFAULT 200 NOT NULL;--> statement-breakpoint
-- Games that already exist have node maps; scripts/convert-maps.ts turns them into regions. New games start with regions.
ALTER TABLE "games" ADD COLUMN "map_kind" text DEFAULT 'nodes' NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ALTER COLUMN "map_kind" SET DEFAULT 'regions';--> statement-breakpoint
ALTER TABLE "regions" ADD COLUMN "polygon" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "x" real;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "y" real;--> statement-breakpoint
ALTER TABLE "terrain_areas" ADD CONSTRAINT "terrain_areas_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "terrain_areas_game_idx" ON "terrain_areas" USING btree ("game_id");--> statement-breakpoint
-- See 0001_enable_rls.sql: lock every table away from Supabase's public REST API.
ALTER TABLE "terrain_areas" ENABLE ROW LEVEL SECURITY;
