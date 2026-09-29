CREATE TABLE "incomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month_id" uuid NOT NULL,
	"source" text NOT NULL,
	"amount" bigint NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incomes_amount_positive" CHECK (amount > 0)
);
--> statement-breakpoint
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_month_id_months_id_fk" FOREIGN KEY ("month_id") REFERENCES "public"."months"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "incomes_month_idx" ON "incomes" USING btree ("month_id");