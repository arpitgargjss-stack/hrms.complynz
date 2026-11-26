export type Role = "super_admin" | "hr_admin" | "finance_signatory" | "manager" | "team_member";

/** A super admin holds every elevated role, so all existing checks (hr_admin, finance_signatory) pass for them. */
export const SUPER_ADMIN_IMPLIES: readonly Role[] = ["hr_admin", "finance_signatory"];
export type Scope = "none" | "own" | "reports" | "all";

/** Mirrors the Roles and access board. Server-side source of truth. */
export type Capability =
  | "people.read_work" | "people.write" | "id_docs.read" | "bank.read" | "comp.read" | "payroll.run" | "bank_advice.generate" | "sign.documents"
  | "attendance.read" | "leave.approve" | "calendar.configure" | "claims.read" | "claims.verify" | "claims.approve" | "policy.reimb.edit"
  | "resign.read" | "resign.accept" | "pip.manage" | "hiring.manage" | "letters.generate" | "policies.manage" | "org.configure" | "audit.read"
  | "dashboard.people" | "dashboard.finance" | "compliance.manage" | "settings.manage";

const M: Record<Capability, Partial<Record<Role, Scope>>> = {
  "people.read_work": { hr_admin: "all", manager: "reports" },
  "people.write": { hr_admin: "all" },
  "id_docs.read": { hr_admin: "all", team_member: "own", finance_signatory: "own", manager: "own" },
  // Full (unmasked) bank account: HR admin (and super admin, who implies it) for everyone; every employee for their own.
  "bank.read": { hr_admin: "all", team_member: "own", finance_signatory: "own", manager: "own" },
  "comp.read": { hr_admin: "all", finance_signatory: "all", team_member: "own", manager: "own" },
  "payroll.run": { hr_admin: "all", finance_signatory: "all" },
  "bank_advice.generate": { hr_admin: "all", finance_signatory: "all" },
  "sign.documents": { finance_signatory: "own" },
  "attendance.read": { hr_admin: "all", manager: "reports", team_member: "own", finance_signatory: "own" },
  "leave.approve": { hr_admin: "all", manager: "reports" },
  "calendar.configure": { hr_admin: "all" },
  "claims.read": { hr_admin: "all", finance_signatory: "all", manager: "reports", team_member: "own" },
  "claims.verify": { finance_signatory: "all" },
  "claims.approve": { manager: "reports" },
  "policy.reimb.edit": { hr_admin: "all", finance_signatory: "all" },
  "resign.read": { hr_admin: "all", manager: "reports", team_member: "own", finance_signatory: "own" },
  "resign.accept": { hr_admin: "all" },
  "pip.manage": { hr_admin: "all", manager: "reports" },
  "hiring.manage": { hr_admin: "all" },
  "letters.generate": { hr_admin: "all" },
  "policies.manage": { hr_admin: "all" },
  "org.configure": { hr_admin: "all" },
  "audit.read": { hr_admin: "all" },
  "dashboard.people": { hr_admin: "all" },
  "dashboard.finance": { hr_admin: "all", finance_signatory: "all" },
  "compliance.manage": { hr_admin: "all", finance_signatory: "all" },
  "settings.manage": { hr_admin: "all", finance_signatory: "all" }, // Admin configuration: company, committees, named contacts
};

const RANK: Record<Scope, number> = { none: 0, own: 1, reports: 2, all: 3 };

export function scopeFor(roles: Iterable<Role>, cap: Capability): Scope {
  let best: Scope = "none";
  for (const r of roles) { const s = M[cap][r] ?? "none"; if (RANK[s] > RANK[best]) best = s; }
  return best;
}

/** Can the actor act on a row owned by `targetEmployeeId`? */
export function canAccess(scope: Scope, actor: { employeeId: string | null; directReportIds: string[] }, targetEmployeeId: string): boolean {
  if (scope === "all") return true;
  if (scope === "reports") return actor.directReportIds.includes(targetEmployeeId) || actor.employeeId === targetEmployeeId;
  if (scope === "own") return actor.employeeId === targetEmployeeId;
  return false;
}
