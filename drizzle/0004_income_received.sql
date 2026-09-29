ALTER TABLE "transfers" DROP CONSTRAINT "transfers_reason";--> statement-breakpoint
ALTER TABLE "incomes" ADD COLUMN "status" text DEFAULT 'expected' NOT NULL;--> statement-breakpoint
ALTER TABLE "incomes" ADD COLUMN "received_on" date;--> statement-breakpoint
ALTER TABLE "incomes" ADD COLUMN "transfer_id" uuid;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "default_income_source" text DEFAULT 'Salary' NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "default_income_amount" bigint;--> statement-breakpoint
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_transfer_id_transfers_id_fk" FOREIGN KEY ("transfer_id") REFERENCES "public"."transfers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_status" CHECK (status in ('expected', 'received'));--> statement-breakpoint
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_received" CHECK ((status = 'received') = (transfer_id is not null and received_on is not null));--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_default_income" CHECK (default_income_amount is null or default_income_amount > 0);--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_reason" CHECK (reason in ('cover', 'month_close', 'manual', 'income'));