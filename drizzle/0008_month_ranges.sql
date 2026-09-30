ALTER TABLE "months" ALTER COLUMN "starts_on" DROP EXPRESSION;--> statement-breakpoint
ALTER TABLE "months" ADD COLUMN "ends_on" date;--> statement-breakpoint
-- Existing months are calendar months: they end where the next month begins.
UPDATE "months" SET "ends_on" = ("starts_on" + interval '1 month')::date;--> statement-breakpoint
ALTER TABLE "months" ALTER COLUMN "ends_on" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "settings" ADD COLUMN "period_start_day" smallint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "months" ADD CONSTRAINT "months_range" CHECK (ends_on > starts_on);--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_period_start_day" CHECK (period_start_day between 1 and 28);
