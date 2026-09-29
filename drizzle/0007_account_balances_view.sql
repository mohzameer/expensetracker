-- Balance of each account = opening/corrections/transfers + income received into it − expenses paid from it.
-- Expenses and income from before accounts existed have no account and are already in the opening balances.
CREATE VIEW account_balances AS
SELECT
  a.id AS account_id,
  a.name,
  a.sort_order,
  a.archived_at,
  (
    coalesce((SELECT sum(e.amount) FROM account_entries e WHERE e.account_id = a.id), 0)
    + coalesce((SELECT sum(i.amount) FROM incomes i WHERE i.account_id = a.id AND i.status = 'received'), 0)
    - coalesce((SELECT sum(x.amount) FROM expenses x WHERE x.account_id = a.id), 0)
  )::bigint AS balance
FROM accounts a;
