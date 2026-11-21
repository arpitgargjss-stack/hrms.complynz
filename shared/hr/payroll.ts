import { bps, type Paise } from "./money";

/**
 * Pure payroll engine. No I/O, no hidden defaults for statutory values:
 * every rate, ceiling and slab comes from admin-configured, effective-dated rules.
 */

export type ComponentCalc =
  | { type: "fixed"; amount: Paise }
  | { type: "percent"; of: "gross" | string; bps: number } // of gross or of another component code
  | { type: "balance" }; // gross minus all other earnings

export interface ComponentDef {
  code: string;
  name: string;
  calc: ComponentCalc;
  /** Included in PF wages when PF applies. */
  pfWage?: boolean;
  /** Taxable under TDS projection (default true). */
  taxable?: boolean;
}

export interface PfRule {
  enabled: boolean;
  employeeBps: number;
  employerBps: number;
  /** Monthly wage ceiling. null = uncapped. Required (no default) when enabled. */
  wageCeilingPaise: Paise | null;
}

export interface TdsSlab { upToPaise: Paise | null; rateBps: number }
export interface TdsRule {
  enabled: boolean;
  slabs: TdsSlab[]; // ascending; last has upToPaise null
  standardDeductionPaise: Paise;
  cessBps: number;
  /** Optional rebate: if taxable income <= thresholdPaise, tax reduces to max(0, tax - maxRebatePaise). */
  rebate?: { thresholdPaise: Paise; maxRebatePaise: Paise };
}

/** One professional tax slab: monthly gross up to `upToPaise` (null = no upper limit) pays `monthlyPaise`, or `februaryPaise` in February. */
export interface PtSlab { upToPaise: Paise | null; monthlyPaise: Paise; februaryPaise?: Paise }
export interface ProfessionalTaxRule {
  enabled: boolean;
  /** Flat amount used when no state table applies (kept for older rule sets). */
  monthlyPaise: Paise;
  /** State-wise slabs keyed by state name. A state that is not listed levies no professional tax. Women can have their own table. */
  byState?: Record<string, { slabs: PtSlab[]; femaleSlabs?: PtSlab[] }>;
}
/** Employees' State Insurance: applies when monthly gross at full attendance is at or under the wage ceiling. */
export interface EsiRule { enabled: boolean; employeeBps: number; employerBps: number; wageCeilingPaise: Paise }

export interface StatutoryRules {
  pf: PfRule;
  tds: TdsRule;
  professionalTax: ProfessionalTaxRule;
  esi?: EsiRule;
}

/** Monthly professional tax for a person, from the state table when there is one, else the flat amount. */
export function professionalTaxFor(rule: ProfessionalTaxRule, grossPaise: Paise, ctx: { state?: string | null; gender?: string | null; month?: string }): Paise {
  if (!rule.enabled) return 0;
  if (!rule.byState) return rule.monthlyPaise;
  const st = ctx.state ? rule.byState[ctx.state] : undefined;
  if (!st) return 0;
  const slabs = ctx.gender === "female" && st.femaleSlabs ? st.femaleSlabs : st.slabs;
  const slab = slabs.find((x) => x.upToPaise === null || grossPaise <= x.upToPaise);
  if (!slab) return 0;
  return ctx.month?.slice(5, 7) === "02" && slab.februaryPaise !== undefined ? slab.februaryPaise : slab.monthlyPaise;
}

export interface SalaryInput {
  /** Monthly gross at full attendance. */
  monthlyGrossPaise: Paise;
  components: ComponentDef[];
  /** Extra one-off earnings for the month (arrears, bonus). */
  adjustments?: { code: string; name: string; amount: Paise }[];
  /** Reimbursements paid with salary (non-taxable, outside gross). */
  reimbursementsPaise?: Paise;
  /** Other deductions (advance recovery, etc.). */
  otherDeductions?: { code: string; name: string; amount: Paise }[];
  calendarDays: number;
  /** Days paid (calendarDays minus loss of pay). May be fractional in halves. */
  paidDays: number;
  rules: StatutoryRules;
  /** Work-location state, gender and month (YYYY-MM), used for state professional tax slabs. */
  pt?: { state?: string | null; gender?: string | null; month?: string };
  /** Tax already deducted this FY and months remaining including this one, for TDS projection. */
  tds?: { taxDeductedSoFarPaise: Paise; /** Taxable earnings already paid this FY. */ taxableSoFarPaise?: Paise; monthsRemaining: number; annualOtherDeductionsPaise?: Paise };
}

export interface Line { code: string; name: string; amount: Paise }

export interface SalaryResult {
  earnings: Line[];
  deductions: Line[];
  employerContributions: Line[];
  grossFullPaise: Paise;
  grossPaidPaise: Paise;
  totalDeductionsPaise: Paise;
  reimbursementsPaise: Paise;
  netPayPaise: Paise;
  pfWagePaise: Paise;
}

function topoOrder(components: ComponentDef[]): ComponentDef[] {
  const byCode = new Map(components.map((c) => [c.code, c]));
  if (byCode.size !== components.length) throw new Error("Duplicate component code");
  const out: ComponentDef[] = [];
  const state = new Map<string, 1 | 2>();
  const visit = (c: ComponentDef) => {
    const s = state.get(c.code);
    if (s === 2) return;
    if (s === 1) throw new Error(`Circular component reference at ${c.code}`);
    state.set(c.code, 1);
    if (c.calc.type === "percent" && c.calc.of !== "gross") {
      const dep = byCode.get(c.calc.of);
      if (!dep) throw new Error(`Component ${c.code} references unknown ${c.calc.of}`);
      if (dep.calc.type === "balance") throw new Error(`Component ${c.code} cannot depend on the balance component`);
      visit(dep);
    }
    state.set(c.code, 2);
    out.push(c);
  };
  components.filter((c) => c.calc.type !== "balance").forEach(visit);
  components.filter((c) => c.calc.type === "balance").forEach(visit);
  return out;
}

/** Resolve full-month component amounts that add up exactly to monthlyGross. */
export function resolveComponents(monthlyGrossPaise: Paise, components: ComponentDef[]): Line[] {
  const balances = components.filter((c) => c.calc.type === "balance");
  if (balances.length > 1) throw new Error("Only one balance component allowed");
  const amounts = new Map<string, Paise>();
  for (const c of topoOrder(components)) {
    const k = c.calc;
    if (k.type === "fixed") amounts.set(c.code, k.amount);
    else if (k.type === "percent") {
      const base = k.of === "gross" ? monthlyGrossPaise : amounts.get(k.of)!;
      amounts.set(c.code, bps(base, k.bps));
    } else {
      let others = 0;
      for (const [code, a] of amounts) if (code !== c.code) others += a;
      const bal = monthlyGrossPaise - others;
      if (bal < 0) throw new Error("Components exceed gross");
      amounts.set(c.code, bal);
    }
  }
  if (balances.length === 0) {
    const total = [...amounts.values()].reduce((a, b) => a + b, 0);
    if (total !== monthlyGrossPaise) throw new Error("Components do not add up to gross; add a balance component");
  }
  return components.map((c) => ({ code: c.code, name: c.name, amount: amounts.get(c.code)! }));
}

export function prorate(amount: Paise, paidDays: number, calendarDays: number): Paise {
  if (calendarDays <= 0) throw new Error("calendarDays must be positive");
  if (paidDays < 0 || paidDays > calendarDays) throw new Error("paidDays out of range");
  if (paidDays === calendarDays) return amount;
  // paidDays may be in halves: work in half-days to stay integer
  const half = Math.round(paidDays * 2);
  return Math.floor((amount * half + calendarDays) / (calendarDays * 2));
}

export function annualTax(taxableAnnual: Paise, rule: TdsRule): Paise {
  const income = Math.max(0, taxableAnnual - rule.standardDeductionPaise);
  let tax = 0;
  let prev = 0;
  for (const s of rule.slabs) {
    const upper = s.upToPaise ?? Infinity;
    if (income > prev) tax += bps(Math.min(income, upper) - prev, s.rateBps);
    if (income <= upper) break;
    prev = upper;
  }
  if (rule.rebate && income <= rule.rebate.thresholdPaise) tax = Math.max(0, tax - rule.rebate.maxRebatePaise);
  return tax + bps(tax, rule.cessBps);
}

export function computeSalary(input: SalaryInput): SalaryResult {
  const { rules } = input;
  if (rules.pf.enabled && rules.pf.wageCeilingPaise === undefined) {
    throw new Error("PF is enabled but no wage ceiling (or explicit null) is configured");
  }
  const full = resolveComponents(input.monthlyGrossPaise, input.components);
  const defByCode = new Map(input.components.map((c) => [c.code, c]));

  const earnings: Line[] = full.map((l) => ({ ...l, amount: prorate(l.amount, input.paidDays, input.calendarDays) }));
  for (const a of input.adjustments ?? []) earnings.push({ ...a });
  const grossPaid = earnings.reduce((s, l) => s + l.amount, 0);

  const deductions: Line[] = [];
  const employer: Line[] = [];

  // PF
  let pfWage = 0;
  if (rules.pf.enabled) {
    pfWage = earnings.filter((l) => defByCode.get(l.code)?.pfWage).reduce((s, l) => s + l.amount, 0);
    const capped = rules.pf.wageCeilingPaise === null ? pfWage : Math.min(pfWage, rules.pf.wageCeilingPaise);
    deductions.push({ code: "PF_EE", name: "Provident Fund (Employee)", amount: bps(capped, rules.pf.employeeBps) });
    employer.push({ code: "PF_ER", name: "Provident Fund (Employer)", amount: bps(capped, rules.pf.employerBps) });
  }

  // ESI on gross paid, when full-month gross is within the ceiling. ESIC rounds contributions up to the next rupee.
  if (rules.esi?.enabled && input.monthlyGrossPaise <= rules.esi.wageCeilingPaise) {
    const up = (p: Paise) => Math.ceil(p / 100) * 100;
    deductions.push({ code: "ESI_EE", name: "ESI (Employee)", amount: up(bps(grossPaid, rules.esi.employeeBps)) });
    employer.push({ code: "ESI_ER", name: "ESI (Employer)", amount: up(bps(grossPaid, rules.esi.employerBps)) });
  }

  const pt = professionalTaxFor(rules.professionalTax, input.monthlyGrossPaise, input.pt ?? {});
  if (pt > 0) deductions.push({ code: "PT", name: "Professional Tax", amount: pt });

  // TDS: project annual taxable from this month's taxable earnings
  if (rules.tds.enabled) {
    if (!input.tds) throw new Error("TDS enabled but no YTD context supplied");
    const taxableMonth = earnings
      .filter((l) => defByCode.get(l.code)?.taxable !== false)
      .reduce((s, l) => s + l.amount, 0);
    const projectedAnnual = (input.tds.taxableSoFarPaise ?? 0) + taxableMonth * input.tds.monthsRemaining;
    const tax = annualTax(projectedAnnual - (input.tds.annualOtherDeductionsPaise ?? 0), rules.tds);
    const remaining = Math.max(0, tax - input.tds.taxDeductedSoFarPaise);
    const monthly = Math.floor((remaining + input.tds.monthsRemaining - 1) / input.tds.monthsRemaining);
    if (monthly > 0) deductions.push({ code: "TDS", name: "Income Tax (TDS)", amount: monthly });
  }

  for (const d of input.otherDeductions ?? []) deductions.push({ ...d });

  const totalDeductions = deductions.reduce((s, l) => s + l.amount, 0);
  const reimb = input.reimbursementsPaise ?? 0;
  const net = grossPaid - totalDeductions + reimb;
  if (net < 0) throw new Error("Net pay would be negative; review deductions");

  return {
    earnings, deductions, employerContributions: employer,
    grossFullPaise: input.monthlyGrossPaise, grossPaidPaise: grossPaid,
    totalDeductionsPaise: totalDeductions, reimbursementsPaise: reimb,
    netPayPaise: net, pfWagePaise: pfWage,
  };
}
