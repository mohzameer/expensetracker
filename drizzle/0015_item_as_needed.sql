ALTER TABLE "items" DROP CONSTRAINT "items_kind";--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_kind" CHECK (kind in ('monthly', 'one_off', 'as_needed'));