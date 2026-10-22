CREATE TABLE "item_completions" (
	"item_id" uuid NOT NULL,
	"month_id" uuid NOT NULL,
	CONSTRAINT "item_completions_item_id_month_id_pk" PRIMARY KEY("item_id","month_id")
);
--> statement-breakpoint
ALTER TABLE "item_completions" ADD CONSTRAINT "item_completions_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_completions" ADD CONSTRAINT "item_completions_month_id_months_id_fk" FOREIGN KEY ("month_id") REFERENCES "public"."months"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- A monthly item marked complete for a month counts as paid in it, whatever was paid.
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
    WHEN d.item_id IS NOT NULL THEN 'paid'
    WHEN coalesce(p.paid, 0) = 0 THEN 'unpaid'
    WHEN p.paid < i.expected_amount THEN 'partial'
    ELSE 'paid'
  END AS status,
  d.item_id IS NOT NULL AS completed
FROM months m
JOIN items i ON i.kind = 'monthly'
LEFT JOIN category_budgets b ON b.month_id = m.id AND b.category_id = i.category_id
LEFT JOIN item_completions d ON d.item_id = i.id AND d.month_id = m.id
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
    AND (i.end_ym IS NULL OR m.year_month <= i.end_ym)
  )
  OR coalesce(p.paid, 0) > 0;
