ALTER TABLE "items" ADD COLUMN "end_ym" char(7);--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_end_ym" CHECK (end_ym is null or (kind = 'monthly' and end_ym ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'));--> statement-breakpoint
-- A monthly item isn't due in months after its last one (a payment made anyway still shows).
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
    AND (i.end_ym IS NULL OR m.year_month <= i.end_ym)
  )
  OR coalesce(p.paid, 0) > 0;
