import { pgTable, uuid, text, integer, boolean, timestamp, date, jsonb, index, uniqueIndex, serial } from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// ---------- access ----------
/** Elevated roles only. Everyone with a staff login is a team member; managers derive from reporting lines. */
export const userRoles = pgTable("hr_user_roles", {
  id: id(), email: text("email").notNull(), role: text("role").notNull(), // super_admin | hr_admin | finance_signatory
  createdAt: created(),
}, (t) => [uniqueIndex("hr_user_roles_uq").on(t.email, t.role)]);

export const auditLog = pgTable("hr_audit_log", {
  id: id(), at: created(), actorEmail: text("actor_email").notNull(), action: text("action").notNull(),
  entityType: text("entity_type"), entityId: text("entity_id"), detail: jsonb("detail"),
}, (t) => [index("hr_audit_entity").on(t.entityType, t.entityId)]);

// ---------- organisation ----------
export const departments = pgTable("hr_departments", { id: id(), name: text("name").notNull().unique(), createdAt: created() });
export const designations = pgTable("hr_designations", { id: id(), name: text("name").notNull().unique(), level: integer("level").default(0), createdAt: created() });
export const locations = pgTable("hr_locations", {
  id: id(), name: text("name").notNull().unique(), address: text("address"),
  lat: text("lat"), lng: text("lng"), radiusM: integer("radius_m").default(150), // office geofence, used only for the inside/outside check
  createdAt: created(),
});

export const employees = pgTable("hr_employees", {
  id: id(), code: text("code").notNull().unique(), // CMPZ###
  clerkUserId: text("clerk_user_id"), workEmail: text("work_email").notNull().unique(),
  fullName: text("full_name").notNull(), personalEmail: text("personal_email"), phone: text("phone"),
  dob: date("dob"), gender: text("gender"), joiningDate: date("joining_date").notNull(),
  departmentId: uuid("department_id").references(() => departments.id),
  designationId: uuid("designation_id").references(() => designations.id),
  locationId: uuid("location_id").references(() => locations.id),
  managerId: uuid("manager_id"), employmentType: text("employment_type").default("full_time"),
  status: text("status").notNull().default("active"), // active | notice | exited
  lastWorkingDay: date("last_working_day"),
  panEnc: text("pan_enc"), // AES-GCM encrypted; needed for TDS
  bankName: text("bank_name"), accountEnc: text("account_enc"), ifsc: text("ifsc"),
  photoFileId: uuid("photo_file_id"),
  createdAt: created(),
}, (t) => [index("hr_emp_manager").on(t.managerId), index("hr_emp_status").on(t.status)]);

export const managerChanges = pgTable("hr_manager_changes", {
  id: id(), employeeId: uuid("employee_id").notNull(), fromManagerId: uuid("from_manager_id"), toManagerId: uuid("to_manager_id"),
  effectiveFrom: date("effective_from").notNull(), reason: text("reason"), changedBy: text("changed_by").notNull(), createdAt: created(),
});

export const files = pgTable("hr_files", {
  id: id(), kind: text("kind").notNull(), // pan | aadhaar | photo | stamp | signature | bill | policy | letter | other
  ownerEmployeeId: uuid("owner_employee_id"), originalName: text("original_name").notNull(), mime: text("mime").notNull(),
  sizeBytes: integer("size_bytes").notNull(), sha256: text("sha256").notNull(), storageKey: text("storage_key").notNull(),
  uploadedBy: text("uploaded_by").notNull(), createdAt: created(),
});

// ---------- payroll ----------
export const statutoryRules = pgTable("hr_statutory_rules", {
  id: id(), effectiveFrom: date("effective_from").notNull(), rules: jsonb("rules").notNull(),
  source: text("source"), // where the admin confirmed these values
  createdBy: text("created_by").notNull(), createdAt: created(),
});
export const salaryTemplates = pgTable("hr_salary_templates", {
  id: id(), name: text("name").notNull().unique(), components: jsonb("components").notNull(), createdAt: created(),
});
export const compensation = pgTable("hr_compensation", {
  id: id(), employeeId: uuid("employee_id").notNull().references(() => employees.id),
  effectiveFrom: date("effective_from").notNull(), monthlyGrossPaise: integer("monthly_gross_paise").notNull(),
  templateId: uuid("template_id").references(() => salaryTemplates.id), components: jsonb("components").notNull(),
  reason: text("reason"), createdBy: text("created_by").notNull(), createdAt: created(),
}, (t) => [index("hr_comp_emp").on(t.employeeId, t.effectiveFrom)]);

export const payrollRuns = pgTable("hr_payroll_runs", {
  id: id(), month: text("month").notNull().unique(), // YYYY-MM
  status: text("status").notNull().default("draft"), // draft | locked | paid
  rulesSnapshot: jsonb("rules_snapshot").notNull(), lockedBy: text("locked_by"), lockedAt: timestamp("locked_at", { withTimezone: true }),
  createdBy: text("created_by").notNull(), createdAt: created(),
});
export const payslips = pgTable("hr_payslips", {
  id: id(), runId: uuid("run_id").notNull().references(() => payrollRuns.id), employeeId: uuid("employee_id").notNull().references(() => employees.id),
  paidDays: integer("paid_days_x2").notNull(), calendarDays: integer("calendar_days").notNull(), // paid days stored in half-days
  result: jsonb("result").notNull(), netPayPaise: integer("net_pay_paise").notNull(), createdAt: created(),
}, (t) => [uniqueIndex("hr_payslip_uq").on(t.runId, t.employeeId)]);

export const signatories = pgTable("hr_signatories", {
  id: id(), email: text("email").notNull().unique(), displayName: text("display_name").notNull(), designation: text("designation").notNull(),
  signatureFileId: uuid("signature_file_id"), stampFileId: uuid("stamp_file_id"), createdAt: created(),
});
export const bankAdvices = pgTable("hr_bank_advices", {
  id: id(), runId: uuid("run_id").notNull().references(() => payrollRuns.id), refNo: text("ref_no").notNull().unique(),
  totalPaise: integer("total_paise").notNull(), rowCount: integer("row_count").notNull(), contentHash: text("content_hash").notNull(),
  signedBy: text("signed_by"), signedAt: timestamp("signed_at", { withTimezone: true }), pdfFileId: uuid("pdf_file_id"),
  rows: jsonb("rows").notNull(), createdBy: text("created_by").notNull(), createdAt: created(),
});

// ---------- letters, hiring, onboarding ----------
export const candidates = pgTable("hr_candidates", {
  id: id(), fullName: text("full_name").notNull(), email: text("email").notNull(), phone: text("phone"),
  position: text("position"), departmentId: uuid("department_id"), status: text("status").notNull().default("new"), // new|offered|accepted|joined|declined
  expectedJoining: date("expected_joining"), createdBy: text("created_by").notNull(), createdAt: created(),
});
export const letters = pgTable("hr_letters", {
  id: id(), type: text("type").notNull(), // offer_short | offer_full | appointment | appraisal | experience | relieving | pip | asset_contract
  refNo: text("ref_no").notNull().unique(), employeeId: uuid("employee_id"), candidateId: uuid("candidate_id"),
  payload: jsonb("payload").notNull(), status: text("status").notNull().default("draft"), // draft|issued|accepted|void
  pdfFileId: uuid("pdf_file_id"), issuedBy: text("issued_by"), issuedAt: timestamp("issued_at", { withTimezone: true }), createdAt: created(),
});
/** Public acceptance link. Only the token hash is stored; OTP codes are hashed and expire. */
export const acceptanceLinks = pgTable("hr_acceptance_links", {
  id: id(), letterId: uuid("letter_id").notNull().references(() => letters.id), tokenHash: text("token_hash").notNull().unique(),
  recipientEmailHash: text("recipient_email_hash").notNull(), recipientEmail: text("recipient_email").notNull(),
  otpHash: text("otp_hash"), otpExpiresAt: timestamp("otp_expires_at", { withTimezone: true }), otpAttempts: integer("otp_attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  contentHash: text("content_hash"), createdAt: created(),
});
export const onboardingLinks = pgTable("hr_onboarding_links", {
  id: id(), candidateId: uuid("candidate_id").notNull(), tokenHash: text("token_hash").notNull().unique(),
  steps: jsonb("steps").notNull(), submitted: jsonb("submitted"), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }), createdAt: created(),
});
export const emailTemplates = pgTable("hr_email_templates", {
  id: id(), key: text("key").notNull().unique(), subject: text("subject").notNull(), body: text("body").notNull(), updatedAt: created(),
});
export const announcements = pgTable("hr_announcements", {
  id: id(), title: text("title").notNull(), body: text("body").notNull(), kind: text("kind").notNull().default("news"), // news|update|event
  pinned: boolean("pinned").default(false), createdBy: text("created_by").notNull(), createdAt: created(),
});

// ---------- policies and consent ----------
export const policies = pgTable("hr_policies", {
  id: id(), slug: text("slug").notNull().unique(), title: text("title").notNull(), currentVersion: integer("current_version").notNull().default(1), createdAt: created(),
});
export const policyVersions = pgTable("hr_policy_versions", {
  id: id(), policyId: uuid("policy_id").notNull(), version: integer("version").notNull(), html: text("html").notNull(),
  publishedBy: text("published_by").notNull(), createdAt: created(),
}, (t) => [uniqueIndex("hr_policy_ver_uq").on(t.policyId, t.version)]);
export const policyAcks = pgTable("hr_policy_acks", {
  id: id(), policyId: uuid("policy_id").notNull(), version: integer("version").notNull(), employeeId: uuid("employee_id").notNull(), at: created(),
}, (t) => [uniqueIndex("hr_policy_ack_uq").on(t.policyId, t.version, t.employeeId)]);

/** Local ledger of consent events. The CMP stays the system of record; the subject is an opaque id, never the email. */
export const consentEvents = pgTable("hr_consent_events", {
  id: id(), subjectId: text("subject_id").notNull(), purposeKey: text("purpose_key").notNull(), status: text("status").notNull(), // granted|withdrawn
  noticeVersion: text("notice_version").notNull(), source: text("source").notNull(), at: created(),
}, (t) => [index("hr_consent_subject").on(t.subjectId, t.purposeKey)]);

// ---------- assets ----------
export const assets = pgTable("hr_assets", {
  id: id(), tag: text("tag").notNull().unique(), category: text("category").notNull(), model: text("model"), serialNo: text("serial_no"),
  costPaise: integer("cost_paise"), purchasedOn: date("purchased_on"), condition: text("condition").default("good"),
  accessories: jsonb("accessories"), status: text("status").notNull().default("in_stock"), // in_stock|assigned|repair|retired
  createdAt: created(),
});
export const assetAssignments = pgTable("hr_asset_assignments", {
  id: id(), assetId: uuid("asset_id").notNull(), employeeId: uuid("employee_id").notNull(), issuedOn: date("issued_on").notNull(),
  returnedOn: date("returned_on"), conditionOnIssue: text("condition_on_issue"), conditionOnReturn: text("condition_on_return"),
  contractLetterId: uuid("contract_letter_id"), createdAt: created(),
});

// ---------- time and leave ----------
export const attendancePunches = pgTable("hr_attendance_punches", {
  id: id(), employeeId: uuid("employee_id").notNull(), kind: text("kind").notNull(), // in | out
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(), workDate: date("work_date").notNull(),
  withinOffice: boolean("within_office"), // inside/outside only; coordinates are never stored
  note: text("note"),
}, (t) => [index("hr_punch_emp_date").on(t.employeeId, t.workDate)]);
export const workCalendar = pgTable("hr_work_calendar", {
  id: serial("id").primaryKey(), settings: jsonb("settings").notNull(), // {workStart, workEnd, weeklyOff:[0], saturdays:{type:'alternate'|'all_working'|'all_off', offWeeks:[2,4]}}
  updatedBy: text("updated_by").notNull(), updatedAt: created(),
});
export const holidays = pgTable("hr_holidays", {
  id: id(), date: date("date").notNull(), name: text("name").notNull(), optional: boolean("optional").default(false),
}, (t) => [uniqueIndex("hr_holiday_uq").on(t.date)]);
export const leaveTypes = pgTable("hr_leave_types", {
  id: id(), key: text("key").notNull().unique(), name: text("name").notNull(), annualQuotaHalfDays: integer("annual_quota_half_days").notNull(),
  carryForwardHalfDays: integer("carry_forward_half_days").notNull().default(0), paid: boolean("paid").default(true),
  accrual: text("accrual").notNull().default("monthly"), // upfront | monthly
  requiresNote: boolean("requires_note").default(false), active: boolean("active").default(true),
});
export const leaveRequests = pgTable("hr_leave_requests", {
  id: id(), employeeId: uuid("employee_id").notNull(), leaveTypeId: uuid("leave_type_id").notNull(),
  fromDate: date("from_date").notNull(), toDate: date("to_date").notNull(), halfDay: boolean("half_day").default(false),
  days2: integer("days_x2").notNull(), // working days in half-days
  reason: text("reason"), status: text("status").notNull().default("pending"), // pending|approved|rejected|cancelled
  decidedBy: text("decided_by"), decidedAt: timestamp("decided_at", { withTimezone: true }), decisionNote: text("decision_note"), createdAt: created(),
}, (t) => [index("hr_leave_emp").on(t.employeeId, t.fromDate)]);

// ---------- reimbursements ----------
export const reimbursementPolicy = pgTable("hr_reimbursement_policy", {
  id: serial("id").primaryKey(), settings: jsonb("settings").notNull(), updatedBy: text("updated_by").notNull(), updatedAt: created(),
});
export const reimbClaims = pgTable("hr_reimb_claims", {
  id: id(), employeeId: uuid("employee_id").notNull(), month: text("month").notNull(), category: text("category").notNull(), // travel|expense|technology
  mode: text("mode"), description: text("description"), distanceKm: integer("distance_km"), amountPaise: integer("amount_paise").notNull(),
  expenseDate: date("expense_date").notNull(), billFileId: uuid("bill_file_id"),
  status: text("status").notNull().default("submitted"), // submitted|verified|manager_approved|approved|rejected|paid
  policyFlags: jsonb("policy_flags"), verifiedBy: text("verified_by"), approvedBy: text("approved_by"), decisionNote: text("decision_note"),
  paidInRunId: uuid("paid_in_run_id"), createdAt: created(),
}, (t) => [index("hr_claim_emp_month").on(t.employeeId, t.month)]);

// ---------- exits and performance ----------
export const resignations = pgTable("hr_resignations", {
  id: id(), employeeId: uuid("employee_id").notNull(), noticeDays: integer("notice_days"), proposedLastDay: date("proposed_last_day").notNull(),
  agreedLastDay: date("agreed_last_day"), reason: text("reason").notNull(), comments: text("comments"),
  status: text("status").notNull().default("submitted"), // submitted|manager_reviewed|accepted|withdrawn|completed
  managerNote: text("manager_note"), acceptedBy: text("accepted_by"), checklist: jsonb("checklist"), createdAt: created(),
});
export const pips = pgTable("hr_pips", {
  id: id(), employeeId: uuid("employee_id").notNull(), startDate: date("start_date").notNull(), lengthDays: integer("length_days").notNull(),
  concerns: text("concerns").notNull(), goals: jsonb("goals").notNull(), support: text("support"), checkpoints: jsonb("checkpoints"),
  status: text("status").notNull().default("active"), // active|completed|extended|closed
  outcome: text("outcome"), acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }), employeeResponse: text("employee_response"),
  issuedBy: text("issued_by").notNull(), createdAt: created(),
});

// ---------- feedback (anonymous: no identity columns by design) ----------
export const esatCycles = pgTable("hr_esat_cycles", { id: id(), title: text("title").notNull(), questions: jsonb("questions").notNull(), status: text("status").notNull().default("open"), createdAt: created() });
export const esatResponses = pgTable("hr_esat_responses", {
  id: id(), cycleId: uuid("cycle_id").notNull(), answers: jsonb("answers").notNull(),
  // no employee id, email, ip or user agent. Timestamp is bucketed to the day to resist correlation.
  submittedDay: date("submitted_day").notNull(),
});
/** One-way participation marker so each person answers once, kept separate from answers and not joinable to them. */
export const esatParticipation = pgTable("hr_esat_participation", {
  id: id(), cycleId: uuid("cycle_id").notNull(), markerHash: text("marker_hash").notNull(),
}, (t) => [uniqueIndex("hr_esat_part_uq").on(t.cycleId, t.markerHash)]);
export const suggestions = pgTable("hr_suggestions", {
  id: id(), body: text("body").notNull(), replyCodeHash: text("reply_code_hash").notNull().unique(),
  status: text("status").notNull().default("new"), reply: text("reply"), createdDay: date("created_day").notNull(),
});
