/**
 * Letter catalogue shared by the server (rendering, validation) and the admin Letters page (forms).
 * Every letter is drafted by HR, approved by the CEO (super admin), then issued.
 */
export type FieldKind = "text" | "textarea" | "date" | "money" | "number" | "bool" | "template" | "select" | "employee";
export type LetterField = { key: string; label: string; kind: FieldKind; hint?: string; options?: string[]; fromEmployee?: string };
export type LetterDef = { type: string; label: string; group: "Hiring" | "During employment" | "Exit" | "Other"; audience: "candidate" | "employee" | "both"; summary: string; fields: LetterField[] };

const POS: LetterField = { key: "position", label: "Designation", kind: "text", fromEmployee: "designation" };
const DEPT: LetterField = { key: "department", label: "Department", kind: "text", fromEmployee: "department" };
const LOC: LetterField = { key: "location", label: "Work location", kind: "text", hint: "e.g. Noida, Uttar Pradesh", fromEmployee: "location" };
const MGR: LetterField = { key: "reportingTo", label: "Reporting manager", kind: "employee", fromEmployee: "manager" };
const DOJ: LetterField = { key: "joiningDate", label: "Date of joining", kind: "date", fromEmployee: "joiningDate" };
const LWD: LetterField = { key: "lastWorkingDay", label: "Last working day", kind: "date", fromEmployee: "lastWorkingDay" };
const EFF: LetterField = { key: "effectiveFrom", label: "Effective from", kind: "date" };
const GROSS: LetterField = { key: "monthlyGrossPaise", label: "Monthly gross (₹)", kind: "money", fromEmployee: "monthlyGross" };
const NOTICE: LetterField = { key: "noticePeriod", label: "Notice period", kind: "text", hint: "e.g. 30 days" };

export const LETTER_DEFS: LetterDef[] = [
  { type: "offer_short", label: "Offer letter, one page", group: "Hiring", audience: "candidate", summary: "The one-page letterhead offer: role, monthly salary, start of probation.",
    fields: [POS, GROSS, { key: "salaryNote", label: "Salary note", kind: "text", hint: "e.g. for 3 months and it will be appraised based on your performance" }, { key: "joiningDate", label: "Probation starts on", kind: "date" }] },
  { type: "offer_full", label: "Offer letter, full", group: "Hiring", audience: "candidate", summary: "Full terms: compensation table, background check, DPDP consent choices, policies and the NDA and IP agreement (Annexure A).",
    fields: [{ key: "salutation", label: "Title", kind: "select", options: ["Ms.", "Mr.", "Mx.", "Dr."] }, { key: "addressLine1", label: "Address line 1", kind: "text" }, { key: "addressLine2", label: "Address line 2, city, state, PIN", kind: "text" },
      { key: "employeeCode", label: "Employee code", kind: "text", hint: "Filled with the next free code; used when the candidate joins" }, POS, DEPT, MGR, LOC, DOJ,
      { key: "employmentType", label: "Employment type", kind: "select", options: ["Full-Time, Permanent", "Full-Time, Fixed Term", "Part-Time", "Intern", "Contract"] },
      GROSS, { key: "templateKey", label: "Salary structure", kind: "template" }, { key: "pfApplicable", label: "Provident fund applies", kind: "bool", hint: "Off while you have fewer than 20 employees and have not registered voluntarily" },
      { key: "ptState", label: "State for professional tax", kind: "text", hint: "Uttar Pradesh has none; Maharashtra does" }, { key: "validUntil", label: "Offer valid until", kind: "date" },
      // Annexure A (NDA) details. Filled from the candidate's onboarding where they have submitted it; HR can change them.
      { key: "ndaDate", label: "NDA date", kind: "date", hint: "Today unless you change it" },
      { key: "relationName", label: "Father's, mother's or spouse's name (NDA)", kind: "text" },
      { key: "aadhaarLast4", label: "Aadhaar, last 4 digits (NDA)", kind: "text" }] },
  { type: "appointment", label: "Appointment letter", group: "Hiring", audience: "employee", summary: "Confirms the appointment on joining.", fields: [POS, DEPT, DOJ, GROSS, { key: "probation", label: "Probation", kind: "text", hint: "e.g. 6 months" }, NOTICE] },
  { type: "internship_offer", label: "Internship offer", group: "Hiring", audience: "candidate", summary: "Stipend, dates and mentor for an intern.",
    fields: [POS, { key: "stipendPaise", label: "Monthly stipend (₹)", kind: "money" }, { key: "startDate", label: "Start date", kind: "date" }, { key: "endDate", label: "End date", kind: "date" }, MGR, LOC, { key: "validUntil", label: "Offer valid until", kind: "date" }] },
  { type: "confirmation", label: "Confirmation of employment", group: "During employment", audience: "employee", summary: "Probation completed; employment confirmed.", fields: [POS, { key: "confirmationDate", label: "Confirmed from", kind: "date" }, NOTICE] },
  { type: "appraisal", label: "Appraisal letter", group: "During employment", audience: "employee", summary: "Review outcome with the revised salary.",
    fields: [{ key: "reviewPeriod", label: "Review period", kind: "text", hint: "e.g. April 2025 to March 2026" }, { key: "rating", label: "Overall rating", kind: "text" }, { key: "currentMonthlyGrossPaise", label: "Current monthly gross (₹)", kind: "money", fromEmployee: "monthlyGross" }, { key: "newMonthlyGrossPaise", label: "Revised monthly gross (₹)", kind: "money" }, EFF, { key: "note", label: "Message", kind: "textarea" }] },
  { type: "increment", label: "Salary increment letter", group: "During employment", audience: "employee", summary: "A salary revision outside the review cycle.",
    fields: [{ key: "currentMonthlyGrossPaise", label: "Current monthly gross (₹)", kind: "money", fromEmployee: "monthlyGross" }, { key: "newMonthlyGrossPaise", label: "Revised monthly gross (₹)", kind: "money" }, EFF, { key: "reason", label: "Reason", kind: "text" }] },
  { type: "promotion", label: "Promotion letter", group: "During employment", audience: "employee", summary: "New designation, with salary if it changes.",
    fields: [{ key: "currentDesignation", label: "Current designation", kind: "text", fromEmployee: "designation" }, { key: "newDesignation", label: "New designation", kind: "text" }, EFF, { key: "newMonthlyGrossPaise", label: "New monthly gross (₹, optional)", kind: "money" }, { key: "newReportingTo", label: "New reporting manager (optional)", kind: "text" }] },
  { type: "transfer", label: "Transfer letter", group: "During employment", audience: "employee", summary: "Change of work location or team.",
    fields: [{ key: "fromLocation", label: "From", kind: "text", fromEmployee: "location" }, { key: "toLocation", label: "To", kind: "text" }, EFF, { key: "newReportingTo", label: "Reporting manager there", kind: "text" }, { key: "relocationSupport", label: "Relocation support", kind: "textarea" }] },
  { type: "warning", label: "Warning letter", group: "During employment", audience: "employee", summary: "A written warning about conduct or performance.",
    fields: [{ key: "incidentDate", label: "Date of incident", kind: "date" }, { key: "issue", label: "What happened", kind: "textarea" }, { key: "expectation", label: "What is expected", kind: "textarea" }] },
  { type: "pip", label: "Performance improvement plan", group: "During employment", audience: "employee", summary: "Plan length, concerns and support.",
    fields: [{ key: "startDate", label: "Start date", kind: "date" }, { key: "lengthDays", label: "Length in days", kind: "number" }, { key: "concerns", label: "Concerns", kind: "textarea" }, { key: "support", label: "Support offered", kind: "textarea" }] },
  { type: "asset_contract", label: "Asset issue agreement", group: "Other", audience: "employee", summary: "Laptop or other asset handed over.",
    fields: [{ key: "assetDescription", label: "Asset", kind: "text" }, { key: "assetTag", label: "Asset tag", kind: "text" }, { key: "serialNo", label: "Serial number", kind: "text" }, { key: "accessories", label: "Accessories", kind: "text" }, { key: "assetCostPaise", label: "Cost of asset (₹)", kind: "money" }, { key: "issuedOn", label: "Date of issue", kind: "date" }] },
  { type: "relieving", label: "Relieving letter", group: "Exit", audience: "employee", summary: "Relieved from service on the last working day.", fields: [POS, { key: "resignationDate", label: "Resignation date", kind: "date" }, LWD] },
  { type: "experience", label: "Experience letter", group: "Exit", audience: "employee", summary: "Service period and role, for future employers.", fields: [POS, DOJ, LWD, { key: "conduct", label: "Conduct remark", kind: "text", hint: "e.g. good" }] },
  { type: "fnf_statement", label: "Full and final settlement statement", group: "Exit", audience: "employee", summary: "Created from a full and final settlement in Exits.", fields: [] },
  { type: "internship_certificate", label: "Internship certificate", group: "Exit", audience: "employee", summary: "Completion of an internship.", fields: [POS, { key: "startDate", label: "Start date", kind: "date", fromEmployee: "joiningDate" }, { key: "endDate", label: "End date", kind: "date", fromEmployee: "lastWorkingDay" }, { key: "projectSummary", label: "What they worked on", kind: "textarea" }] },
];
export const LETTER_TYPES = LETTER_DEFS.map((d) => d.type) as [string, ...string[]];
export const letterDef = (type: string) => LETTER_DEFS.find((d) => d.type === type);
export const letterLabel = (type: string) => letterDef(type)?.label ?? type;

/** Company details printed on every letter. Editable in Letters, Company details. */
export type CompanyProfile = {
  legalName: string; brandName: string; registeredAddress: string; website: string; email: string; cin: string;
  signatoryName: string; signatoryDesignation: string; grievanceOfficerName: string; grievanceOfficerEmail: string;
  courts: string; arbitrationSeat: string; ndaDamages: string;
};
export const COMPANY_DEFAULTS: CompanyProfile = {
  legalName: "Complynz Labs Private Limited", brandName: "Complynz Labs", registeredAddress: "H-1001, Exotica Fresco, Sector 137, Noida, Uttar Pradesh – 201304",
  website: "www.complynz.com", email: "hello@complynz.com", cin: "",
  signatoryName: "", signatoryDesignation: "Founder & CEO", grievanceOfficerName: "", grievanceOfficerEmail: "dpo@complynz.com",
  courts: "Gautam Buddh Nagar, Uttar Pradesh", arbitrationSeat: "New Delhi", ndaDamages: "",
};

/** Letter statuses. Only an approved letter can be issued. */
export const LETTER_STATUS_LABEL: Record<string, string> = { draft: "Draft", pending_approval: "Waiting for CEO approval", approved: "Approved", issued: "Issued", accepted: "Accepted", void: "Withdrawn" };
