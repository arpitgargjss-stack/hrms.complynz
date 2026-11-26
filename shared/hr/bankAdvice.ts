import { createHash } from "node:crypto";
import { formatINR, amountInWords, type Paise } from "./money";

export interface AdviceRow { srNo: number; name: string; bankName: string; accountNo: string; ifsc: string; amountPaise: Paise }
export interface AdviceInput { month: string; refNo: string; rows: Omit<AdviceRow, "srNo">[] }

const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export function validateRow(r: Omit<AdviceRow, "srNo">): string[] {
  const errs: string[] = [];
  if (!r.name.trim()) errs.push("Name missing");
  if (!r.bankName.trim()) errs.push("Bank name missing");
  if (!r.accountNo) errs.push("Account number missing");
  else if (!/^\d{9,18}$/.test(r.accountNo)) errs.push("Account number must be 9 to 18 digits");
  if (!r.ifsc) errs.push("IFSC missing");
  else if (!IFSC.test(r.ifsc)) errs.push(`IFSC "${r.ifsc}" is invalid (expected 11 characters like HDFC0001234)`);
  if (!Number.isInteger(r.amountPaise) || r.amountPaise <= 0) errs.push("Amount must be positive");
  return errs;
}

export function buildAdvice(input: AdviceInput) {
  const errors: { row: number; errors: string[] }[] = [];
  input.rows.forEach((r, i) => { const e = validateRow(r); if (e.length) errors.push({ row: i + 1, errors: e }); });
  if (errors.length) return { ok: false as const, errors };
  const rows: AdviceRow[] = [...input.rows].sort((a, b) => a.name.localeCompare(b.name)).map((r, i) => ({ srNo: i + 1, ...r }));
  const totalPaise = rows.reduce((s, r) => s + r.amountPaise, 0);
  const contentHash = createHash("sha256").update(JSON.stringify({ m: input.month, ref: input.refNo, rows })).digest("hex");
  return { ok: true as const, rows, totalPaise, totalFormatted: formatINR(totalPaise), totalWords: amountInWords(totalPaise), contentHash };
}

/** Bulk-upload CSV for the bank. Fields are quoted; formula-leading characters are neutralised. */
export function toCsv(rows: AdviceRow[]): string {
  const safe = (v: string) => `"${(/^[=+\-@]/.test(v) ? "'" + v : v).replace(/"/g, '""')}"`;
  const head = ["Sr No", "Name", "Bank Name", "Account No", "IFSC", "Amount"].join(",");
  return [head, ...rows.map((r) => [r.srNo, safe(r.name), safe(r.bankName), safe(r.accountNo), safe(r.ifsc), (r.amountPaise / 100).toFixed(2)].join(","))].join("\n");
}
