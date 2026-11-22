ALTER TABLE "hr_policies" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "hr_policies" ADD COLUMN "kind" text DEFAULT 'html' NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_policy_versions" ADD COLUMN "status" text DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "hr_policy_versions" ADD COLUMN "template" text;--> statement-breakpoint
ALTER TABLE "hr_policy_versions" ADD COLUMN "values" jsonb;--> statement-breakpoint
ALTER TABLE "hr_policy_versions" ADD COLUMN "file_id" uuid;--> statement-breakpoint
ALTER TABLE "hr_policy_versions" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "hr_policy_versions" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "hr_policy_versions" ADD COLUMN "submitted_by" text;--> statement-breakpoint
ALTER TABLE "hr_policy_versions" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hr_policy_versions" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "hr_policy_versions" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hr_policy_versions" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "hr_policy_versions" ADD COLUMN "published_at" timestamp with time zone;