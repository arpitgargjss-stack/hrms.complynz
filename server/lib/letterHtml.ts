import { MARKS_CSS, marksHtml, type Marks } from "./signatureMarks";
import { readFileSync } from "node:fs";
import { CONSENT_PURPOSES } from "../../shared/hr/misc";
import { formatINR, amountInWords } from "../../shared/hr/money";
import { resolveComponents, type ComponentDef } from "../../shared/hr/payroll";
import { TEMPLATE_PRESETS } from "../../shared/hr/presets";
import { COMPANY_DEFAULTS, LETTER_TYPES, letterLabel, type CompanyProfile } from "../../shared/hr/letters";
import { NDA_BLOCKS } from "./letters/ndaText";

export { LETTER_TYPES };
export type LetterType = string;

export interface LetterCtx {
  type: string; refNo: string; name: string; issuedAt: Date | null; status: string; payload: Record<string, unknown>;
  company?: Partial<CompanyProfile>; approvedAt?: Date | null; components?: ComponentDef[] | null;
  /** Choices the candidate recorded online, shown in the consent table once they have accepted. */
  consentRecord?: Record<string, { granted: boolean; at: string }> | null;
  /** When the candidate accepted online (email code plus typed name), for the acceptance and execution blocks. */
  acceptedAt?: Date | null;
  /** Signature and stamp of the authorised signatory (uploaded images, or the default stamp and a handwritten-style name). */
  marks?: Marks | null;
}

export function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const ph = (label: string) => `<span class="ph">[${esc(label)}]</span>`;
const blank = (v: unknown) => v === undefined || v === null || String(v).trim() === "";
function val(p: Record<string, unknown>, key: string, label?: string): string { return blank(p[key]) ? ph(label ?? key) : esc(p[key]); }
const rupees = (v: number) => esc(formatINR(v).replace(/\.00$/, ""));
function money(p: Record<string, unknown>, key: string, label: string, words = true): string {
  const v = p[key];
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) return ph(label);
  return words ? `${rupees(v)} (${esc(amountInWords(v))})` : rupees(v);
}
const longDate = (s: string) => new Date(s + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const shortDate = (s: string) => new Date(s + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
function dateText(p: Record<string, unknown>, key: string, label: string, fmt = longDate): string {
  const v = p[key];
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? esc(fmt(v)) : ph(label);
}
const row = (k: string, v: string) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
const table = (rows: string[]) => `<table class="kv">${rows.join("")}</table>`;

let LOGO = "";
try { LOGO = "data:image/png;base64," + readFileSync(new URL("../../client/public/logo.png", import.meta.url)).toString("base64"); } catch { /* text fallback */ }
const logo = (h: number) => (LOGO ? `<img src="${LOGO}" alt="Complynz" style="height:${h}px">` : `<b style="font-size:${h * 0.7}px;color:#0048e4">Complynz</b>`);

/** Rounded stripes in the corners, in the letterhead's blue, yellow and light blue. */
const STRIPES_TL = `<svg class="st tl" viewBox="0 0 260 220" aria-hidden="true"><g stroke-linecap="round" stroke-width="22" fill="none">
<line x1="-30" y1="120" x2="90" y2="0" stroke="#0048e4"/><line x1="-10" y1="170" x2="130" y2="30" stroke="#ffc93c"/><line x1="30" y1="190" x2="170" y2="50" stroke="#8fc1ff"/>
<line x1="-40" y1="230" x2="60" y2="130" stroke="#8fc1ff" opacity=".7"/><line x1="120" y1="20" x2="160" y2="-20" stroke="#0048e4"/></g>
<path d="M150 8v18M141 17h18" stroke="#ffc93c" stroke-width="3" stroke-linecap="round"/></svg>`;
const STRIPES_BR = `<svg class="st br" viewBox="0 0 220 200" aria-hidden="true"><g stroke-linecap="round" stroke-width="20" fill="none">
<line x1="60" y1="230" x2="250" y2="40" stroke="#0048e4"/><line x1="120" y1="230" x2="250" y2="100" stroke="#ffc93c"/><line x1="20" y1="230" x2="130" y2="120" stroke="#8fc1ff"/>
<line x1="170" y1="40" x2="200" y2="10" stroke="#8fc1ff"/></g><circle cx="40" cy="150" r="6" fill="#ffc93c"/><path d="M90 92v16M82 100h16" stroke="#0048e4" stroke-width="3" stroke-linecap="round"/></svg>`;

const CSS = `@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap');
:root{--b:#0048e4}*{box-sizing:border-box}
body{font:13.5px/1.6 Poppins,'Segoe UI',system-ui,sans-serif;color:#1c2540;max-width:820px;margin:0 auto;padding:0;background:#fff}
.page{position:relative;padding:56px 64px 72px;overflow:hidden}
h1.title{font-size:30px;letter-spacing:.04em;color:var(--b);text-align:center;margin:8px 0 26px;font-weight:600}
h2{font-size:15px;color:var(--b);margin:22px 0 6px;font-weight:600}h3{font-size:13.5px;margin:16px 0 4px;font-weight:600}
p{margin:8px 0;text-align:justify}table{border-collapse:collapse;width:100%;margin:10px 0}
th,td{border:1px solid #d6dcea;padding:7px 10px;text-align:left;vertical-align:top;font-size:12.5px}th{background:#f0f5ff;color:#13306e;font-weight:600}
table.kv th{width:34%}td.r,th.r{text-align:right}tr.tot td{font-weight:600;background:#f7f9ff}
.ph{background:#fff3c4;padding:0 3px;border-radius:3px}
.lh{text-align:center;margin-bottom:6px}.lh .web{color:#1c2540;font-size:12px;margin-top:4px}
.rule{border:0;border-top:2px dotted #8fc1ff;margin:10px 0 0}.rule.solid{border-top:2px solid var(--b)}
.st{position:absolute;pointer-events:none}.st.tl{left:-20px;top:-20px;width:230px}.st.br{right:-10px;bottom:-10px;width:200px}
.page.lhp{min-height:1122px}@media print{.page.lhp{min-height:1050px}}
.to{display:flex;justify-content:space-between;margin:10px 0 22px}.to b{display:block}
.sign{margin-top:22px}.sign .e{font-size:11px;color:#5b6478}
.foot{position:absolute;left:64px;bottom:28px;font-size:11.5px;color:#1c2540;display:flex;gap:8px;align-items:center}
.foot i{display:inline-block;width:14px;height:14px;border-radius:4px;background:var(--b)}
.hdr{display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:10px;border-bottom:2px solid var(--b);margin-bottom:18px}
.hdr .c{font-size:11px;font-weight:600;letter-spacing:.08em;color:#13306e}.meta{font-size:12.5px;margin-bottom:14px}
.nda h1{font-size:18px;text-align:center;color:var(--b);margin:0}.nda h2{text-align:center;color:#1c2540;font-size:14px}.nda .center{text-align:center;font-style:italic}
.nda p.c{padding-left:0}.nda p.sub{padding-left:22px}ul{padding-left:22px;margin:6px 0}
.draft{position:fixed;top:40%;left:0;right:0;text-align:center;font-size:90px;font-weight:700;color:rgba(0,72,228,.07);transform:rotate(-20deg);pointer-events:none}
h2,h3{break-after:avoid}tr,li{break-inside:avoid}.pb{break-before:page;page-break-before:always}.legal{font-size:10.5px;color:#5b6478;margin-top:26px;border-top:1px solid #d6dcea;padding-top:6px}
@media print{body{max-width:none}.page{padding:40px 48px 64px}}`;

type Co = CompanyProfile;
const coOf = (ctx: LetterCtx): Co => ({ ...COMPANY_DEFAULTS, ...Object.fromEntries(Object.entries(ctx.company ?? {}).filter(([, v]) => !blank(v))) } as Co);

function doc(ctx: LetterCtx, title: string, pages: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} ${esc(ctx.refNo)}</title><style>${CSS}${MARKS_CSS}</style></head><body>
${ctx.status === "draft" || ctx.status === "pending_approval" ? `<div class="draft">DRAFT</div>` : ""}${pages}</body></html>`;
}
const issuedDay = (ctx: LetterCtx) => (ctx.issuedAt ?? ctx.approvedAt ?? null);
function signature(ctx: LetterCtx, co: Co, forLabel = true): string {
  const when = ctx.approvedAt && ["approved", "issued", "accepted"].includes(ctx.status) ? `<div class="e">Approved and signed electronically on ${esc(longDate(ctx.approvedAt.toISOString().slice(0, 10)))}</div>` : "";
  return `<div class="sign">${forLabel ? `For ${esc(co.legalName)}<br>` : "Warm regards,<br>"}${marksHtml(ctx.marks, co.signatoryName)}<b>${co.signatoryName ? esc(co.signatoryName) : ph("signatory name")}</b><br>${esc(co.signatoryDesignation)}${forLabel ? "" : `<br>${esc(co.brandName)}`}${when}</div>`;
}

/** Letterhead page in the one-page offer style: corner stripes, centred logo, title. */
function letterheadPage(ctx: LetterCtx, title: string, body: string): string {
  const co = coOf(ctx);
  return `<div class="page lhp">${STRIPES_TL}${STRIPES_BR}
<div class="lh">${logo(46)}<div class="web">${esc(co.website)}</div></div><hr class="rule">
<h1 class="title">${esc(title.toUpperCase())}</h1>${body}
<div class="foot"><i></i>${esc(co.email)}</div></div>`;
}
/** Formal page: logo left, confidentiality marker right, reference and date. */
function formalPage(ctx: LetterCtx, body: string, opts: { confidential?: boolean } = {}): string {
  const co = coOf(ctx); const d = issuedDay(ctx);
  return `<div class="page"><div class="hdr">${logo(34)}<span class="c">${opts.confidential === false ? esc(co.website) : "STRICTLY PRIVATE &amp; CONFIDENTIAL"}</span></div>
<div class="meta">Ref: ${esc(ctx.refNo)}<br>Date: ${d ? esc(longDate(d.toISOString().slice(0, 10))) : ph("date of issue")}</div>${body}
<div class="legal">${esc(co.legalName)} · ${esc(co.registeredAddress)} · ${esc(co.email)} · ${esc(co.website)}</div></div>`;
}
const dear = (ctx: LetterCtx) => `<p>Dear ${esc(ctx.name.split(" ")[0]) || ph("first name")},</p>`;
const toBlock = (ctx: LetterCtx, p: Record<string, unknown>) => `<p>To,<br><b>${blank(p.salutation) ? "" : esc(p.salutation) + " "}${esc(ctx.name) || ph("name")}</b>${blank(p.addressLine1) ? "" : `<br>${esc(p.addressLine1)}`}${blank(p.addressLine2) ? "" : `<br>${esc(p.addressLine2)}`}</p>`;

// ---------------------------------------------------------------- offers
function offerShort(ctx: LetterCtx): string {
  const p = ctx.payload, co = coOf(ctx), d = issuedDay(ctx);
  const salary = typeof p.monthlyGrossPaise === "number" ? `INR ${esc(formatINR(p.monthlyGrossPaise as number, "").replace(/\.00$/, "").trim())}` : ph("monthly salary");
  const note = blank(p.salaryNote) ? "" : ` ${esc(p.salaryNote)}`;
  return doc(ctx, "Offer letter", letterheadPage(ctx, "Offer Letter", `
<div class="to"><div>To:<b>${esc(ctx.name) || ph("candidate name")}</b></div><div>${d ? esc(shortDate(d.toISOString().slice(0, 10))) : ph("date")}</div></div>
<p>Dear ${esc(ctx.name) || ph("candidate name")},</p>
<p>Thank you for the time and effort you invested throughout our selection process. We’re pleased to offer you the position of <b>${val(p, "position", "position")}</b> at ${esc(co.brandName)}, with a monthly salary of <b>${salary}${note}.</b></p>
<p>Your probation period will commence from ${dateText(p, "joiningDate", "start date", shortDate)}.<br>
At Complynz, we are building an AI-led compliance execution platform to help businesses operationalize regulations like DPDP at scale. As part of our early team, you will work closely on solving real-world problems across data, workflows, and automation.</p>
<p>This is a high-ownership environment where your contributions will directly influence product direction and impact. We’re looking forward to seeing you bring your curiosity and problem-solving mindset to the team.</p>
<p>We’re excited about the possibility of building Complynz together.</p>${signature(ctx, co, false)}`));
}

function compTable(ctx: LetterCtx): string {
  const p = ctx.payload;
  const gross = p.monthlyGrossPaise;
  if (typeof gross !== "number" || gross <= 0) return `<p>${ph("monthly gross, to work out the salary table")}</p>`;
  const comps = ctx.components ?? TEMPLATE_PRESETS.find((t) => t.key === (p.templateKey ?? "standard"))?.components ?? TEMPLATE_PRESETS[0].components;
  let lines; try { lines = resolveComponents(gross, comps); } catch { return `<p>${ph("salary structure does not fit this gross")}</p>`; }
  return `<table><tr><th>Component</th><th class="r">Annual (₹)</th><th class="r">Monthly (₹)</th></tr>${lines.map((l) => `<tr><td>${esc(l.name)}</td><td class="r">${rupees(l.amount * 12)}</td><td class="r">${rupees(l.amount)}</td></tr>`).join("")}
<tr class="tot"><td>Annual Cost to Company (CTC)</td><td class="r">${rupees(gross * 12)}</td><td class="r">${rupees(gross)}</td></tr></table>`;
}

/** Electronic acceptance line: filled in once accepted online, otherwise says how it will be signed. */
function eSign(ctx: LetterCtx): string {
  if (!ctx.acceptedAt) return `Signature: <span style="color:#5b6478">signed electronically on the acceptance page</span>`;
  const t = ctx.acceptedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  return `Signature: <b>accepted electronically</b> (email verified by one-time code, full name typed)<br>Date: ${esc(t)}`;
}
function consentPartB(ctx: LetterCtx): string {
  const rec = ctx.consentRecord;
  const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
  const cell = (key: string) => {
    const r = rec?.[key];
    if (!r) return `<span style="color:#5b6478">Chosen online when you accept</span>`;
    return `<b style="color:${r.granted ? "#0f7b4f" : "#5b6478"}">${r.granted ? "Yes, consent given" : "No, not given"}</b><br><span style="font-size:11px;color:#5b6478">Recorded online, ${esc(when(r.at))}</span>`;
  };
  return `<table><tr><th style="width:52%">Purpose &amp; Description</th><th>Retention Period</th><th style="width:22%">Your Consent</th></tr>
${CONSENT_PURPOSES.map((c) => `<tr><td><b>${esc(c.title)}</b> — ${esc(c.detail)}</td><td>${esc(c.retention)}</td><td>${cell(c.key)}</td></tr>`).join("")}</table>`;
}

function ndaHtml(ctx: LetterCtx, co: Co): string {
  const p = ctx.payload;
  const vars: Record<string, string> = {
    name: esc(ctx.name) || ph("employee name"), employeeCode: blank(p.employeeCode) ? ph("employee code") : esc(p.employeeCode), legalName: esc(co.legalName),
    registeredAddress: esc(co.registeredAddress), ndaDamages: co.ndaDamages ? `INR ${esc(co.ndaDamages)}` : ph("liquidated damages amount, set in Company details"),
    employmentType: blank(p.employmentType) ? ph("employment type") : esc(p.employmentType), arbitrationSeat: esc(co.arbitrationSeat), email: esc(co.email),
  };
  const fill = (s: string) => esc(s).replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? ph(k));
  let out = "", inList = false;
  for (const [k, s] of NDA_BLOCKS) {
    if (k === "li") { if (!inList) { out += "<ul>"; inList = true; } out += `<li>${fill(s)}</li>`; continue; }
    if (inList) { out += "</ul>"; inList = false; }
    out += k === "h1" ? `<h1>${fill(s)}</h1>` : k === "h2" ? `<h2>${fill(s)}</h2>` : k === "h3" ? `<h3>${fill(s)}</h3>` : k === "center" ? `<p class="center">${fill(s)}</p>` : `<p class="${k}">${fill(s)}</p>`;
  }
  if (inList) out += "</ul>";
  const line = "__________________________";
  out += `<h3>EXECUTION</h3><p>IN WITNESS WHEREOF, the Parties hereto have executed this Agreement on the day, month and year first hereinabove written.</p>
<table><tr><th>Details of employer</th><th>Details of employee</th></tr><tr><td>Name: ${co.signatoryName ? esc(co.signatoryName) : line}<br>Designation: ${esc(co.signatoryDesignation)}<br>Date: ${line}<br>Place: ${line}<br>Signature: ${marksHtml(ctx.marks, co.signatoryName) || line}</td>
<td>Name: ${vars.name}<br>Employee Code: ${vars.employeeCode}<br>${eSign(ctx)}</td></tr></table>`;
  return `<div class="nda">${out}</div>`;
}

function offerFull(ctx: LetterCtx): string {
  const p = ctx.payload, co = coOf(ctx);
  const first = esc(ctx.name.split(" ")[0]) || ph("first name");
  const pf = p.pfApplicable === true;
  const state = String(p.ptState ?? "");
  const noPt = /uttar pradesh/i.test(state);
  const tbd = "[To be filled by HR]";
  const v = (k: string) => (blank(p[k]) ? `<span class="ph">${tbd}</span>` : esc(p[k]));
  const body = `${toBlock(ctx, p)}<p>Dear ${first},</p>
<p><b>Subject: Offer of Employment with ${esc(co.legalName)}</b></p>
<p>We are pleased to offer you employment with ${esc(co.legalName)} (“Complynz” or “the Company”) on the terms and conditions set out below and in the Annexures to this letter. Please read this offer letter carefully before signing.</p>
<p>This offer letter comprises this covering letter together with Annexure A (Employee Non-Disclosure, Confidentiality and Intellectual Property Assignment Agreement), which is enclosed herewith and forms an integral part of this offer.</p>
<h2>1. Position Details</h2>${table([row("Employee Code", v("employeeCode")), row("Designation", v("position")), row("Department", v("department")), row("Reporting Manager", v("reportingTo")),
  row("Work Location", blank(p.location) ? `<span class="ph">${tbd}</span>` : `${esc(p.location)} (or as designated by the Company)`), row("Date of Joining", blank(p.joiningDate) ? `<span class="ph">${tbd}</span>` : dateText(p, "joiningDate", "date of joining")), row("Employment Type", v("employmentType"))])}
<h2>2. Compensation</h2><p>Your compensation has been structured as per the Company’s standard salary breakup policy, as detailed below.${pf ? "" : " Please see the note on Provident Fund applicability below the table."}</p>${compTable(ctx)}
<p>Basic Salary is fixed at not less than 50% of Gross Salary, with HRA at 40% of Basic Salary, in accordance with the revised wage definition under the Code on Wages, 2019 (part of India’s four Labour Codes, in force since 21 November 2025), which requires Basic Pay and Dearness Allowance (together, “wages”) to constitute at least 50% of total remuneration — i.e., allowances such as HRA and Special Allowance together cannot exceed 50% of Gross Salary.</p>
${pf ? `<p><b>Provident Fund (PF):</b> You will be enrolled under the Employees’ Provident Funds and Miscellaneous Provisions Act, 1952. Employee and employer contributions of 12% each are calculated on PF wages up to the statutory wage ceiling and are part of the CTC shown above.</p>`
  : `<p><b>Provident Fund (PF):</b> As the Company presently has fewer than 20 (twenty) employees, registration and contribution under the Employees’ Provident Funds and Miscellaneous Provisions Act, 1952 is not statutorily mandatory. Accordingly, no PF deduction/contribution is being made at this time, and the amounts above represent your full monthly Gross Salary in hand (subject to applicable TDS). Should the Company’s headcount reach the statutory threshold, or should the Company elect to voluntarily extend PF coverage, you will be enrolled and this compensation structure will be revised in line with statutory requirements at that time, with due notice to you.</p>
<p>You may separately request voluntary PF coverage, at the Company’s discretion, by writing to HR.</p>`}
<p>Gratuity, where applicable, shall be governed by the Payment of Gratuity Act, 1972, and shall become payable only upon completion of 5 (five) years of continuous service (Gratuity Act applicability similarly depends on the Company crossing the prescribed employee threshold).</p>
<p>All figures are subject to applicable income tax deduction at source (TDS) under the Income Tax Act, 1961.${noPt ? " Professional Tax is not presently levied in the State of Uttar Pradesh." : state ? ` Professional Tax is deducted as applicable in the State of ${esc(state)}.` : ""}</p>
<h2>3. Confidentiality &amp; Intellectual Property</h2><p>As a pre-condition to your engagement, you will be required to execute the Company’s Employee Non-Disclosure, Confidentiality and Intellectual Property Assignment Agreement, attached to and forming part of this offer letter as Annexure A, prior to your Date of Joining. Any Confidential Information and Intellectual Property that you access, generate or develop in the course of your engagement shall at all times remain the sole and exclusive property of the Company, as more particularly set out in Annexure A. Please sign and return both the offer letter and Annexure A together.</p>
<h2>4. Background Verification</h2><p>This offer is contingent upon the satisfactory verification of your educational qualifications, prior employment record (if any), identity documents and references. The Company reserves the right to withdraw this offer, or terminate your engagement if already commenced, at any time if any information provided by you is found to be false, misleading or incomplete.</p>
<h2>5. Data Privacy &amp; Consent (Digital Personal Data Protection Act, 2023)</h2>
<p>${esc(co.legalName)} acts as the “Data Fiduciary” in relation to your personal data under the Digital Personal Data Protection Act, 2023 (“DPDP Act”) and rules framed thereunder. The processing described below is undertaken in accordance with the DPDP Act, and this Section also serves as the notice required under the DPDP Rules.</p>
<h3>A. Processing under “Legitimate Use” – no separate consent required</h3><p>The following categories of processing are reasonably necessary for your employment/engagement and for safeguarding the Company from loss or liability, and are undertaken as a “legitimate use” under Section 7(1)(i) of the DPDP Act, without requiring separate consent:</p>
<ul><li>Identity, education and address verification (KYC) for onboarding, statutory registration and compliance;</li><li>Payroll processing, tax deduction at source, and PF/ESI/gratuity administration (where applicable);</li><li>Performance management, attendance, training records and general HR administration;</li><li>Information security, physical security, access control and, where deployed at your work location, CCTV/system-log monitoring;</li><li>Internal investigations, audits, litigation and grievance redressal, and prevention of fraud, breach of confidentiality or loss to the Company.</li></ul>
<h3>B. Granular, opt-in consent</h3><p>For the purposes below, which go beyond what is strictly necessary for your employment, the Company is separately seeking your free, specific, informed and unambiguous consent. You choose “Yes” or “No” for each purpose separately on the secure online acceptance page, where each choice is recorded with the date and time in your consent log. Nothing is pre-selected. You may accept or decline each purpose independently — declining any or all of the following shall not affect your offer of employment/engagement or any statutory benefit. When you join, these choices move to your employee consent log, and you can change or withdraw any of them at any time from “My privacy” in the HR app.</p>${consentPartB(ctx)}
<h3>C. Data retention &amp; erasure</h3><p>Save as set out above, or as otherwise required under Applicable Law (including the Income Tax Act, 1961, the Companies Act, 2013, and applicable labour welfare legislations), the Company shall retain your personal data only for so long as is reasonably necessary for the purpose for which it was collected, and shall thereafter take reasonable steps to erase or anonymise such data in accordance with its internal Data Retention Policy.</p>
<h3>D. Storage &amp; processing location</h3><p>You acknowledge that the Company may process and store your personal data using cloud-based HR, payroll and communication systems that may be hosted outside India, through Company-appointed data processors who are contractually bound to maintain appropriate security safeguards, in accordance with Section 16 of the DPDP Act.</p>
<h3>E. Your rights</h3><p>Subject to the DPDP Act, the DPDP Rules and the Company’s Data Protection/Grievance Redressal Policy, you have the right to: (a) obtain a summary of the personal data processed and related processing activities; (b) seek correction, completion and updation of your personal data; (c) seek erasure of personal data that is no longer necessary for the purpose for which it was collected, subject to any legal retention requirement; (d) withdraw any consent given under Part B at any time, without affecting the lawfulness of processing carried out prior to such withdrawal or any processing carried out under Part A; (e) nominate another individual to exercise these rights in the event of your death or incapacity; and (f) lodge a grievance with the Company’s Grievance Officer/Data Protection Officer named below and, if unresolved, with the Data Protection Board of India.</p>
<p><b>Grievance Officer / Data Protection Officer:</b> ${co.grievanceOfficerName ? esc(co.grievanceOfficerName) : ph("name, set in Company details")} &nbsp;•&nbsp; Email: ${esc(co.grievanceOfficerEmail)} &nbsp;•&nbsp; Address: ${esc(co.registeredAddress)}</p>
<p>By signing this offer letter, you confirm that you have read this Section, understood the purposes and retention periods set out above, and recorded your consent choices in Part B by ticking and initialling each row.</p>
<h2>6. Working Hours &amp; Leave</h2><p>Your standard working hours, holidays and leave entitlement shall be as per the Company’s HR policy in force from time to time, and applicable provisions of the ${state ? esc(state) : "Uttar Pradesh"} Shops and Commercial Establishments Act.</p>
<h2>7. Code of Conduct &amp; Policies</h2><p>You shall be governed by the Company’s HR policies, Code of Conduct, Information Security Policy, Prevention of Sexual Harassment (POSH) Policy and other applicable policies, as amended by the Company from time to time. These policies do not form part of your contractual terms of employment but are binding on you as a matter of Company policy.</p>
<h2>8. Documents to be Submitted</h2><p>Please submit copies of the following documents on or before your Date of Joining:</p><ul><li>Government-issued photo identity proof (Aadhaar / Passport / Voter ID / Driving Licence)</li><li>PAN Card</li><li>Proof of current residential address</li><li>Copies of educational qualification certificates and mark sheets</li><li>Relieving letter and last three months’ salary slips from your previous employer (if applicable)</li><li>Passport-size photographs (2)</li><li>Bank account details for salary/stipend processing</li></ul>
<h2>9. Governing Law &amp; Jurisdiction</h2><p>This offer letter and the employment relationship arising herefrom shall be governed by the laws of India. The courts at ${esc(co.courts)} shall have exclusive jurisdiction over any disputes arising out of or in connection with this offer.</p>
<h2>10. Validity &amp; Acceptance</h2><p>This offer is valid for acceptance up to ${dateText(p, "validUntil", "offer valid until")}, failing which it shall stand automatically withdrawn. Please accept it on the secure online acceptance page: you verify your email with a one-time code, choose your data consents, and type your full name, which is your electronic signature on this letter and its Annexures.</p>
<p>We look forward to a long and mutually rewarding association with you.</p>${signature(ctx, co)}
<p style="margin-top:22px">I have read, understood and hereby accept the terms and conditions of this offer letter and its Annexures.</p>
<p>Employee Name: ${blank(p.salutation) ? "" : esc(p.salutation) + " "}${esc(ctx.name) || ph("name")}<br>${eSign(ctx)}</p>
<div class="pb"></div>${ndaHtml(ctx, co)}`;
  return doc(ctx, "Offer of employment", formalPage(ctx, body));
}

// ---------------------------------------------------------------- other letters
function formal(ctx: LetterCtx, title: string, subject: string, paras: string[], extra = "", confidential = true): string {
  const co = coOf(ctx);
  return doc(ctx, title, formalPage(ctx, `${toBlock(ctx, ctx.payload)}${dear(ctx)}<p><b>Subject: ${subject}</b></p>${paras.map((x) => `<p>${x}</p>`).join("")}${extra}${signature(ctx, co)}`, { confidential }));
}
/** Certificates are addressed to whom it may concern and carry the letterhead. */
function certificate(ctx: LetterCtx, title: string, paras: string[]): string {
  const co = coOf(ctx), d = issuedDay(ctx);
  return doc(ctx, title, letterheadPage(ctx, title, `<div class="to"><div>Ref: ${esc(ctx.refNo)}</div><div>${d ? esc(shortDate(d.toISOString().slice(0, 10))) : ph("date")}</div></div>
<p><b>TO WHOM IT MAY CONCERN</b></p>${paras.map((x) => `<p>${x}</p>`).join("")}${signature(ctx, co)}`));
}

export function renderLetter(ctx: LetterCtx): string {
  const p = ctx.payload, co = coOf(ctx), name = esc(ctx.name) || ph("employee name");
  switch (ctx.type) {
    case "offer_short": return offerShort(ctx);
    case "offer_full": return offerFull(ctx);
    case "appointment": return formal(ctx, "Appointment letter", "Letter of Appointment", [
      `Further to your acceptance of our offer, we are pleased to confirm your appointment as <b>${val(p, "position", "designation")}</b> in ${val(p, "department", "department")} with effect from ${dateText(p, "joiningDate", "date of joining")}.`,
      `Your monthly gross salary is ${money(p, "monthlyGrossPaise", "monthly gross")}, paid monthly subject to statutory deductions. The detailed structure is as shared in your offer letter.`,
      `You will be on probation for ${val(p, "probation", "probation period")}. After confirmation, either party may end employment by giving ${val(p, "noticePeriod", "notice period")} notice in writing, or salary in lieu of notice.`,
      "Your appointment is governed by the Company’s policies as amended from time to time, and by the Non-Disclosure, Confidentiality and IP Assignment Agreement you signed with your offer.",
      "We are glad to have you with us."]);
    case "internship_offer": return formal(ctx, "Internship offer", `Internship with ${esc(co.legalName)}`, [
      `We are pleased to offer you an internship as <b>${val(p, "position", "role")}</b> from ${dateText(p, "startDate", "start date")} to ${dateText(p, "endDate", "end date")}, based at ${val(p, "location", "location")}.`,
      `You will receive a monthly stipend of ${money(p, "stipendPaise", "stipend")}, subject to applicable tax deduction. Your mentor will be ${val(p, "reportingTo", "mentor")}.`,
      "This internship is a training engagement and does not by itself create an offer of employment. You will be bound by the Company’s confidentiality, IP and conduct policies, and will sign the Company’s NDA before you start.",
      `Please confirm your acceptance by ${dateText(p, "validUntil", "reply by")}.`]);
    case "confirmation": return formal(ctx, "Confirmation letter", "Confirmation of Employment", [
      `We are pleased to inform you that you have successfully completed your probation. Your employment as <b>${val(p, "position", "designation")}</b> is confirmed with effect from ${dateText(p, "confirmationDate", "confirmation date")}.`,
      `From this date, the notice period applicable to you is ${val(p, "noticePeriod", "notice period")}. All other terms of your appointment remain unchanged.`,
      "Thank you for your contribution so far. We look forward to your continued growth with us."]);
    case "appraisal": return formal(ctx, "Appraisal letter", `Annual Performance Review, ${val(p, "reviewPeriod", "review period")}`, [
      `Thank you for your contribution during ${val(p, "reviewPeriod", "the review period")}. Based on your performance review${blank(p.rating) ? "" : `, with an overall rating of <b>${esc(p.rating)}</b>`}, we are pleased to revise your compensation.`,
      `Your monthly gross salary will change from ${money(p, "currentMonthlyGrossPaise", "current gross", false)} to <b>${money(p, "newMonthlyGrossPaise", "revised gross")}</b> with effect from ${dateText(p, "effectiveFrom", "effective date")}.`,
      ...(blank(p.note) ? [] : [esc(p.note)]),
      "All other terms of your employment remain unchanged. The revised salary details are strictly confidential."]);
    case "increment": return formal(ctx, "Increment letter", "Revision of Salary", [
      `We are pleased to inform you that your monthly gross salary has been revised from ${money(p, "currentMonthlyGrossPaise", "current gross", false)} to <b>${money(p, "newMonthlyGrossPaise", "revised gross")}</b> with effect from ${dateText(p, "effectiveFrom", "effective date")}${blank(p.reason) ? "" : `, in recognition of ${esc(p.reason)}`}.`,
      "All other terms of your employment remain unchanged. The revised salary details are strictly confidential."]);
    case "promotion": return formal(ctx, "Promotion letter", "Promotion", [
      `We are delighted to inform you that you have been promoted from ${val(p, "currentDesignation", "current designation")} to <b>${val(p, "newDesignation", "new designation")}</b> with effect from ${dateText(p, "effectiveFrom", "effective date")}.`,
      ...(typeof p.newMonthlyGrossPaise === "number" ? [`Your revised monthly gross salary will be <b>${money(p, "newMonthlyGrossPaise", "new gross")}</b> from the same date.`] : []),
      ...(blank(p.newReportingTo) ? [] : [`In your new role you will report to ${esc(p.newReportingTo)}.`]),
      "This promotion reflects the ownership and impact you have shown. Congratulations, and all the best in your new role."]);
    case "transfer": return formal(ctx, "Transfer letter", "Transfer of Work Location", [
      `With effect from ${dateText(p, "effectiveFrom", "effective date")}, you are transferred from ${val(p, "fromLocation", "current location")} to <b>${val(p, "toLocation", "new location")}</b>.`,
      ...(blank(p.newReportingTo) ? [] : [`At your new location you will report to ${esc(p.newReportingTo)}.`]),
      ...(blank(p.relocationSupport) ? [] : [`Relocation support: ${esc(p.relocationSupport)}`]),
      "Professional tax and other state-specific deductions will follow your new work location from the effective date. All other terms of your employment remain unchanged."]);
    case "warning": return formal(ctx, "Warning letter", "Written Warning", [
      `This letter concerns the following matter${blank(p.incidentDate) ? "" : ` on ${dateText(p, "incidentDate", "date")}`}: ${val(p, "issue", "what happened")}.`,
      `What is expected from you: ${val(p, "expectation", "expectation")}.`,
      "You may respond in writing within 7 days, and your response will be kept on record with this letter. This warning stays on your file for 12 months. Repeated or serious concerns may lead to further action under Company policy."]);
    case "pip": return formal(ctx, "Performance improvement plan", "Performance Improvement Plan", [
      `This plan supports you in meeting the expectations of your role. It runs for ${val(p, "lengthDays", "30, 60 or 90")} days from ${dateText(p, "startDate", "start date")}.`,
      `Concerns: ${val(p, "concerns", "concerns")}.`, `Support offered: ${val(p, "support", "support")}.`,
      "Signing or acknowledging this letter confirms you received it, not that you agree with it. You may add your own response in the system. The plan records progress; it does not by itself change your employment."]);
    case "relieving": return formal(ctx, "Relieving letter", "Relieving Letter", [
      `This is with reference to your resignation dated ${dateText(p, "resignationDate", "resignation date")}. Your resignation has been accepted and you are relieved from the services of ${esc(co.legalName)} at the close of business on <b>${dateText(p, "lastWorkingDay", "last working day")}</b>.`,
      `You were working with us as ${val(p, "position", "designation")}. Your full and final settlement is processed separately.`,
      "Please note that your obligations of confidentiality and IP assignment under the agreement you signed continue after you leave. We thank you for your contributions and wish you success."]);
    case "experience": return certificate(ctx, "Experience Letter", [
      `This is to certify that <b>${name}</b> was employed with ${esc(co.legalName)} as <b>${val(p, "position", "designation")}</b> from ${dateText(p, "joiningDate", "date of joining")} to ${dateText(p, "lastWorkingDay", "last working day")}.`,
      `During this period their conduct was ${val(p, "conduct", "conduct")}. We wish them every success in the future.`]);
    case "internship_certificate": return certificate(ctx, "Internship Certificate", [
      `This is to certify that <b>${name}</b> completed an internship with ${esc(co.legalName)} as <b>${val(p, "position", "role")}</b> from ${dateText(p, "startDate", "start date")} to ${dateText(p, "endDate", "end date")}.`,
      ...(blank(p.projectSummary) ? [] : [`During the internship they worked on ${esc(p.projectSummary)}.`]), "We wish them the very best."]);
    case "fnf_statement": return renderFnf(ctx);
    case "asset_contract": {
      const cost = typeof p.assetCostPaise === "number" ? rupees(p.assetCostPaise) : ph("asset cost");
      return doc(ctx, "Asset agreement", formalPage(ctx, `<h2>Asset Issue and Responsibility Agreement</h2><p>Employee: <b>${name}</b></p>
${table([row("Asset", val(p, "assetDescription", "asset description")), row("Asset tag / serial", `${val(p, "assetTag", "asset tag")} / ${val(p, "serialNo", "serial number")}`),
  row("Accessories", val(p, "accessories", "accessories")), row("Cost of asset", cost), row("Date of issue", dateText(p, "issuedOn", "issue date"))])}
<ol><li>I confirm I received the asset above in intact, working condition, with the accessories listed.</li><li>I will use it for Company work, keep it safe, and not lend or modify it.</li>
<li>Accidental damage, loss or theft caused while the asset is with me is my responsibility, and I agree the Company may recover up to the cost of the asset stated above, in line with applicable law, from amounts due to me.</li>
<li>I will return the asset in working condition when asked or when my employment ends.</li><li>Fair wear and tear is not damage.</li></ol>
<p>Employee signature: ____________________ &nbsp; Date: ______________</p>${signature(ctx, co)}`));
    }
    default: return doc(ctx, letterLabel(ctx.type), formalPage(ctx, `<p>${ph("letter content")}</p>`));
  }
}

/** Full and final statement, from the settlement saved in Exits (payload.fnf). */
type FnfLine = { label: string; amountPaise: number; note?: string };
function renderFnf(ctx: LetterCtx): string {
  const p = ctx.payload, co = coOf(ctx);
  const f = (p.fnf ?? {}) as { earnings?: FnfLine[]; deductions?: FnfLine[]; netPaise?: number; lastWorkingDay?: string; joiningDate?: string; payBy?: string; position?: string; code?: string };
  const lines = (ls: FnfLine[] | undefined) => (ls ?? []).map((l) => `<tr><td>${esc(l.label)}${l.note ? `<br><span style="font-size:11px;color:#5b6478">${esc(l.note)}</span>` : ""}</td><td class="r">${rupees(l.amountPaise)}</td></tr>`).join("");
  const sum = (ls: FnfLine[] | undefined) => (ls ?? []).reduce((a, l) => a + l.amountPaise, 0);
  const net = f.netPaise ?? sum(f.earnings) - sum(f.deductions);
  return doc(ctx, "Full and final settlement", formalPage(ctx, `<h2>Full and Final Settlement Statement</h2>
${table([row("Employee", `${name(ctx)}${f.code ? ` (${esc(f.code)})` : ""}`), row("Designation", f.position ? esc(f.position) : ph("designation")),
  row("Date of joining", f.joiningDate ? esc(longDate(f.joiningDate)) : ph("joining date")), row("Last working day", f.lastWorkingDay ? esc(longDate(f.lastWorkingDay)) : ph("last working day"))])}
<table><tr><th>Payable to you</th><th class="r">Amount</th></tr>${lines(f.earnings)}<tr class="tot"><td>Total payable</td><td class="r">${rupees(sum(f.earnings))}</td></tr></table>
<table><tr><th>Recoveries and deductions</th><th class="r">Amount</th></tr>${lines(f.deductions)}<tr class="tot"><td>Total deductions</td><td class="r">${rupees(sum(f.deductions))}</td></tr></table>
<table><tr class="tot"><td>${net >= 0 ? "Net amount payable to you" : "Net amount recoverable from you"}</td><td class="r">${rupees(Math.abs(net))} (${esc(amountInWords(Math.abs(net)))})</td></tr></table>
<p>${net >= 0 ? `This amount will be credited to your salary account${f.payBy ? ` by ${esc(longDate(f.payBy))}` : ""}, within the time allowed under the Code on Wages, 2019.` : "Please pay this amount to the Company as agreed."} Gratuity, if applicable, is shown above when due. Income tax has been worked out on your total income for the year.</p>
<p>Please check the statement and raise any question with HR within 15 days. Your Form 16 for the year will be issued in the usual timeline.</p>${signature(ctx, co)}
<p style="margin-top:20px">I confirm I have received this statement.<br>Employee signature: ____________________ &nbsp; Date: ______________</p>`));
}
const name = (ctx: LetterCtx) => esc(ctx.name) || ph("employee name");

/** A branded working document (not a letter to a person), used for compliance templates. Yellow marks show what to fill in. */
export function companyDocument(company: Partial<CompanyProfile> | undefined, title: string, body: string): string {
  const co = { ...COMPANY_DEFAULTS, ...Object.fromEntries(Object.entries(company ?? {}).filter(([, v]) => !blank(v))) } as Co;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${CSS}${MARKS_CSS}</style></head><body>
<div class="page"><div class="hdr">${logo(34)}<span class="c">${esc(co.legalName.toUpperCase())}</span></div><h1 class="title" style="font-size:22px">${esc(title)}</h1>${body}
<div class="legal">${esc(co.legalName)} · ${esc(co.registeredAddress)} · ${esc(co.email)} · ${esc(co.website)}</div></div></body></html>`;
}
export const fillIn = (s: string) => ph(s);
