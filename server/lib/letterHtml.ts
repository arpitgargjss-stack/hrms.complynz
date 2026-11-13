import { CONSENT_PURPOSES } from "../../shared/hr/misc";
import { formatINR, amountInWords } from "../../shared/hr/money";

export const LETTER_TYPES = ["offer_short", "offer_full", "appointment", "appraisal", "experience", "relieving", "pip", "asset_contract"] as const;
export type LetterType = (typeof LETTER_TYPES)[number];

export interface LetterCtx { type: string; refNo: string; name: string; issuedAt: Date | null; status: string; payload: Record<string, unknown> }

export function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const ph = (label: string) => `<span class="ph">[${esc(label)}]</span>`;
function val(p: Record<string, unknown>, key: string, label?: string): string {
  const v = p[key];
  return v === undefined || v === null || String(v).trim() === "" ? ph(label ?? key) : esc(v);
}
function money(p: Record<string, unknown>, key: string, label: string): string {
  const v = p[key];
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) return ph(label);
  return `${esc(formatINR(v))} (${esc(amountInWords(v))})`;
}
const dateText = (p: Record<string, unknown>, key: string, label: string): string => {
  const v = p[key];
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return ph(label);
  const d = new Date(v + "T00:00:00Z");
  return esc(d.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }));
};
const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
const table = (rows: string[]) => `<table class="kv">${rows.join("")}</table>`;

const CSS = `body{font:14px/1.55 Georgia,'Times New Roman',serif;color:#1b1b1b;max-width:760px;margin:24px auto;padding:0 20px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:22px 0 6px}h3{font-size:14px;margin:14px 0 4px}
.meta{color:#555;font-size:12px;margin-bottom:18px}table{border-collapse:collapse;width:100%;margin:8px 0}
th,td{border:1px solid #cfcfcf;padding:6px 9px;text-align:left;vertical-align:top;font-size:13px}th{background:#f5f5f2;width:34%;font-weight:600}
.ph{background:#fff3c4;padding:0 3px;border-radius:2px}.legal{margin-top:28px;border-top:1px solid #ccc;padding-top:8px;font-size:11px;color:#666}
.pb{page-break-before:always}ol,ul{padding-left:20px}`;

function wrap(ctx: LetterCtx, title: string, body: string): string {
  const issued = ctx.issuedAt ? esc(ctx.issuedAt.toISOString().slice(0, 10)) : ph("date of issue");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} ${esc(ctx.refNo)}</title><style>${CSS}</style></head><body>
<h1>Complynz</h1><div class="meta">Ref: ${esc(ctx.refNo)} &middot; Date: ${issued}${ctx.status === "draft" ? " &middot; DRAFT" : ""}</div>
<h2>${esc(title)}</h2>${body}
<div class="legal">Draft wording: legal review is pending. Personal data in this document is handled under the Digital Personal Data Protection Act, 2023. Privacy contact: dpo@complynz.com.</div></body></html>`;
}

function consentTable(): string {
  return `<h2>Part B. Your choices about your personal data</h2>
<p>These choices are optional and separate from your offer. Declining any of them does not affect your offer or employment. You can change them later.</p>
<table><tr><th style="width:70%">Purpose</th><th>Your choice</th></tr>${CONSENT_PURPOSES.map((c) => `<tr><td>${esc(c.label)}</td><td>&#9744; Yes &nbsp; &#9744; No</td></tr>`).join("")}</table>
<p>Details of what we collect and why are in the employee privacy notice. Questions or requests: dpo@complynz.com.</p>`;
}

function ndaAnnexure(name: string): string {
  return `<div class="pb"></div><h2>Annexure A. Confidentiality and Non-Disclosure Agreement</h2>
<p>This Agreement is between Complynz (the &ldquo;Company&rdquo;) and ${esc(name) || ph("employee name")} (the &ldquo;Employee&rdquo;).</p>
<ol>
<li><b>Confidential Information</b> means non-public business, technical, financial, customer, vendor and personal data information the Employee receives through employment, in any form.</li>
<li>The Employee will use Confidential Information only for the Company&rsquo;s work and will not disclose it to anyone outside the Company without written permission.</li>
<li>Personal data of customers, colleagues or any other individual must be accessed only as needed for assigned work and handled under the Company&rsquo;s privacy policies and applicable law.</li>
<li>These duties do not apply to information that is public through no fault of the Employee, was lawfully known before joining, or must be disclosed by law (with prompt notice to the Company where permitted).</li>
<li>On leaving, the Employee will return or delete all Confidential Information and Company assets.</li>
<li>These obligations continue for ${ph("duration, e.g. 2 years")} after employment ends, and for personal data and trade secrets for as long as they remain protected.</li>
<li>Governing law and jurisdiction: ${ph("governing law and courts")}.</li></ol>`;
}

function offerBase(ctx: LetterCtx, full: boolean): string {
  const p = ctx.payload;
  const rows = [
    row("Position", val(p, "position", "position")), row("Department", val(p, "department", "department")),
    row("Reporting to", val(p, "reportingTo", "reporting manager")), row("Work location", val(p, "location", "work location")),
    row("Date of joining", dateText(p, "joiningDate", "joining date")), row("Employment type", val(p, "employmentType", "full time / contract")),
    row("Annual CTC", money(p, "annualCtcPaise", "annual CTC")), row("Monthly gross", money(p, "monthlyGrossPaise", "monthly gross")),
  ];
  const intro = `<p>Dear ${esc(ctx.name) || ph("candidate name")},</p><p>We are pleased to offer you the position of ${val(p, "position", "position")} at Complynz, subject to the terms below.</p>`;
  if (!full) {
    return wrap(ctx, "Offer of Employment (Summary)", `${intro}${table(rows)}
<p>This is a summary. The full offer letter, with detailed terms, the confidentiality agreement and your data-processing choices, is part of the same acceptance link. Please read it before accepting.</p>
<p>This offer is valid until ${dateText(p, "validUntil", "offer valid until")}.</p>`);
  }
  rows.push(row("Probation", val(p, "probation", "probation period")), row("Notice period", val(p, "noticePeriod", "notice period")),
    row("Working hours", val(p, "workingHours", "working hours")), row("Leave entitlement", val(p, "leaveSummary", "leave summary")));
  return wrap(ctx, "Offer of Employment", `${intro}<h3>Part A. Terms of offer</h3>${table(rows)}
<ol>
<li>This offer is conditional on satisfactory verification of the documents and references you provide.</li>
<li>Salary is paid monthly, subject to statutory deductions including income tax at source. Your detailed salary structure: ${val(p, "salaryStructureNote", "salary structure reference")}.</li>
<li>You will be bound by Company policies as updated from time to time, and by the Confidentiality Agreement in Annexure A.</li>
<li>Either party may end employment by giving the notice stated above, or as set out in your appointment letter.</li>
<li>This offer is valid until ${dateText(p, "validUntil", "offer valid until")}. To accept, use the secure link sent to you.</li></ol>
<p>We look forward to having you on the team.</p><p>For Complynz<br>${val(p, "signatoryName", "authorised signatory name")}, ${val(p, "signatoryDesignation", "signatory designation")}</p>
${consentTable()}${ndaAnnexure(ctx.name)}`);
}

function simple(ctx: LetterCtx, title: string, paras: string[], rows?: string[]): string {
  return wrap(ctx, title, `<p>Dear ${esc(ctx.name) || ph("employee name")},</p>${rows ? table(rows) : ""}${paras.map((x) => `<p>${x}</p>`).join("")}<p>For Complynz<br>${val(ctx.payload, "signatoryName", "authorised signatory name")}, ${val(ctx.payload, "signatoryDesignation", "signatory designation")}</p>`);
}

export function renderLetter(ctx: LetterCtx): string {
  const p = ctx.payload;
  switch (ctx.type) {
    case "offer_short": return offerBase(ctx, false);
    case "offer_full": return offerBase(ctx, true);
    case "appointment": return simple(ctx, "Letter of Appointment", [
      `We confirm your appointment as ${val(p, "position", "position")} in ${val(p, "department", "department")} with effect from ${dateText(p, "joiningDate", "joining date")}.`,
      `Your monthly gross salary is ${money(p, "monthlyGrossPaise", "monthly gross")}. You will be on probation for ${val(p, "probation", "probation period")}, and the notice period is ${val(p, "noticePeriod", "notice period")}.`,
      "Your appointment is governed by Company policies and the confidentiality agreement you accepted at offer stage."]);
    case "appraisal": return simple(ctx, "Appraisal Letter", [
      `Following your performance review for ${val(p, "reviewPeriod", "review period")}, your monthly gross salary will be revised to ${money(p, "newMonthlyGrossPaise", "new monthly gross")} with effect from ${dateText(p, "effectiveFrom", "effective date")}.`,
      `Designation after revision: ${val(p, "newDesignation", "designation")}.`]);
    case "experience": return simple(ctx, "Experience Certificate", [
      `This is to certify that ${esc(ctx.name) || ph("employee name")} worked with Complynz as ${val(p, "position", "position")} from ${dateText(p, "joiningDate", "joining date")} to ${dateText(p, "lastWorkingDay", "last working day")}.`,
      `Conduct during employment: ${val(p, "conduct", "conduct remark")}. We wish them well in future endeavours.`]);
    case "relieving": return simple(ctx, "Relieving Letter", [
      `Your resignation has been accepted and you are relieved from the services of Complynz at the close of business on ${dateText(p, "lastWorkingDay", "last working day")}.`,
      `All Company assets have been returned and dues settled as per records: ${val(p, "settlementNote", "settlement status")}.`]);
    case "pip": return simple(ctx, "Performance Improvement Plan", [
      `This plan supports you in meeting the expectations of your role. It runs for ${val(p, "lengthDays", "30, 60 or 90")} days from ${dateText(p, "startDate", "start date")}.`,
      `Concerns: ${val(p, "concerns", "concerns")}. Support offered: ${val(p, "support", "support")}.`,
      "Signing or acknowledging this letter confirms you received it, not that you agree with it. You may add your own response in the system. The plan records progress; it does not by itself change your employment."]);
    case "asset_contract": {
      const cost = typeof p.assetCostPaise === "number" ? `${esc(formatINR(p.assetCostPaise))}` : ph("asset cost");
      return wrap(ctx, "Asset Issue and Responsibility Agreement", `<p>Employee: ${esc(ctx.name) || ph("employee name")}</p>
${table([row("Asset", val(p, "assetDescription", "asset description")), row("Asset tag / serial", `${val(p, "assetTag", "asset tag")} / ${val(p, "serialNo", "serial number")}`),
  row("Accessories", val(p, "accessories", "accessories")), row("Cost of asset", cost), row("Date of issue", dateText(p, "issuedOn", "issue date"))])}
<ol><li>I confirm I received the asset above in intact, working condition, with the accessories listed.</li>
<li>I will use it for Company work, keep it safe, and not lend or modify it.</li>
<li>Accidental damage, loss or theft caused while the asset is with me is my responsibility, and I agree the Company may recover up to the cost of the asset stated above, in line with applicable law, from amounts due to me.</li>
<li>I will return the asset in working condition when asked or when my employment ends.</li>
<li>Fair wear and tear is not damage.</li></ol>
<p>Employee signature: ____________________ &nbsp; Date: ______________</p>`);
    }
    default: return wrap(ctx, "Letter", `<p>${ph("letter content")}</p>`);
  }
}
