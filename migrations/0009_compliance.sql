CREATE TABLE "hr_compliance_profile" (
	"id" serial PRIMARY KEY NOT NULL,
	"settings" jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_compliance_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_key" text NOT NULL,
	"period" text NOT NULL,
	"status" text NOT NULL,
	"done_on" date,
	"note" text,
	"by_email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "hr_compliance_task_uq" ON "hr_compliance_tasks" USING btree ("item_key","period");