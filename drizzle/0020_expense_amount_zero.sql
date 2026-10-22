ALTER TABLE "expenses" DROP CONSTRAINT "expenses_amount_positive";--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_nonnegative" CHECK (amount >= 0);