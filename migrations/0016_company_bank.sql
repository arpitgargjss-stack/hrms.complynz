CREATE TABLE "hr_company_bank" (
	"id" serial PRIMARY KEY NOT NULL,
	"bank_name" text NOT NULL,
	"branch" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"ifsc" text DEFAULT '' NOT NULL,
	"account_enc" text,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
