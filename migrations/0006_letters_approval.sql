CREATE TABLE "hr_company_profile" (
	"id" serial PRIMARY KEY NOT NULL,
	"settings" jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hr_letters" ADD COLUMN "created_by" text;--> statement-breakpoint
ALTER TABLE "hr_letters" ADD COLUMN "submitted_by" text;--> statement-breakpoint
ALTER TABLE "hr_letters" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hr_letters" ADD COLUMN "approved_by" text;--> statement-breakpoint
ALTER TABLE "hr_letters" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "hr_letters" ADD COLUMN "review_note" text;