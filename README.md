# Ledger — expense tracker

A personal budgeting app: set category budgets each month, log expenses day by day on your phone, and review spending on a desktop dashboard.

- Each month's **category allocations are the budget** (hard caps). Overspending is allowed; the category goes negative until you **cover** it from another category or from **Savings**.
- **Items** are one-off (groceries, taxi) or monthly (rent, internet — can be paid in parts).
- **Closing a month** sweeps every leftover into Savings and makes the month read-only. The next month starts from the previous month's allocations.

**Stack:** Next.js 16 (App Router, Server Actions) · Neon Postgres · Drizzle ORM · Tailwind + shadcn/ui · Recharts · Zod

## Getting started

```bash
cp .env.example .env.local   # then fill it in
npm install
npm run db:migrate
npm run db:seed              # starter categories + this month's caps (optional)
npm run dev
```

Open http://localhost:3000 and sign in with `APP_PASSCODE`.

### Environment

| Variable | |
|---|---|
| `DATABASE_URL` | Neon connection string. For a zero-setup local database use `pglite://.data/dev` (embedded Postgres, stored in `.data/`). |
| `APP_PASSCODE` | What you type on the login screen. |
| `SESSION_SECRET` | 32+ random characters for the session cookie (`openssl rand -base64 32`). |
| `APP_TIMEZONE` | Timezone used for "today" (default `Asia/Colombo`). |

`npm run db:seed:demo` seeds last month (closed) plus sample spending for this month — useful for trying the app against a throwaway database.

## Scripts

| Command | |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` / `start` | Production build / server |
| `npm test` | Vitest — pure logic plus database tests on in-memory PGlite with the real migrations |
| `npm run typecheck` / `lint` | TypeScript / ESLint |
| `npm run db:generate` | Generate a migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to `DATABASE_URL` |

## How it's built

```
src/
  app/(app)/        day/[date] · inbox · dashboard · setup · savings · close/[month]
  app/api/export    CSV export (?month=YYYY-MM)
  components/       day view, sheets (expense, cover), setup form, charts
  db/               schema.ts (tables + views), client.ts (Neon or PGlite)
  lib/              money, dates, budget state, schemas (shared client/server)
  server/domain/    all business rules — plain functions taking a db, tested directly
  server/queries/   read models for pages
  server/actions/   Server Actions: session check → Zod → domain → revalidate
drizzle/            migrations; 0001 adds the views and closed-month triggers
```

### Data model decisions

- **Money is integer minor units** (`bigint`); input is parsed from strings, never floats.
- **Balances are never stored.** Postgres views derive them from rows:
  `category_month_summary` (allocation ± transfers − spent), `monthly_item_status` (unpaid / partial / paid), `savings_balance`.
- **Transfers** move money between a category, Savings, or `external` (manual Savings adjustments like a starting balance). Covers, month-close sweeps and manual moves are all transfers, so every movement is on the Savings ledger.
- **Closed months are read-only twice over:** the app checks first, and database triggers reject any insert/update/delete of expenses, transfers or caps in a closed month.
- An expense's item must belong to its category (composite foreign key). Expenses without a category sit in **Needs category** and don't count against any budget.
- Months close in order, and only once they've ended. Categories and items with history are archived, never deleted.
- Alert state (green / amber / red) is one function, `src/lib/budget.ts`, used by the live line while typing and by the server's save response.

## Deploying

Deploy to Vercel (or any Node host) with the same environment variables, and run `npm run db:migrate` against the production database. On a phone, open the site and use **Add to Home Screen** — it installs as a standalone app.
