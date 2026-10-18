CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"data" "bytea" NOT NULL,
	"width" integer,
	"height" integer,
	"byte_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "map_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "archetype_id" text;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assets_game_idx" ON "assets" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_pair_idx" ON "connections" USING btree ("region_a","region_b");