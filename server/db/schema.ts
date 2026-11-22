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
  isRemote: boolean("is_remote").notNull().default(false), // remote: punches are recorded but no geofence check and no location prompt
  state: text("state"), // Indian state or union territory; drives professional tax and state compliance
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
  // Self-service profile details, asked for in the first-login "complete your profile" step.
  currentAddress: text("current_address"),
  emergencyContactName: text("emergency_contact_name"), emergencyContactRelation: text("emergency_contact_relation"), emergencyContactPhone: text("emergency_contact_phone"),
  profileCompletedAt: timestamp("profile_completed_at", { withTimezone: true }),
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
/** The company's own salary (debit) account, printed on bank advices. A new row per change; the latest row is current. The account number is encrypted. */
export const companyBank = pgTable("hr_company_bank", {
  id: serial("id").primaryKey(), bankName: text("bank_name").notNull(), branch: text("branch").notNull().default(""), city: text("city").notNull().default(""),
  ifsc: text("ifsc").notNull().default(""), accountEnc: text("account_enc"), updatedBy: text("updated_by").notNull(), updatedAt: created(),
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
  // CEO approval: draft -> pending_approval -> approved -> issued. A rejection returns it to draft with a note.
  createdBy: text("created_by"), submittedBy: text("submitted_by"), submittedAt: timestamp("submitted_at", { withTimezone: true }),
  approvedBy: text("approved_by"), approvedAt: timestamp("approved_at", { withTimezone: true }), reviewNote: text("review_note"),
});
/** Company details printed on letters (one row). */
export const companyProfile = pgTable("hr_company_profile", {
  id: serial("id").primaryKey(), settings: jsonb("settings").notNull(), updatedBy: text("updated_by").notNull(), updatedAt: created(),
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
  checklist: jsonb("checklist"), // copy of the default onboarding checklist at the time the link was created (version, items, done flags)
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
  // Admin configuration phase 2. current_version is the published version employees see and acknowledge (0 = never published).
  category: text("category"), kind: text("kind").notNull().default("html"), // html (template with placeholders) | pdf (view and acknowledge only)
});
/**
 * One row per version. Drafts move draft → pending_approval → approved → published (CEO approval, as for letters).
 * A published row is frozen: `template` and `values` record exactly what was filled in, `html` is the rendered result.
 */
export const policyVersions = pgTable("hr_policy_versions", {
  id: id(), policyId: uuid("policy_id").notNull(), version: integer("version").notNull(), html: text("html").notNull(),
  publishedBy: text("published_by").notNull(), createdAt: created(),
  status: text("status").notNull().default("published"), template: text("template"), values: jsonb("values"), fileId: uuid("file_id"), summary: text("summary"),
  createdBy: text("created_by"), submittedBy: text("submitted_by"), submittedAt: timestamp("submitted_at", { withTimezone: true }),
  approvedBy: text("approved_by"), approvedAt: timestamp("approved_at", { withTimezone: true }), reviewNote: text("review_note"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
}, (t) => [uniqueIndex("hr_policy_ver_uq").on(t.policyId, t.version)]);
export const policyAcks = pgTable("hr_policy_acks", {
  id: id(), policyId: uuid("policy_id").notNull(), version: integer("version").notNull(), employeeId: uuid("employee_id").notNull(), at: created(),
  // What the person saw when they acknowledged: values are filled in live, so keep the values and a hash of the rendered text.
  contentHash: text("content_hash"), values: jsonb("values"),
}, (t) => [uniqueIndex("hr_policy_ack_uq").on(t.policyId, t.version, t.employeeId)]);

/** Local ledger of consent events. The CMP stays the system of record; the subject is an opaque id, never the email. */
export const consentEvents = pgTable("hr_consent_events", {
  id: id(), subjectId: text("subject_id").notNull(), purposeKey: text("purpose_key").notNull(), status: text("status").notNull(), // granted|withdrawn
  noticeVersion: text("notice_version").notNull(), source: text("source").notNull(), at: created(),
  detail: jsonb("detail"), // receipt context: audience, others confirmed, post id. Never personal content.
}, (t) => [index("hr_consent_subject").on(t.subjectId, t.purposeKey)]);

// ---------- vibe pages and team feed ----------
/** One row per section a person has filled in. Who can see it also depends on the latest consent event for vibe_<section>. */
export const vibeSections = pgTable("hr_vibe_sections", {
  id: id(), employeeId: uuid("employee_id").notNull().references(() => employees.id), sectionKey: text("section_key").notNull(),
  content: jsonb("content").notNull(), audience: text("audience").notNull().default("only_me"), // only_me | team | everyone
  consentEventId: uuid("consent_event_id"), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("hr_vibe_section_uq").on(t.employeeId, t.sectionKey)]);

export const feedPosts = pgTable("hr_feed_posts", {
  id: id(), employeeId: uuid("employee_id").notNull().references(() => employees.id), kind: text("kind").notNull(), // quote | ai_news | article | linkedin
  audience: text("audience").notNull(), departmentId: uuid("department_id"), // team posts are scoped to the author's department when posted
  quote: text("quote"), source: text("source"), url: text("url"), title: text("title"), note: text("note"),
  consentEventId: uuid("consent_event_id"), deletedAt: timestamp("deleted_at", { withTimezone: true }), createdAt: created(),
}, (t) => [index("hr_feed_created").on(t.createdAt)]);
export const feedReactions = pgTable("hr_feed_reactions", {
  id: id(), postId: uuid("post_id").notNull().references(() => feedPosts.id), employeeId: uuid("employee_id").notNull(), kind: text("kind").notNull(), // clap | mind | save
  createdAt: created(),
}, (t) => [uniqueIndex("hr_feed_reaction_uq").on(t.postId, t.employeeId, t.kind)]);

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
  reasonCategory: text("reason_category"), // see RESIGNATION_REASONS; used only for aggregate trends
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

// ---------- recognition and pulse ----------
/** Public thank-yous. The recipient can hide one from the wall; the giver or HR can remove it. */
export const kudos = pgTable("hr_kudos", {
  id: id(), fromEmployeeId: uuid("from_employee_id").notNull().references(() => employees.id), toEmployeeId: uuid("to_employee_id").notNull().references(() => employees.id),
  value: text("value").notNull(), message: text("message").notNull(),
  consentEventId: uuid("consent_event_id"), hiddenAt: timestamp("hidden_at", { withTimezone: true }), deletedAt: timestamp("deleted_at", { withTimezone: true }), createdAt: created(),
}, (t) => [index("hr_kudos_to").on(t.toEmployeeId), index("hr_kudos_created").on(t.createdAt)]);
export const kudosReactions = pgTable("hr_kudos_reactions", {
  id: id(), kudosId: uuid("kudos_id").notNull().references(() => kudos.id), employeeId: uuid("employee_id").notNull(), kind: text("kind").notNull(), // clap | fire
  createdAt: created(),
}, (t) => [uniqueIndex("hr_kudos_reaction_uq").on(t.kudosId, t.employeeId, t.kind)]);

/** Weekly 1-tap mood. Anonymous like the satisfaction survey: no identity columns, day-bucketed, results only at 5+ answers. */
export const pulseResponses = pgTable("hr_pulse_responses", {
  id: id(), week: text("week").notNull(), departmentId: uuid("department_id"), mood: integer("mood").notNull(), submittedDay: date("submitted_day").notNull(),
  enjoy: integer("enjoy"), belief: integer("belief"), // earlier questions, kept for history; no longer asked
  stress: integer("stress"), motivation: integer("motivation"), // Stressometer (5 = calm) and Motivation Index, 1 to 5. `mood` is the Happy Index.
}, (t) => [index("hr_pulse_week").on(t.week, t.departmentId)]);
export const pulseParticipation = pgTable("hr_pulse_participation", {
  id: id(), week: text("week").notNull(), markerHash: text("marker_hash").notNull(),
}, (t) => [uniqueIndex("hr_pulse_part_uq").on(t.week, t.markerHash)]);

/**
 * A private 1:1 conversation ("counselling session") someone asked for with their manager or the CEO.
 * Seen only by the person who asked and the person they asked: not HR, not dashboards, not the audit log.
 * Holds no check-in answers. The asker can withdraw and erase it at any time; closed ones are erased after 90 days.
 */
export const careRequests = pgTable("hr_care_requests", {
  id: id(), requesterId: uuid("requester_id").notNull(), counsellorId: uuid("counsellor_id").notNull(),
  withWhom: text("with_whom").notNull(), // manager | ceo
  mode: text("mode").notNull(), // in_person | call | video
  preferredWhen: text("preferred_when").notNull(), note: text("note"),
  status: text("status").notNull().default("requested"), // requested | scheduled | done | cancelled
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }), reply: text("reply"),
  createdAt: created(), closedAt: timestamp("closed_at", { withTimezone: true }),
}, (t) => [index("hr_care_requester").on(t.requesterId), index("hr_care_counsellor").on(t.counsellorId)]);

// ---------- login activity (only for people who opted in to login_activity) ----------
/** One row per person per day they used the app. Kept only while consent stands; deleted on withdrawal. No times, IPs or devices. */
export const loginDays = pgTable("hr_login_days", {
  id: id(), employeeId: uuid("employee_id").notNull(), day: date("day").notNull(),
}, (t) => [uniqueIndex("hr_login_day_uq").on(t.employeeId, t.day), index("hr_login_day").on(t.day)]);

// ---------- full and final settlement ----------
export const fnfRules = pgTable("hr_fnf_rules", { id: serial("id").primaryKey(), settings: jsonb("settings").notNull(), updatedBy: text("updated_by").notNull(), updatedAt: created() });
export const fnfSettlements = pgTable("hr_fnf_settlements", {
  id: id(), employeeId: uuid("employee_id").notNull(), inputs: jsonb("inputs").notNull(), result: jsonb("result").notNull(), rules: jsonb("rules").notNull(),
  status: text("status").notNull().default("draft"), // draft | paid
  letterId: uuid("letter_id"), paidOn: date("paid_on"), createdBy: text("created_by").notNull(), createdAt: created(),
}, (t) => [index("hr_fnf_emp").on(t.employeeId)]);

/** Compliance centre: the company facts HR sets (industry, DPIIT, FDI and so on) and what has been done for each due period. */
export const complianceProfile = pgTable("hr_compliance_profile", { id: serial("id").primaryKey(), settings: jsonb("settings").notNull(), updatedBy: text("updated_by").notNull(), updatedAt: created() });
export const complianceTasks = pgTable("hr_compliance_tasks", {
  id: id(), itemKey: text("item_key").notNull(), period: text("period").notNull(), status: text("status").notNull(), // done | na
  doneOn: date("done_on"), note: text("note"), by: text("by_email").notNull(), createdAt: created(),
}, (t) => [uniqueIndex("hr_compliance_task_uq").on(t.itemKey, t.period)]);
/**
 * Admin configuration: named roles and committee seats (POSH Internal Committee, grievance officer, DPO, HR contact).
 * A seat holds either an employee or a typed-in person (such as the external member). The current set is replaced as a whole on save.
 */
export const orgRoles = pgTable("hr_org_roles", {
  id: id(), role: text("role").notNull(), // posh_presiding | posh_member | posh_external | grievance_officer | dpo | hr_contact
  employeeId: uuid("employee_id"), name: text("name").notNull(), email: text("email"), phone: text("phone"),
  designation: text("designation"), organisation: text("organisation"), gender: text("gender").notNull().default("undisclosed"),
  termStart: date("term_start"), termEnd: date("term_end"), position: integer("position").notNull().default(0),
  createdBy: text("created_by").notNull(), createdAt: created(),
}, (t) => [index("hr_org_roles_role").on(t.role)]);
/** Default onboarding checklist, versioned. One row per saved version; the latest row is current. */
export const onboardingChecklist = pgTable("hr_onboarding_checklist", {
  id: serial("id").primaryKey(), version: integer("version").notNull(), items: jsonb("items").notNull(), updatedBy: text("updated_by").notNull(), createdAt: created(),
});
/** Reminders sent to people who have not acknowledged the current version of a policy (shown on their Home page). */
export const policyReminders = pgTable("hr_policy_reminders", {
  id: id(), policyId: uuid("policy_id").notNull(), version: integer("version").notNull(), employeeId: uuid("employee_id").notNull(),
  sentBy: text("sent_by").notNull(), emailed: boolean("emailed").notNull().default(false), createdAt: created(),
}, (t) => [index("hr_policy_rem_emp").on(t.employeeId)]);
/** Priority HR has set by hand for a compliance item; items without a row use the computed default. */
export const compliancePriority = pgTable("hr_compliance_priority", {
  itemKey: text("item_key").primaryKey(), priority: text("priority").notNull(), // High | Medium | Low
  by: text("by_email").notNull(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
