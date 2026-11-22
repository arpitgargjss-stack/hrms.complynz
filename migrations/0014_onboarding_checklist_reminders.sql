CREATE TABLE "hr_onboarding_checklist" (
	"id" serial PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"items" jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_policy_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"employee_id" uuid NOT NULL,
	"sent_by" text NOT NULL,
	"emailed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hr_onboarding_links" ADD COLUMN "checklist" jsonb;--> statement-breakpoint
CREATE INDEX "hr_policy_rem_emp" ON "hr_policy_reminders" USING btree ("employee_id");