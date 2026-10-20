CREATE TABLE "captured_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"body" text NOT NULL,
	"sender" text,
	"body_hash" text NOT NULL,
	"kind" text NOT NULL,
	"merchant" text,
	"amount" bigint,
	"fee" bigint,
	"foreign_currency" text,
	"foreign_amount" bigint,
	"account_ref" text,
	"occurred_on" date NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expense_id" uuid,
	"transfer_group" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "captured_messages_bodyHash_unique" UNIQUE("body_hash"),
	CONSTRAINT "captured_messages_kind" CHECK (kind in ('purchase', 'withdrawal', 'bank_transfer', 'other')),
	CONSTRAINT "captured_messages_status" CHECK (status in ('pending', 'logged', 'dismissed'))
);
--> statement-breakpoint
ALTER TABLE "months" ADD COLUMN "usd_rate" bigint DEFAULT 33000 NOT NULL;--> statement-breakpoint
ALTER TABLE "captured_messages" ADD CONSTRAINT "captured_messages_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "captured_messages_status_idx" ON "captured_messages" USING btree ("status","received_at");--> statement-breakpoint
ALTER TABLE "months" ADD CONSTRAINT "months_usd_rate_positive" CHECK (usd_rate > 0);