ALTER TABLE "item_completions" ADD COLUMN "released" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "item_completions" ADD CONSTRAINT "item_completions_released" CHECK (released >= 0);