import type { Paise } from "./money";
export interface ReimbPolicy {
  ratePerKmPaise: Record<string, number>; // e.g. self_car:1000, two_wheeler:500 (paise per km)
  billRequiredAbovePaise: Paise; managerApprovalAbovePaise: Paise; ceoApprovalAbovePaise: Paise;
  submitWithinDays: number;
  cityCaps?: Record<string, Paise>; // admin-supplied; empty until confirmed
}
export interface ClaimInput { category: "travel" | "expense" | "technology"; mode?: string; distanceKm?: number; amountPaise: Paise; hasBill: boolean; expenseDate: string; submittedOn: string; month: string }
export interface PolicyFlag { code: string; message: string; blocking: boolean }

function monthEnd(month: string): string { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); }
function addDays(d: string, n: number): string { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }

export function checkClaim(c: ClaimInput, p: ReimbPolicy): { flags: PolicyFlag[]; expectedAmountPaise: Paise | null; approver: "finance" | "manager" | "ceo" } {
  const flags: PolicyFlag[] = [];
  let expected: Paise | null = null;
  if (c.category === "travel" && c.mode && p.ratePerKmPaise[c.mode] !== undefined) {
    if (!c.distanceKm || c.distanceKm <= 0) flags.push({ code: "distance_required", message: "Distance is required for this mode", blocking: true });
    else {
      expected = c.distanceKm * p.ratePerKmPaise[c.mode];
      if (c.amountPaise !== expected) flags.push({ code: "rate_mismatch", message: "Amount differs from the per-km rate", blocking: true });
    }
  }
  if (c.amountPaise > p.billRequiredAbovePaise && !c.hasBill) flags.push({ code: "bill_required", message: "A bill is required above the policy limit", blocking: true });
  if (c.submittedOn > addDays(monthEnd(c.month), p.submitWithinDays)) flags.push({ code: "late", message: "Submitted after the allowed window", blocking: false });
  if (c.expenseDate.slice(0, 7) !== c.month) flags.push({ code: "month_mismatch", message: "Expense date is outside the claim month", blocking: false });
  const approver = c.amountPaise > p.ceoApprovalAbovePaise ? "ceo" : c.amountPaise > p.managerApprovalAbovePaise ? "manager" : "finance";
  return { flags, expectedAmountPaise: expected, approver };
}
