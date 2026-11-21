CREATE TABLE "hr_feed_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"audience" text NOT NULL,
	"department_id" uuid,
	"quote" text,
	"source" text,
	"url" text,
	"title" text,
	"note" text,
	"consent_event_id" uuid,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_feed_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_kudos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_employee_id" uuid NOT NULL,
	"to_employee_id" uuid NOT NULL,
	"value" text NOT NULL,
	"message" text NOT NULL,
	"consent_event_id" uuid,
	"hidden_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_kudos_reactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kudos_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_pulse_participation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week" text NOT NULL,
	"marker_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_pulse_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"week" text NOT NULL,
	"department_id" uuid,
	"mood" integer NOT NULL,
	"submitted_day" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_vibe_sections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"section_key" text NOT NULL,
	"content" jsonb NOT NULL,
	"audience" text DEFAULT 'only_me' NOT NULL,
	"consent_event_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hr_consent_events" ADD COLUMN "detail" jsonb;--> statement-breakpoint
ALTER TABLE "hr_feed_posts" ADD CONSTRAINT "hr_feed_posts_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_feed_reactions" ADD CONSTRAINT "hr_feed_reactions_post_id_hr_feed_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."hr_feed_posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_kudos" ADD CONSTRAINT "hr_kudos_from_employee_id_hr_employees_id_fk" FOREIGN KEY ("from_employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_kudos" ADD CONSTRAINT "hr_kudos_to_employee_id_hr_employees_id_fk" FOREIGN KEY ("to_employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_kudos_reactions" ADD CONSTRAINT "hr_kudos_reactions_kudos_id_hr_kudos_id_fk" FOREIGN KEY ("kudos_id") REFERENCES "public"."hr_kudos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_vibe_sections" ADD CONSTRAINT "hr_vibe_sections_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hr_feed_created" ON "hr_feed_posts" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_feed_reaction_uq" ON "hr_feed_reactions" USING btree ("post_id","employee_id","kind");--> statement-breakpoint
CREATE INDEX "hr_kudos_to" ON "hr_kudos" USING btree ("to_employee_id");--> statement-breakpoint
CREATE INDEX "hr_kudos_created" ON "hr_kudos" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_kudos_reaction_uq" ON "hr_kudos_reactions" USING btree ("kudos_id","employee_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_pulse_part_uq" ON "hr_pulse_participation" USING btree ("week","marker_hash");--> statement-breakpoint
CREATE INDEX "hr_pulse_week" ON "hr_pulse_responses" USING btree ("week","department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_vibe_section_uq" ON "hr_vibe_sections" USING btree ("employee_id","section_key");