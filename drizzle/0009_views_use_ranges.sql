-- Months are now explicit date ranges [starts_on, ends_on) (e.g. 25 Sep → 25 Oct),
-- so the views and the closed-month guard use them instead of calendar months.

CREATE OR REPLACE VIEW category_month_summary AS
WITH spend AS (
  SELECT m.id AS month_id, e.category_id, sum(e.amount)::bigint AS spent
  FROM expenses e
  JOIN months m ON e.spent_on >= m.starts_on AND e.spent_on < m.ends_on
  WHERE e.category_id IS NOT NULL
  GROUP BY m.id, e.category_id
),
t_in AS (
  SELECT month_id, to_category_id AS category_id, sum(amount)::bigint AS amount
  FROM transfers
  WHERE to_kind = 'category'
  GROUP BY month_id, to_category_id
),
t_out AS (
  SELECT month_id, from_category_id AS category_id,
    coalesce(sum(amount) FILTER (WHERE reason <> 'month_close'), 0)::bigint AS amount,
    coalesce(sum(amount) FILTER (WHERE reason = 'month_close'), 0)::bigint AS swept
  FROM transfers
  WHERE from_kind = 'category'
  GROUP BY month_id, from_category_id
),
keys AS (
  SELECT month_id, category_id FROM category_budgets
  UNION SELECT month_id, category_id FROM spend
  UNION SELECT month_id, category_id FROM t_in
  UNION SELECT month_id, category_id FROM t_out
)
SELECT
  m.id AS month_id,
  m.year_month,
  c.id AS category_id,
  c.name,
  c.color,
  c.sort_order,
  c.archived_at,
  coalesce(b.allocation, 0)::bigint AS allocation,
  coalesce(b.alert_pct, m.default_alert_pct)::smallint AS alert_pct,
  coalesce(ti.amount, 0)::bigint AS transfers_in,
  coalesce(tout.amount, 0)::bigint AS transfers_out,
  (coalesce(b.allocation, 0) + coalesce(ti.amount, 0) - coalesce(tout.amount, 0))::bigint AS effective_allocation,
  coalesce(s.spent, 0)::bigint AS spent,
  (coalesce(b.allocation, 0) + coalesce(ti.amount, 0) - coalesce(tout.amount, 0) - coalesce(s.spent, 0))::bigint AS remaining,
  coalesce(tout.swept, 0)::bigint AS swept
FROM keys k
JOIN months m ON m.id = k.month_id
JOIN categories c ON c.id = k.category_id
LEFT JOIN category_budgets b ON b.month_id = k.month_id AND b.category_id = k.category_id
LEFT JOIN spend s ON s.month_id = k.month_id AND s.category_id = k.category_id
LEFT JOIN t_in ti ON ti.month_id = k.month_id AND ti.category_id = k.category_id
LEFT JOIN t_out tout ON tout.month_id = k.month_id AND tout.category_id = k.category_id;
--> statement-breakpoint

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
  )
  OR coalesce(p.paid, 0) > 0;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION raise_if_month_closed_by_date(d date) RETURNS void LANGUAGE plpgsql AS $$
DECLARE ym text;
BEGIN
  IF d IS NULL THEN
    RETURN;
  END IF;
  SELECT year_month INTO ym FROM months WHERE d >= starts_on AND d < ends_on AND status = 'closed';
  IF ym IS NOT NULL THEN
    RAISE EXCEPTION 'MONTH_CLOSED: % is closed and read-only', ym;
  END IF;
END $$;
