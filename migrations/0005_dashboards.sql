CREATE TABLE "hr_login_days" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"day" date NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hr_resignations" ADD COLUMN "reason_category" text;--> statement-breakpoint
CREATE UNIQUE INDEX "hr_login_day_uq" ON "hr_login_days" USING btree ("employee_id","day");--> statement-breakpoint
CREATE INDEX "hr_login_day" ON "hr_login_days" USING btree ("day");