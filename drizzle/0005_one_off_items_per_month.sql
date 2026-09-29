DROP INDEX "items_category_name_lower_idx";--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "month_id" uuid;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_month_id_months_id_fk" FOREIGN KEY ("month_id") REFERENCES "public"."months"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "items_category_name_month_idx" ON "items" USING btree ("category_id",lower(name),coalesce(month_id, '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
-- Existing one-off items belong to the month of their first expense, else the month they were created in.
UPDATE "items" i SET "month_id" = coalesce(
  (SELECT m.id FROM expenses e JOIN months m ON m.starts_on = date_trunc('month', e.spent_on)::date
    WHERE e.item_id = i.id ORDER BY e.spent_on LIMIT 1),
  (SELECT m.id FROM months m WHERE m.starts_on = date_trunc('month', i.created_at)::date),
  (SELECT m.id FROM months m ORDER BY m.year_month LIMIT 1)
) WHERE i.kind = 'one_off';--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_month_scope" CHECK ((kind = 'one_off') = (month_id is not null));