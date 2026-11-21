CREATE TABLE "hr_fnf_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"settings" jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_fnf_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"inputs" jsonb NOT NULL,
	"result" jsonb NOT NULL,
	"rules" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"letter_id" uuid,
	"paid_on" date,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "hr_fnf_emp" ON "hr_fnf_settlements" USING btree ("employee_id");