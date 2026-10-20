ALTER TABLE "settings" ADD COLUMN "message_senders" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
-- Start with the two banks whose texts the iPhone automation forwards.
UPDATE "settings" SET "message_senders" = ARRAY['COMBANK', 'Amana Bank'];
