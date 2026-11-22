CREATE TABLE "hr_care_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_id" uuid NOT NULL,
	"counsellor_id" uuid NOT NULL,
	"with_whom" text NOT NULL,
	"mode" text NOT NULL,
	"preferred_when" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'requested' NOT NULL,
	"scheduled_for" timestamp with time zone,
	"reply" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "hr_pulse_responses" ADD COLUMN "stress" integer;--> statement-breakpoint
ALTER TABLE "hr_pulse_responses" ADD COLUMN "motivation" integer;--> statement-breakpoint
CREATE INDEX "hr_care_requester" ON "hr_care_requests" USING btree ("requester_id");--> statement-breakpoint
CREATE INDEX "hr_care_counsellor" ON "hr_care_requests" USING btree ("counsellor_id");