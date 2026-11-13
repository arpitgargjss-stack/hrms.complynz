CREATE TABLE "hr_acceptance_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"letter_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"recipient_email_hash" text NOT NULL,
	"recipient_email" text NOT NULL,
	"otp_hash" text,
	"otp_expires_at" timestamp with time zone,
	"otp_attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_acceptance_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "hr_announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"kind" text DEFAULT 'news' NOT NULL,
	"pinned" boolean DEFAULT false,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_asset_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"issued_on" date NOT NULL,
	"returned_on" date,
	"condition_on_issue" text,
	"condition_on_return" text,
	"contract_letter_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tag" text NOT NULL,
	"category" text NOT NULL,
	"model" text,
	"serial_no" text,
	"cost_paise" integer,
	"purchased_on" date,
	"condition" text DEFAULT 'good',
	"accessories" jsonb,
	"status" text DEFAULT 'in_stock' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_assets_tag_unique" UNIQUE("tag")
);
--> statement-breakpoint
CREATE TABLE "hr_attendance_punches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"work_date" date NOT NULL,
	"within_office" boolean,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "hr_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_email" text NOT NULL,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"detail" jsonb
);
--> statement-breakpoint
CREATE TABLE "hr_bank_advices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"ref_no" text NOT NULL,
	"total_paise" integer NOT NULL,
	"row_count" integer NOT NULL,
	"content_hash" text NOT NULL,
	"signed_by" text,
	"signed_at" timestamp with time zone,
	"pdf_file_id" uuid,
	"rows" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_bank_advices_ref_no_unique" UNIQUE("ref_no")
);
--> statement-breakpoint
CREATE TABLE "hr_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"position" text,
	"department_id" uuid,
	"status" text DEFAULT 'new' NOT NULL,
	"expected_joining" date,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_compensation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"monthly_gross_paise" integer NOT NULL,
	"template_id" uuid,
	"components" jsonb NOT NULL,
	"reason" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_consent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_id" text NOT NULL,
	"purpose_key" text NOT NULL,
	"status" text NOT NULL,
	"notice_version" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_departments_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "hr_designations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"level" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_designations_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "hr_email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_email_templates_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "hr_employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"clerk_user_id" text,
	"work_email" text NOT NULL,
	"full_name" text NOT NULL,
	"personal_email" text,
	"phone" text,
	"dob" date,
	"gender" text,
	"joining_date" date NOT NULL,
	"department_id" uuid,
	"designation_id" uuid,
	"location_id" uuid,
	"manager_id" uuid,
	"employment_type" text DEFAULT 'full_time',
	"status" text DEFAULT 'active' NOT NULL,
	"last_working_day" date,
	"pan_enc" text,
	"bank_name" text,
	"account_enc" text,
	"ifsc" text,
	"photo_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_employees_code_unique" UNIQUE("code"),
	CONSTRAINT "hr_employees_work_email_unique" UNIQUE("work_email")
);
--> statement-breakpoint
CREATE TABLE "hr_esat_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"questions" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_esat_participation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"marker_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_esat_responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"answers" jsonb NOT NULL,
	"submitted_day" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"owner_employee_id" uuid,
	"original_name" text NOT NULL,
	"mime" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"storage_key" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"optional" boolean DEFAULT false
);
--> statement-breakpoint
CREATE TABLE "hr_leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"from_date" date NOT NULL,
	"to_date" date NOT NULL,
	"half_day" boolean DEFAULT false,
	"days_x2" integer NOT NULL,
	"reason" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_leave_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"annual_quota_half_days" integer NOT NULL,
	"carry_forward_half_days" integer DEFAULT 0 NOT NULL,
	"paid" boolean DEFAULT true,
	"accrual" text DEFAULT 'monthly' NOT NULL,
	"requires_note" boolean DEFAULT false,
	"active" boolean DEFAULT true,
	CONSTRAINT "hr_leave_types_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "hr_letters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"ref_no" text NOT NULL,
	"employee_id" uuid,
	"candidate_id" uuid,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"pdf_file_id" uuid,
	"issued_by" text,
	"issued_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_letters_ref_no_unique" UNIQUE("ref_no")
);
--> statement-breakpoint
CREATE TABLE "hr_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"address" text,
	"lat" text,
	"lng" text,
	"radius_m" integer DEFAULT 150,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_locations_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "hr_manager_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"from_manager_id" uuid,
	"to_manager_id" uuid,
	"effective_from" date NOT NULL,
	"reason" text,
	"changed_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_onboarding_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"candidate_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"steps" jsonb NOT NULL,
	"submitted" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_onboarding_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "hr_payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"month" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"rules_snapshot" jsonb NOT NULL,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_payroll_runs_month_unique" UNIQUE("month")
);
--> statement-breakpoint
CREATE TABLE "hr_payslips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"paid_days_x2" integer NOT NULL,
	"calendar_days" integer NOT NULL,
	"result" jsonb NOT NULL,
	"net_pay_paise" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_pips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"length_days" integer NOT NULL,
	"concerns" text NOT NULL,
	"goals" jsonb NOT NULL,
	"support" text,
	"checkpoints" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"outcome" text,
	"acknowledged_at" timestamp with time zone,
	"employee_response" text,
	"issued_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_policies_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "hr_policy_acks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"employee_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_policy_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"policy_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"html" text NOT NULL,
	"published_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_reimb_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"month" text NOT NULL,
	"category" text NOT NULL,
	"mode" text,
	"description" text,
	"distance_km" integer,
	"amount_paise" integer NOT NULL,
	"expense_date" date NOT NULL,
	"bill_file_id" uuid,
	"status" text DEFAULT 'submitted' NOT NULL,
	"policy_flags" jsonb,
	"verified_by" text,
	"approved_by" text,
	"decision_note" text,
	"paid_in_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_reimbursement_policy" (
	"id" serial PRIMARY KEY NOT NULL,
	"settings" jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_resignations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"notice_days" integer,
	"proposed_last_day" date NOT NULL,
	"agreed_last_day" date,
	"reason" text NOT NULL,
	"comments" text,
	"status" text DEFAULT 'submitted' NOT NULL,
	"manager_note" text,
	"accepted_by" text,
	"checklist" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_salary_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"components" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_salary_templates_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "hr_signatories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"designation" text NOT NULL,
	"signature_file_id" uuid,
	"stamp_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hr_signatories_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "hr_statutory_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"effective_from" date NOT NULL,
	"rules" jsonb NOT NULL,
	"source" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"body" text NOT NULL,
	"reply_code_hash" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"reply" text,
	"created_day" date NOT NULL,
	CONSTRAINT "hr_suggestions_reply_code_hash_unique" UNIQUE("reply_code_hash")
);
--> statement-breakpoint
CREATE TABLE "hr_user_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hr_work_calendar" (
	"id" serial PRIMARY KEY NOT NULL,
	"settings" jsonb NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "hr_acceptance_links" ADD CONSTRAINT "hr_acceptance_links_letter_id_hr_letters_id_fk" FOREIGN KEY ("letter_id") REFERENCES "public"."hr_letters"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_bank_advices" ADD CONSTRAINT "hr_bank_advices_run_id_hr_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."hr_payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_compensation" ADD CONSTRAINT "hr_compensation_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_compensation" ADD CONSTRAINT "hr_compensation_template_id_hr_salary_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."hr_salary_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_department_id_hr_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."hr_departments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_designation_id_hr_designations_id_fk" FOREIGN KEY ("designation_id") REFERENCES "public"."hr_designations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_employees" ADD CONSTRAINT "hr_employees_location_id_hr_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."hr_locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payslips" ADD CONSTRAINT "hr_payslips_run_id_hr_payroll_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."hr_payroll_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hr_payslips" ADD CONSTRAINT "hr_payslips_employee_id_hr_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."hr_employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "hr_punch_emp_date" ON "hr_attendance_punches" USING btree ("employee_id","work_date");--> statement-breakpoint
CREATE INDEX "hr_audit_entity" ON "hr_audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "hr_comp_emp" ON "hr_compensation" USING btree ("employee_id","effective_from");--> statement-breakpoint
CREATE INDEX "hr_consent_subject" ON "hr_consent_events" USING btree ("subject_id","purpose_key");--> statement-breakpoint
CREATE INDEX "hr_emp_manager" ON "hr_employees" USING btree ("manager_id");--> statement-breakpoint
CREATE INDEX "hr_emp_status" ON "hr_employees" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_esat_part_uq" ON "hr_esat_participation" USING btree ("cycle_id","marker_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_holiday_uq" ON "hr_holidays" USING btree ("date");--> statement-breakpoint
CREATE INDEX "hr_leave_emp" ON "hr_leave_requests" USING btree ("employee_id","from_date");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_payslip_uq" ON "hr_payslips" USING btree ("run_id","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_policy_ack_uq" ON "hr_policy_acks" USING btree ("policy_id","version","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_policy_ver_uq" ON "hr_policy_versions" USING btree ("policy_id","version");--> statement-breakpoint
CREATE INDEX "hr_claim_emp_month" ON "hr_reimb_claims" USING btree ("employee_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "hr_user_roles_uq" ON "hr_user_roles" USING btree ("email","role");