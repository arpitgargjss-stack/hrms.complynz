import { marksHtml, type Marks } from "./signatureMarks";
import { companyDocument, esc, fillIn as f } from "./letterHtml";
import type { CompanyProfile } from "../../shared/hr/letters";
import type { Committee, Person } from "../../shared/hr/orgRoles";

type Extra = { year: string; headcount: number; interns: number; committee?: Committee | null; marks?: Marks | null };
/** Committee table rows from Admin configuration; blank yellow fields when a seat is not set yet. */
function committeeRows(c: Committee | null | undefined): string {
  const row = (role: string, p: Person | null | undefined, third: "designation" | "organisation") =>
    `<tr><td>${role}</td><td>${p ? esc(p.name) : f("name")}</td><td>${p?.[third] ? esc(p[third]!) : f(third)}</td><td>${p && (p.email || p.phone) ? esc([p.email, p.phone].filter(Boolean).join(", ")) : f("email and phone")}</td></tr>`;
  const members = c?.members.length ? c.members : [null, null];
  return [row("Presiding Officer (a senior woman employee)", c?.presiding, "designation"), ...members.map((m) => row("Member (employee)", m, "designation")),
    row("External member (NGO or person familiar with the issues)", c?.external, "organisation")].join("\n");
}

/**
 * Standard working templates for the compliance centre. Yellow marks are for HR to fill in before printing or signing.
 * They follow the usual format; they are not legal advice and should be adapted to the company's facts.
 */
export const COMPLIANCE_TEMPLATES: Record<string, { title: string; body: (co: Partial<CompanyProfile>, extra: Extra) => string }> = {
  posh_ic: {
    title: "Order constituting the Internal Committee",
    body: (co, x) => `<p>Under section 4 of the Sexual Harassment of Women at Workplace (Prevention, Prohibition and Redressal) Act, 2013, ${esc(co.legalName ?? "the Company")} constitutes an Internal Committee for all its offices, with effect from ${x.committee?.termStart ? esc(x.committee.termStart) : f("date")}.</p>
<table><tr><th>Role</th><th>Name</th><th>Designation</th><th>Contact</th></tr>
${committeeRows(x.committee)}</table>
<p>At least half of the members are women. Members hold office for up to 3 years from the date of this order.</p>
<p>The Committee will receive and inquire into complaints within 90 days, recommend action, and prepare the annual report under section 21. Any woman, including an intern, contractor or visitor, may approach any member. Complaints should be made within 3 months of the incident, extendable by a further 3 months for sufficient reason.</p>
<p>This order will be displayed at each office and on the HRMS. The company currently has ${x.headcount} employees and ${x.interns} interns.</p>
<div class="sign">For ${esc(co.legalName ?? "the Company")}<br><b>${co.signatoryName ? esc(co.signatoryName) : f("signatory name")}</b><br>${esc(co.signatoryDesignation ?? "Director")}<br>Date: ${f("date")}</div>`,
  },
  posh_report: {
    title: "Annual report of the Internal Committee",
    body: (co, x) => `<p>Report under section 21 of the POSH Act and Rule 14, for the calendar year ${esc(x.year)}, submitted to the employer and the District Officer, ${f("district")}.</p>
<table class="kv"><tr><th>Employer</th><td>${esc(co.legalName ?? "")}, ${esc(co.registeredAddress ?? "")}</td></tr>
<tr><th>Number of employees and interns</th><td>${x.headcount} employees, ${x.interns} interns</td></tr>
<tr><th>Complaints received during the year</th><td>${f("number")}</td></tr>
<tr><th>Complaints disposed of during the year</th><td>${f("number")}</td></tr>
<tr><th>Cases pending for more than 90 days</th><td>${f("number")}</td></tr>
<tr><th>Workshops or awareness programmes held</th><td>${f("number and dates")}</td></tr>
<tr><th>Nature of action taken by the employer</th><td>${f("summary, or 'Not applicable'")}</td></tr></table>
<p>No names or identifying details of complainants, respondents or witnesses are included in this report.</p>
<div class="sign">Presiding Officer, Internal Committee<br><b>${f("name")}</b><br>Date: ${f("date")}</div>`,
  },
  registers: {
    title: "Registers kept in the HRMS",
    body: () => `<p>The Code on Wages, 2019 and the state shops and establishments rules require these registers. Most are kept in this HRMS and can be exported from the screens shown.</p>
<table><tr><th>Register</th><th>What it holds</th><th>Where to export it</th></tr>
<tr><td>Register of employees</td><td>Name, code, joining date, designation, department, work location, exit date</td><td>People, Download CSV</td></tr>
<tr><td>Register of wages</td><td>Gross, components, deductions, net pay, payment date</td><td>Payroll, each run</td></tr>
<tr><td>Attendance and muster roll</td><td>Days present, leave, holidays</td><td>Attendance</td></tr>
<tr><td>Leave register</td><td>Entitlement, taken, balance</td><td>Leave</td></tr>
<tr><td>Register of fines and deductions</td><td>Recoveries made from wages, with reason</td><td>${f("keep manually; nil if none")}</td></tr>
<tr><td>Register of advances</td><td>Salary advances and recoveries</td><td>${f("keep manually; nil if none")}</td></tr>
<tr><td>Accident register</td><td>Workplace accidents and injuries</td><td>${f("keep manually; nil if none")}</td></tr></table>
<p>Keep the registers for at least 3 years after the last entry, or longer if the state rule asks for it.</p>`,
  },
  board_minutes: {
    title: "First board meeting of the financial year: agenda and draft resolutions",
    body: (co) => `<p>Meeting of the Board of Directors of ${esc(co.legalName ?? "the Company")} held on ${f("date")} at ${f("time")} at ${f("place, or by video conference")}.</p>
<h2>Agenda</h2><ol><li>Leave of absence and quorum.</li><li>Confirmation of the minutes of the previous meeting.</li>
<li>Disclosure of interest by every director in Form MBP-1 (section 184(1)).</li><li>Declaration of non-disqualification by every director in Form DIR-8 (section 164(2)).</li>
<li>Review of foreign investment received and reporting (FC-GPR, FLA), if any.</li><li>Review of dues to MSME suppliers beyond 45 days.</li><li>Any other business with the permission of the Chair.</li></ol>
<h2>Draft resolution: disclosures</h2>
<p>RESOLVED THAT the disclosures of interest in Form MBP-1 and the declarations in Form DIR-8 received from ${f("names of directors")} be and are hereby taken on record.</p>
<h2>Draft resolution: authority</h2>
<p>RESOLVED FURTHER THAT ${f("name, designation")} be and is hereby authorised to sign and file the necessary forms and do all acts needed to give effect to this resolution.</p>
<div class="sign">Certified true copy<br>For ${esc(co.legalName ?? "the Company")}<br><b>${f("director name")}</b><br>Director, DIN ${f("DIN")}</div>`,
  },
};

export function renderComplianceTemplate(key: string, co: Partial<CompanyProfile> | undefined, extra: Extra): string | null {
  const t = COMPLIANCE_TEMPLATES[key];
  if (!t) return null;
  // Every "For <company>" sign-off gets the signatory's signature (or handwritten-style name) and the company stamp.
  const body = t.body(co ?? {}, extra).replace(/(<div class="sign">For [^<]*<br>)/g, `$1${marksHtml(extra.marks, co?.signatoryName)}`);
  return companyDocument(co, t.title, body);
}
