-- Income lines of a closed month are read-only too.
CREATE TRIGGER incomes_guard_closed_month
  BEFORE INSERT OR UPDATE OR DELETE ON incomes
  FOR EACH ROW EXECUTE FUNCTION guard_closed_month_by_id();
--> statement-breakpoint

-- A monthly item is only due in months where its category has a cap. Setting a
-- category's cap to 0 pauses its monthly items (e.g. rent that starts next month).
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
    AND e.spent_on < (m.starts_on + interval '1 month')
) p ON true
WHERE (
    i.created_at < (m.starts_on + interval '1 month')
    AND (i.archived_at IS NULL OR i.archived_at >= m.starts_on)
    AND coalesce(b.allocation, 0) > 0
  )
  OR coalesce(p.paid, 0) > 0;
