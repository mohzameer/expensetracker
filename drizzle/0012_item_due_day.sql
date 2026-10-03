ALTER TABLE "items" ADD COLUMN "due_day" integer;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_due_day" CHECK (due_day is null or due_day between 1 and 31);