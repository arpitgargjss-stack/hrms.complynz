import { z } from "zod";
import type { ReimbPolicy } from "../../shared/hr/reimbursement";

/** Pure helpers for reimbursement routes. */

const paise = z.number().int().min(0).max(1_000_000_000_00);
export const policySchema = z.object({
  ratePerKmPaise: z.record(z.string().min(1).max(40), paise),
  billRequiredAbovePaise: paise,
  managerApprovalAbovePaise: paise,
  ceoApprovalAbovePaise: paise,
  submitWithinDays: z.number().int().min(0).max(365),
  cityCaps: z.record(z.string().min(1).max(60), paise).optional(),
}).strict().refine((p) => p.managerApprovalAbovePaise <= p.ceoApprovalAbovePaise, { message: "Manager threshold cannot exceed the CEO threshold" });

export type Tier = "finance" | "manager" | "ceo";
/** Same tiering as checkClaim: strictly above the threshold moves up a tier. */
export function approverTier(amountPaise: number, p: Pick<ReimbPolicy, "managerApprovalAbovePaise" | "ceoApprovalAbovePaise">): Tier {
  return amountPaise > p.ceoApprovalAbovePaise ? "ceo" : amountPaise > p.managerApprovalAbovePaise ? "manager" : "finance";
}

export type ClaimStatus = "submitted" | "verified" | "manager_approved" | "approved" | "rejected" | "paid";

export type ApproveRole = "manager" | "finance" | "hr_admin";
/**
 * Approval state machine. Verified is required first (finance checks bill and policy).
 *  finance tier: verified -> approved (finance)
 *  manager tier: verified -> approved (the claimant's manager)
 *  ceo tier:     verified -> manager_approved (manager) -> approved (hr_admin records CEO sign-off with a note)
 * Returns the next status or null when this role cannot approve at this step.
 */
export function nextApprovalStatus(status: ClaimStatus, tier: Tier, role: ApproveRole): ClaimStatus | null {
  if (status === "verified") {
    if (tier === "finance" && role === "finance") return "approved";
    if (tier === "manager" && role === "manager") return "approved";
    if (tier === "ceo" && role === "manager") return "manager_approved";
    return null;
  }
  if (status === "manager_approved" && tier === "ceo" && role === "hr_admin") return "approved";
  return null;
}

// ---------- analytics ----------
export function lastMonths(endMonth: string, n: number): string[] {
  let [y, m] = endMonth.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < n; i++) { out.unshift(`${y}-${String(m).padStart(2, "0")}`); m--; if (m === 0) { m = 12; y--; } }
  return out;
}

export interface AnalyticsClaim { month: string; category: string; mode: string | null; amountPaise: number; status: string; department: string | null }
export interface Bucket { key: string; totalPaise: number; count: number }

function bucketBy(claims: AnalyticsClaim[], key: (c: AnalyticsClaim) => string): Bucket[] {
  const m = new Map<string, Bucket>();
  for (const c of claims) {
    const k = key(c);
    const b = m.get(k) ?? { key: k, totalPaise: 0, count: 0 };
    b.totalPaise += c.amountPaise; b.count++; m.set(k, b);
  }
  return [...m.values()].sort((a, b) => b.totalPaise - a.totalPaise);
}

/** Rejected claims are excluded. The trend is zero filled for every month in the window. */
export function aggregateClaims(claims: AnalyticsClaim[], months: string[]) {
  const set = new Set(months);
  const live = claims.filter((c) => c.status !== "rejected" && set.has(c.month));
  const trendMap = new Map(months.map((m) => [m, { month: m, totalPaise: 0, count: 0 }]));
  for (const c of live) { const t = trendMap.get(c.month)!; t.totalPaise += c.amountPaise; t.count++; }
  return {
    trend: [...trendMap.values()],
    byCategory: bucketBy(live, (c) => c.category),
    byDepartment: bucketBy(live, (c) => c.department ?? "Unassigned"),
    byMode: bucketBy(live, (c) => c.mode ?? "not specified"),
    totalPaise: live.reduce((s, c) => s + c.amountPaise, 0),
    count: live.length,
  };
}
