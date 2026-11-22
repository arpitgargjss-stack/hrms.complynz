CREATE TABLE "hr_org_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" text NOT NULL,
	"employee_id" uuid,
	"name" text NOT NULL,
	"email" text,
	"phone" text,
	"designation" text,
	"organisation" text,
	"gender" text DEFAULT 'undisclosed' NOT NULL,
	"term_start" date,
	"term_end" date,
	"position" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "hr_org_roles_role" ON "hr_org_roles" USING btree ("role");