import { z } from "zod";
import { amountInWords, formatINR, type Paise } from "../../shared/hr/money";
import { leaveDaysX2, type CalendarSettings, type Holiday } from "../../shared/hr/leave";
import type { AdviceRow } from "../../shared/hr/bankAdvice";
import type { SalaryResult, StatutoryRules } from "../../shared/hr/payroll";

/** Pure helpers for the payroll routes. No I/O, no env, safe to unit test. */

// ---------- validation schemas ----------
const paise = z.number().int().min(0);
const bpsN = z.number().int().min(0).max(10000);

/** Matches StatutoryRules. Every value is required: there are no defaults for statutory numbers. */
export const rulesSchema = z.object({
  pf: z.object({ enabled: z.boolean(), employeeBps: bpsN, employerBps: bpsN, wageCeilingPaise: paise.nullable() }).strict(),
  tds: z.object({
    enabled: z.boolean(),
    slabs: z.array(z.object({ upToPaise: paise.nullable(), rateBps: bpsN }).strict()),
    standardDeductionPaise: paise,
    cessBps: bpsN,
    rebate: z.object({ thresholdPaise: paise, maxRebatePaise: paise }).strict().optional(),
  }).strict(),
  professionalTax: z.object({ enabled: z.boolean(), monthlyPaise: paise }).strict(),
}).strict().superRefine((r, ctx) => {
  const s = r.tds.slabs;
  if (r.tds.enabled && s.length === 0) ctx.addIssue({ code: "custom", path: ["tds", "slabs"], message: "TDS is enabled but no slabs are given" });
  s.forEach((slab, i) => {
    const last = i === s.length - 1;
    if (last && slab.upToPaise !== null) ctx.addIssue({ code: "custom", path: ["tds", "slabs", i], message: "The last slab must have upToPaise null" });
    if (!last) {
      if (slab.upToPaise === null) ctx.addIssue({ code: "custom", path: ["tds", "slabs", i], message: "Only the last slab may be open ended" });
      else if (i > 0 && s[i - 1].upToPaise !== null && slab.upToPaise <= (s[i - 1].upToPaise as number)) ctx.addIssue({ code: "custom", path: ["tds", "slabs", i], message: "Slabs must be ascending" });
    }
  });
});
export type RulesInput = z.infer<typeof rulesSchema> & StatutoryRules;

const calc = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fixed"), amount: paise }),
  z.object({ type: z.literal("percent"), of: z.string().min(1).max(30), bps: z.number().int().min(0).max(1000000) }),
  z.object({ type: z.literal("balance") }),
]);
export const componentSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{0,19}$/, "Use upper case letters, digits and underscore"),
  name: z.string().trim().min(1).max(80),
  calc,
  pfWage: z.boolean().optional(),
  taxable: z.boolean().optional(),
});
export const componentsSchema = z.array(componentSchema).min(1).max(40);

// ---------- dates and Indian financial year ----------
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export function monthDays(month: string): number { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
export function monthStart(month: string): string { return `${month}-01`; }
export function monthEnd(month: string): string { return `${month}-${String(monthDays(month)).padStart(2, "0")}`; }
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function monthLabel(month: string): string { return `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`; }

/** First month (YYYY-MM) of the Indian FY (Apr-Mar) containing `month`. */
export function fyStartMonth(month: string): string {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  return `${m >= 4 ? y : y - 1}-04`;
}
/** Months left in the FY including `month` (Apr=12 ... Mar=1). */
export function monthsRemainingInFy(month: string): number {
  const m = Number(month.slice(5, 7));
  return m >= 4 ? 16 - m : 4 - m;
}
/** Months of the FY strictly before `month`, oldest first. */
export function priorMonthsInFy(month: string): string[] {
  const out: string[] = [];
  let [y, m] = fyStartMonth(month).split("-").map(Number);
  while (`${y}-${String(m).padStart(2, "0")}` < month) { out.push(`${y}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}
/** TDS deducted in a stored payslip result. */
export function tdsOfResult(result: unknown): Paise {
  const d = (result as { deductions?: { code: string; amount: number }[] } | null)?.deductions ?? [];
  return d.filter((l) => l.code === "TDS").reduce((s, l) => s + l.amount, 0);
}
/** Gross earnings already paid this FY (all earnings treated as taxable; reimbursements are outside gross). */
export function sumGrossYtd(results: unknown[]): Paise { return results.reduce<number>((s, r) => s + ((r as { grossPaidPaise?: number } | null)?.grossPaidPaise ?? 0), 0); }
export function sumTdsYtd(results: unknown[]): Paise { return results.reduce<number>((s, r) => s + tdsOfResult(r), 0); }

// ---------- loss of pay ----------
/** Normalise the stored calendar (the saturdays key may be saved as `mode` or `type`). */
export function normaliseCalendar(raw: unknown): CalendarSettings | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as { weeklyOff?: number[]; saturdays?: { mode?: string; type?: string; offWeeks?: number[] }; workStart?: string; workEnd?: string };
  const mode = (c.saturdays?.mode ?? c.saturdays?.type ?? "all_working") as CalendarSettings["saturdays"]["mode"];
  return { weeklyOff: c.weeklyOff ?? [0], saturdays: { mode, offWeeks: c.saturdays?.offWeeks }, workStart: c.workStart ?? "09:00", workEnd: c.workEnd ?? "18:00" };
}

export interface EmploymentWindow { start: string; end: string }
/** The part of the month the person was employed. */
export function employmentWindow(month: string, joiningDate: string, lastWorkingDay: string | null): EmploymentWindow {
  const s = monthStart(month), e = monthEnd(month);
  return { start: joiningDate > s ? joiningDate : s, end: lastWorkingDay && lastWorkingDay < e ? lastWorkingDay : e };
}
/** Half-days of the month outside the employment window (before joining / after the last working day). */
export function employmentGapX2(month: string, w: EmploymentWindow): number {
  if (w.end < w.start) return monthDays(month) * 2;
  const before = Number(w.start.slice(8, 10)) - 1;
  const after = monthDays(month) - Number(w.end.slice(8, 10));
  return (before + after) * 2;
}

export interface UnpaidLeave { fromDate: string; toDate: string; halfDay: boolean | null; days2: number }
/** Loss-of-pay half-days from approved unpaid leave inside the employment window. */
export function lossOfPayX2(leaves: UnpaidLeave[], w: EmploymentWindow, cal: CalendarSettings | null, holidays: Holiday[]): number {
  let total = 0;
  for (const l of leaves) {
    const from = l.fromDate < w.start ? w.start : l.fromDate;
    const to = l.toDate > w.end ? w.end : l.toDate;
    if (to < from) continue;
    if (l.halfDay) { total += l.days2; continue; }
    if (from === l.fromDate && to === l.toDate) { total += l.days2; continue; } // fully inside: use the stored count
    if (!cal) throw new Error("Work calendar is not configured, so leave spanning two months cannot be split");
    total += leaveDaysX2(from, to, false, cal, holidays);
  }
  return total;
}

// ---------- html ----------
export function esc(v: unknown): string {
  return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
const money = (p: Paise) => esc(formatINR(p, ""));
const BASE_CSS = `*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;padding:24px;font-size:13px;line-height:1.45}
.sheet{max-width:780px;margin:0 auto}h1{font-size:20px;margin:0}h2{font-size:14px;margin:18px 0 6px;text-transform:uppercase;letter-spacing:.04em;color:#444}
table{width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:6px 8px;text-align:left;vertical-align:top}th{background:#f1f1f1}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}.meta td{border:none;padding:2px 8px 2px 0}.muted{color:#666;font-size:12px}
.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:12px}
.tot td{font-weight:bold;background:#fafafa}@media print{body{padding:0}.noprint{display:none}}`;

export interface PayslipView {
  company: string; month: string;
  employee: { name: string; code: string; designation: string | null; department: string | null; joiningDate: string; panMasked: string | null; bankName: string | null; accountMasked: string | null };
  paidDaysX2: number; calendarDays: number; result: SalaryResult;
}
export function renderPayslipHtml(v: PayslipView): string {
  const r = v.result;
  const e = v.employee;
  const rowsOf = (lines: { name: string; amount: number }[]) => lines.map((l) => `<tr><td>${esc(l.name)}</td><td class="n">${money(l.amount)}</td></tr>`).join("") || `<tr><td colspan="2" class="muted">None</td></tr>`;
  const empl = r.employerContributions ?? [];
  const paidDays = v.paidDaysX2 / 2;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payslip ${esc(monthLabel(v.month))} ${esc(e.code)}</title><style>${BASE_CSS}</style></head><body><div class="sheet">
<div class="head"><div><h1>${esc(v.company)}</h1><div class="muted">Payslip for ${esc(monthLabel(v.month))}</div></div><div class="muted" style="text-align:right">Confidential</div></div>
<table class="meta"><tr><td><b>Employee</b></td><td>${esc(e.name)}</td><td><b>Employee code</b></td><td>${esc(e.code)}</td></tr>
<tr><td><b>Designation</b></td><td>${esc(e.designation ?? "-")}</td><td><b>Department</b></td><td>${esc(e.department ?? "-")}</td></tr>
<tr><td><b>Date of joining</b></td><td>${esc(e.joiningDate)}</td><td><b>PAN</b></td><td>${esc(e.panMasked ?? "-")}</td></tr>
<tr><td><b>Bank</b></td><td>${esc(e.bankName ?? "-")}</td><td><b>Account</b></td><td>${esc(e.accountMasked ?? "-")}</td></tr>
<tr><td><b>Paid days</b></td><td>${esc(paidDays)} of ${esc(v.calendarDays)}</td><td></td><td></td></tr></table>
<h2>Earnings and deductions</h2>
<table><tr><th>Earnings</th><th class="n">Amount (INR)</th></tr>${rowsOf(r.earnings)}<tr class="tot"><td>Gross earnings</td><td class="n">${money(r.grossPaidPaise)}</td></tr></table>
<div style="height:10px"></div>
<table><tr><th>Deductions</th><th class="n">Amount (INR)</th></tr>${rowsOf(r.deductions)}<tr class="tot"><td>Total deductions</td><td class="n">${money(r.totalDeductionsPaise)}</td></tr></table>
${r.reimbursementsPaise ? `<div style="height:10px"></div><table><tr><th>Reimbursements (not part of gross)</th><th class="n">Amount (INR)</th></tr><tr><td>Approved claims paid with salary</td><td class="n">${money(r.reimbursementsPaise)}</td></tr></table>` : ""}
<h2>Net pay</h2>
<table><tr class="tot"><td>Net pay</td><td class="n">${money(r.netPayPaise)}</td></tr><tr><td colspan="2">${esc(amountInWords(r.netPayPaise))}</td></tr></table>
${empl.length ? `<h2>Employer contributions (not paid to employee)</h2><table>${rowsOf(empl)}</table>` : ""}
<p class="muted" style="margin-top:18px">This is a computer generated payslip and does not need a signature. Bank account is shown masked.</p>
<p class="noprint"><button onclick="window.print()">Print / Save as PDF</button></p>
</div></body></html>`;
}

export interface AdviceView {
  company: string; refNo: string; month: string; date: string;
  to: { bank: string; branch: string; city: string; debitAccount: string };
  rows: AdviceRow[]; totalPaise: Paise;
  signed: { name: string; designation: string; at: string; signatureUri: string | null; stampUri: string | null } | null;
}
export function renderAdviceHtml(v: AdviceView): string {
  const rows = v.rows.map((r) => `<tr><td>${esc(r.srNo)}</td><td>${esc(r.name)}</td><td>${esc(r.bankName)}</td><td>${esc(r.accountNo)}</td><td>${esc(r.ifsc)}</td><td class="n">${money(r.amountPaise)}</td></tr>`).join("");
  const img = (uri: string | null, alt: string) => (uri && /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(uri) ? `<img alt="${esc(alt)}" src="${uri}" style="max-height:80px;max-width:200px">` : "");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Bank advice ${esc(v.refNo)}</title><style>${BASE_CSS}</style></head><body><div class="sheet">
<div class="head"><div><h1>${esc(v.company)}</h1></div><div style="text-align:right"><div>Ref: <b>${esc(v.refNo)}</b></div><div>Date: ${esc(v.date)}</div></div></div>
<p>To,<br>The Manager<br>${esc(v.to.bank)}<br>${esc(v.to.branch)}<br>${esc(v.to.city)}</p>
<p><b>Subject: Salary payment for ${esc(monthLabel(v.month))}</b></p>
<p>Dear Sir or Madam,</p>
<p>Please debit our account number ${esc(v.to.debitAccount)} maintained with you for the total amount of INR ${money(v.totalPaise)} and credit the salaries of the employees listed below to their respective bank accounts.</p>
<table><tr><th>Sr no</th><th>Name</th><th>Bank name</th><th>Account no</th><th>IFSC</th><th class="n">Amount (INR)</th></tr>${rows}
<tr class="tot"><td colspan="5">Total (${esc(v.rows.length)} payments)</td><td class="n">${money(v.totalPaise)}</td></tr></table>
<p><b>Total in words:</b> ${esc(amountInWords(v.totalPaise))}</p>
<p>Thanking you,<br>For ${esc(v.company)}</p>
<div style="display:flex;gap:40px;align-items:flex-end;margin-top:12px;min-height:90px">${v.signed ? `<div>${img(v.signed.signatureUri, "Signature")}</div><div>${img(v.signed.stampUri, "Company stamp")}</div>` : `<div class="muted">Not yet signed. Signature and stamp are added when the authorised signatory signs this advice.</div>`}</div>
${v.signed ? `<p>${esc(v.signed.name)}<br>${esc(v.signed.designation)}<br><span class="muted">Signed electronically on ${esc(v.signed.at)}</span></p>` : `<p>Authorised signatory</p>`}
<p class="muted">Contains full bank account numbers. Handle as confidential.</p>
<p class="noprint"><button onclick="window.print()">Print / Save as PDF</button></p>
</div></body></html>`;
}

// ---------- bank advice ----------
export function nextAdviceRef(month: string, existingRefs: string[]): string {
  let max = 0;
  for (const r of existingRefs) { const m = new RegExp(`^BA/${month}/(\\d+)$`).exec(r); if (m) max = Math.max(max, Number(m[1])); }
  return `BA/${month}/${max + 1}`;
}
export function maskAccount(a: string): string { return a.length <= 4 ? "*".repeat(a.length) : "*".repeat(a.length - 4) + a.slice(-4); }
export function maskedRows(rows: AdviceRow[]): AdviceRow[] { return rows.map((r) => ({ ...r, accountNo: maskAccount(r.accountNo) })); }
export function safeFileName(s: string): string { return s.replace(/[^\w.\-]/g, "_"); }

export interface SlipTotals { headcount: number; grossPaidPaise: number; deductionsPaise: number; reimbursementsPaise: number; netPayPaise: number; employerContributionsPaise: number }
export function totalsOf(results: SalaryResult[]): SlipTotals {
  const t: SlipTotals = { headcount: results.length, grossPaidPaise: 0, deductionsPaise: 0, reimbursementsPaise: 0, netPayPaise: 0, employerContributionsPaise: 0 };
  for (const r of results) {
    t.grossPaidPaise += r.grossPaidPaise; t.deductionsPaise += r.totalDeductionsPaise; t.reimbursementsPaise += r.reimbursementsPaise; t.netPayPaise += r.netPayPaise;
    t.employerContributionsPaise += (r.employerContributions ?? []).reduce((s, l) => s + l.amount, 0);
  }
  return t;
}
