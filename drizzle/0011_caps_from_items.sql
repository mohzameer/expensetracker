-- Caps are no longer typed in: a category's cap for a month is the total of its
-- items (monthly items + that month's one-offs). Recompute every open month once;
-- from here on the app keeps them in sync (src/server/domain/caps.ts).
INSERT INTO category_budgets (month_id, category_id, allocation)
SELECT m.id, c.id,
  coalesce((SELECT sum(i.expected_amount) FROM items i
            WHERE i.category_id = c.id AND i.kind = 'monthly' AND i.archived_at IS NULL), 0)
  + coalesce((SELECT sum(coalesce(i.default_amount, 0)) FROM items i
              WHERE i.category_id = c.id AND i.kind = 'one_off' AND i.month_id = m.id AND i.archived_at IS NULL), 0)
FROM months m
CROSS JOIN categories c
WHERE m.status = 'open' AND c.archived_at IS NULL
ON CONFLICT (month_id, category_id) DO UPDATE SET allocation = EXCLUDED.allocation;
