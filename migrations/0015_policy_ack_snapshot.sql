ALTER TABLE "hr_policy_acks" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "hr_policy_acks" ADD COLUMN "values" jsonb;