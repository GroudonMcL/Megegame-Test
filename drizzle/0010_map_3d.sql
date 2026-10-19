ALTER TABLE "games" ADD COLUMN "height_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "map_look" jsonb DEFAULT '{}'::jsonb NOT NULL;