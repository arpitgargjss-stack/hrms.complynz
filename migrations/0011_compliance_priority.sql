CREATE TABLE "hr_compliance_priority" (
	"item_key" text PRIMARY KEY NOT NULL,
	"priority" text NOT NULL,
	"by_email" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
