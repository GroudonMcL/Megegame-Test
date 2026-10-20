ALTER TABLE "units" ADD COLUMN "carried" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "unequipped" jsonb;--> statement-breakpoint
ALTER TABLE "units" RENAME COLUMN "augment_ids" TO "equipped_item_ids";