import type { Line, SalaryResult } from "./payroll";

/**
 * Importing payslips for months that were paid outside the HRMS.
 * One sheet per month: a row per employee with the amounts actually paid, in rupees.
 */
export const IMPORT_COLUMNS = [
  { key: "code", label: "Employee code" },
  { key: "name", label: "Employee name" },
  { key: "paidDays", label: "Paid days" },
  { key: "calendarDays", label: "Days in month" },
  { key: "BASIC", label: "Basic", kind: "earning" },
  { key: "HRA", label: "House rent allowance", kind: "earning" },
  { key: "SPECIAL", label: "Special allowance", kind: "earning" },
  { key: "OTHER_EARN", label: "Other earnings", kind: "earning" },
  { key: "reimb", label: "Reimbursements" },
  { key: "PF_EE", label: "Provident fund (employee)", kind: "deduction" },
  { key: "ESI_EE", label: "ESI (employee)", kind: "deduction" },
  { key: "PT", label: "Professional tax", kind: "deduction" },
  { key: "TDS", label: "Income tax (TDS)", kind: "deduction" },
  { key: "OTHER_DED", label: "Other deductions", kind: "deduction" },
  { key: "PF_ER", label: "Provident fund (employer)", kind: "employer" },
  { key: "net", label: "Net pay" },
] as const;

export type ImportedSlip = { code: string; name: string; paidDaysX2: number; calendarDays: number; result: SalaryResult };
export type ImportIssue = { row: number; code: string; message: string };

/** "12,345.50" or "₹ 12345.5" → paise. Blank is 0. Returns null when it is not a non-negative amount. */
export function rupeesToPaise(s: string): number | null {
  const t = s.replace(/[₹,\s]/g, "").replace(/^INR/i, "");
  if (t === "" || t === "-") return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const [r, p = ""] = t.split(".");
  return Number(r) * 100 + Number((p + "00").slice(0, 2));
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/**
 * Parse sheet rows (first row = header) into payslip results. Columns are matched by header text, so their order may change.
 * `known` maps employee code to name for the people employed in that month.
 */
export function parseImport(rows: string[][], month: string, known: Map<string, string>): { slips: ImportedSlip[]; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  if (!rows.length) return { slips: [], issues: [{ row: 0, code: "", message: "The file is empty" }] };
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const header = rows[0].map(norm);
  const idx: Record<string, number> = {};
  for (const c of IMPORT_COLUMNS) idx[c.key] = header.indexOf(norm(c.label));
  const missing = IMPORT_COLUMNS.filter((c) => idx[c.key] < 0 && c.key !== "name");
  if (missing.length) return { slips: [], issues: [{ row: 1, code: "", message: `Missing columns: ${missing.map((c) => c.label).join(", ")}. Use the downloaded template.` }] };
  const cal = daysInMonth(month);
  const seen = new Set<string>();
  const slips: ImportedSlip[] = [];
  rows.slice(1).forEach((r, i) => {
    const rowNo = i + 2;
    const get = (k: string) => (idx[k] >= 0 ? r[idx[k]] ?? "" : "");
    const code = get("code").toUpperCase();
    if (!code) { issues.push({ row: rowNo, code: "", message: "Employee code is blank" }); return; }
    if (!known.has(code)) { issues.push({ row: rowNo, code, message: "No employee with this code was employed in this month" }); return; }
    if (seen.has(code)) { issues.push({ row: rowNo, code, message: "This employee appears twice" }); return; }
    seen.add(code);
    const amt: Record<string, number> = {};
    let bad = false;
    for (const c of IMPORT_COLUMNS) {
      if (c.key === "code" || c.key === "name" || c.key === "paidDays" || c.key === "calendarDays") continue;
      const v = rupeesToPaise(get(c.key));
      if (v === null) { issues.push({ row: rowNo, code, message: `${c.label} is not a valid amount: "${get(c.key)}"` }); bad = true; }
      amt[c.key] = v ?? 0;
    }
    const pd = Number(get("paidDays") || cal);
    const cd = Number(get("calendarDays") || cal);
    if (!Number.isFinite(pd) || pd < 0 || pd > cd || Math.round(pd * 2) !== pd * 2) { issues.push({ row: rowNo, code, message: "Paid days must be between 0 and the days in the month, in steps of half a day" }); bad = true; }
    if (cd !== cal) { issues.push({ row: rowNo, code, message: `Days in month should be ${cal}` }); bad = true; }
    if (bad) return;
    const lines = (kind: string): Line[] => IMPORT_COLUMNS.filter((c) => "kind" in c && c.kind === kind && amt[c.key] > 0).map((c) => ({ code: c.key, name: c.label, amount: amt[c.key] }));
    const earnings = lines("earning"), deductions = lines("deduction"), employer = lines("employer");
    const gross = earnings.reduce((s, l) => s + l.amount, 0), ded = deductions.reduce((s, l) => s + l.amount, 0);
    const computedNet = gross + amt.reimb - ded;
    const net = amt.net || computedNet;
    if (Math.abs(net - computedNet) > 100) { issues.push({ row: rowNo, code, message: `Net pay ${net / 100} does not equal earnings plus reimbursements minus deductions (${computedNet / 100})` }); return; }
    if (gross === 0) { issues.push({ row: rowNo, code, message: "No earnings entered" }); return; }
    slips.push({
      code, name: known.get(code)!, paidDaysX2: pd * 2, calendarDays: cd,
      result: { earnings, deductions, employerContributions: employer, grossFullPaise: gross, grossPaidPaise: gross, totalDeductionsPaise: ded, reimbursementsPaise: amt.reimb, netPayPaise: net, pfWagePaise: amt.BASIC },
    });
  });
  return { slips, issues };
}
