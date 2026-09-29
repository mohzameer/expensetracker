CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#1F5F5B' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category_budgets" (
	"month_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"allocation" bigint DEFAULT 0 NOT NULL,
	"alert_pct" smallint,
	CONSTRAINT "category_budgets_month_id_category_id_pk" PRIMARY KEY("month_id","category_id"),
	CONSTRAINT "category_budgets_allocation" CHECK (allocation >= 0),
	CONSTRAINT "category_budgets_alert_pct" CHECK (alert_pct is null or alert_pct between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"spent_on" date NOT NULL,
	"category_id" uuid,
	"item_id" uuid,
	"amount" bigint NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_amount_positive" CHECK (amount > 0),
	CONSTRAINT "expenses_item_needs_category" CHECK (item_id is null or category_id is not null)
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"expected_amount" bigint,
	"default_amount" bigint,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_id_category_uq" UNIQUE("id","category_id"),
	CONSTRAINT "items_kind" CHECK (kind in ('monthly', 'one_off')),
	CONSTRAINT "items_monthly_expected" CHECK (kind <> 'monthly' or expected_amount is not null),
	CONSTRAINT "items_expected_positive" CHECK (expected_amount is null or expected_amount > 0),
	CONSTRAINT "items_default_positive" CHECK (default_amount is null or default_amount > 0)
);
--> statement-breakpoint
CREATE TABLE "months" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year_month" char(7) NOT NULL,
	"starts_on" date GENERATED ALWAYS AS (make_date(left(year_month, 4)::int, right(year_month, 2)::int, 1)) STORED NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"closed_at" timestamp with time zone,
	"default_alert_pct" smallint DEFAULT 10 NOT NULL,
	CONSTRAINT "months_yearMonth_unique" UNIQUE("year_month"),
	CONSTRAINT "months_year_month_format" CHECK (year_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "months_status" CHECK (status in ('open', 'closed')),
	CONSTRAINT "months_alert_pct" CHECK (default_alert_pct between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"currency_code" text DEFAULT 'LKR' NOT NULL,
	"currency_symbol" text DEFAULT 'Rs' NOT NULL,
	"default_alert_pct" smallint DEFAULT 10 NOT NULL,
	CONSTRAINT "settings_singleton" CHECK (id = 1)
);
--> statement-breakpoint
CREATE TABLE "transfers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month_id" uuid NOT NULL,
	"from_kind" text NOT NULL,
	"from_category_id" uuid,
	"to_kind" text NOT NULL,
	"to_category_id" uuid,
	"amount" bigint NOT NULL,
	"reason" text NOT NULL,
	"note" text,
	"occurred_on" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfers_amount_positive" CHECK (amount > 0),
	CONSTRAINT "transfers_from_kind" CHECK (from_kind in ('category', 'savings', 'external')),
	CONSTRAINT "transfers_to_kind" CHECK (to_kind in ('category', 'savings', 'external')),
	CONSTRAINT "transfers_reason" CHECK (reason in ('cover', 'month_close', 'manual')),
	CONSTRAINT "transfers_from_category" CHECK ((from_kind = 'category') = (from_category_id is not null)),
	CONSTRAINT "transfers_to_category" CHECK ((to_kind = 'category') = (to_category_id is not null)),
	CONSTRAINT "transfers_distinct_ends" CHECK (from_kind <> to_kind or (from_kind = 'category' and from_category_id <> to_category_id)),
	CONSTRAINT "transfers_external_with_savings" CHECK ((from_kind <> 'external' or to_kind = 'savings') and (to_kind <> 'external' or from_kind = 'savings'))
);
--> statement-breakpoint
ALTER TABLE "category_budgets" ADD CONSTRAINT "category_budgets_month_id_months_id_fk" FOREIGN KEY ("month_id") REFERENCES "public"."months"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_budgets" ADD CONSTRAINT "category_budgets_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_item_category_fk" FOREIGN KEY ("item_id","category_id") REFERENCES "public"."items"("id","category_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_month_id_months_id_fk" FOREIGN KEY ("month_id") REFERENCES "public"."months"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_from_category_id_categories_id_fk" FOREIGN KEY ("from_category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_to_category_id_categories_id_fk" FOREIGN KEY ("to_category_id") REFERENCES "public"."categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_name_lower_idx" ON "categories" USING btree (lower(name));--> statement-breakpoint
CREATE INDEX "expenses_spent_on_idx" ON "expenses" USING btree ("spent_on");--> statement-breakpoint
CREATE INDEX "expenses_category_spent_on_idx" ON "expenses" USING btree ("category_id","spent_on");--> statement-breakpoint
CREATE INDEX "expenses_item_spent_on_idx" ON "expenses" USING btree ("item_id","spent_on");--> statement-breakpoint
CREATE UNIQUE INDEX "items_category_name_lower_idx" ON "items" USING btree ("category_id",lower(name));--> statement-breakpoint
CREATE UNIQUE INDEX "months_starts_on_idx" ON "months" USING btree ("starts_on");--> statement-breakpoint
CREATE INDEX "transfers_month_idx" ON "transfers" USING btree ("month_id");