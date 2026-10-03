CREATE TABLE "item_skips" (
	"item_id" uuid NOT NULL,
	"month_id" uuid NOT NULL,
	CONSTRAINT "item_skips_item_id_month_id_pk" PRIMARY KEY("item_id","month_id")
);
--> statement-breakpoint
ALTER TABLE "items" DROP CONSTRAINT "items_due_day";--> statement-breakpoint
ALTER TABLE "item_skips" ADD CONSTRAINT "item_skips_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_skips" ADD CONSTRAINT "item_skips_month_id_months_id_fk" FOREIGN KEY ("month_id") REFERENCES "public"."months"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" DROP COLUMN "due_day";--> statement-breakpoint
-- A monthly item skipped for a month isn't due in it (a payment made anyway still shows).
CREATE OR REPLACE VIEW monthly_item_status AS
SELECT
  m.id AS month_id,
  m.year_month,
  i.id AS item_id,
  i.category_id,
  i.name,
  i.expected_amount AS expected,
  coalesce(p.paid, 0)::bigint AS paid,
  CASE
    WHEN coalesce(p.paid, 0) = 0 THEN 'unpaid'
    WHEN p.paid < i.expected_amount THEN 'partial'
    ELSE 'paid'
  END AS status
FROM months m
JOIN items i ON i.kind = 'monthly'
LEFT JOIN category_budgets b ON b.month_id = m.id AND b.category_id = i.category_id
LEFT JOIN LATERAL (
  SELECT sum(e.amount)::bigint AS paid
  FROM expenses e
  WHERE e.item_id = i.id
    AND e.spent_on >= m.starts_on
    AND e.spent_on < m.ends_on
) p ON true
WHERE (
    i.created_at < m.ends_on
    AND (i.archived_at IS NULL OR i.archived_at >= m.starts_on)
    AND coalesce(b.allocation, 0) > 0
    AND NOT EXISTS (SELECT 1 FROM item_skips s WHERE s.item_id = i.id AND s.month_id = m.id)
  )
  OR coalesce(p.paid, 0) > 0;
