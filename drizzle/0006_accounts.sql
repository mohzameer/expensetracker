CREATE TABLE "account_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"occurred_on" date NOT NULL,
	"amount" bigint NOT NULL,
	"kind" text NOT NULL,
	"note" text,
	"transfer_group" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_entries_amount_nonzero" CHECK (amount <> 0),
	CONSTRAINT "account_entries_kind" CHECK (kind in ('opening', 'adjustment', 'transfer'))
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "incomes" DROP CONSTRAINT "incomes_received";--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "incomes" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "default_account_id" uuid;--> statement-breakpoint
ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_entries_account_idx" ON "account_entries" USING btree ("account_id","occurred_on");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_name_lower_idx" ON "accounts" USING btree (lower(name));--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_default_account_id_accounts_id_fk" FOREIGN KEY ("default_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_account_idx" ON "expenses" USING btree ("account_id");--> statement-breakpoint
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_received" CHECK ((status = 'received') = (received_on is not null));