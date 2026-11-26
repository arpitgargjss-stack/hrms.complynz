import type { ComponentDef, StatutoryRules } from "./payroll";

/**
 * Ready-made starting points for a startup that has not set up payroll before.
 * Admins pick one, can edit it, and it is saved like any other rule set or template.
 * Values were checked against the sources listed on 21 November 2026; re-check before each new financial year.
 */

const NEW_REGIME_TDS: StatutoryRules["tds"] = {
  enabled: true,
  // New regime slabs on annual taxable income, FY 2025-26 and unchanged for FY 2026-27.
  slabs: [
    { upToPaise: 4_00_000_00, rateBps: 0 },
    { upToPaise: 8_00_000_00, rateBps: 500 },
    { upToPaise: 12_00_000_00, rateBps: 1000 },
    { upToPaise: 16_00_000_00, rateBps: 1500 },
    { upToPaise: 20_00_000_00, rateBps: 2000 },
    { upToPaise: 24_00_000_00, rateBps: 2500 },
    { upToPaise: null, rateBps: 3000 },
  ],
  standardDeductionPaise: 75_000_00,
  cessBps: 400,
  rebate: { thresholdPaise: 12_00_000_00, maxRebatePaise: 60_000_00 },
};

/** Maharashtra professional tax per month, by monthly gross. February is higher. States not listed (e.g. Uttar Pradesh) levy none. */
const PT_BY_STATE: NonNullable<StatutoryRules["professionalTax"]["byState"]> = {
  Maharashtra: {
    slabs: [{ upToPaise: 7_500_00, monthlyPaise: 0 }, { upToPaise: 10_000_00, monthlyPaise: 175_00 }, { upToPaise: null, monthlyPaise: 200_00, februaryPaise: 300_00 }],
    femaleSlabs: [{ upToPaise: 25_000_00, monthlyPaise: 0 }, { upToPaise: null, monthlyPaise: 200_00, februaryPaise: 300_00 }],
  },
};

const ESI: NonNullable<StatutoryRules["esi"]> = { enabled: true, employeeBps: 75, employerBps: 325, wageCeilingPaise: 21_000_00 };

export const SOURCES = [
  "EPF wage ceiling ₹25,000 from 17 Sep 2026: PIB, https://www.pib.gov.in/PressReleasePage.aspx?PRID=2314111",
  "EPF 12% employee, 12% employer: https://www.corplawupdates.in/updates/epfo-wage-ceiling-rs-25000-cabinet-approval-2026",
  "ESI 0.75% employee, 3.25% employer: https://esic.gov.in/contribution; ₹21,000 ceiling: https://cleartax.in/s/esi-rate",
  "New regime slabs, ₹75,000 standard deduction, 87A rebate to ₹12 lakh, 4% cess: https://www.zoho.com/in/payroll/academy/taxes-and-compliance/guide-income-tax-india-2026.html",
  "Maharashtra PT: https://cleartax.in/s/professional-tax-maharashtra; no PT in Uttar Pradesh: https://razorpay.com/learn/professional-tax/",
];

/** States and union territories, for office locations (professional tax and state compliance follow the location). */
export const INDIAN_STATES = ["Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal"] as const;

export type RulePreset = { key: string; name: string; summary: string; effectiveFrom: string; rules: StatutoryRules; source: string; sources: string[] };
const SHORT = "Complynz standard preset, checked 21 Nov 2026 against PIB (EPF ceiling), esic.gov.in, cleartax.in (ESI ceiling, Maharashtra PT), zoho.com (FY 2026-27 tax), razorpay.com (states without PT).";

export const RULE_PRESETS: RulePreset[] = [
  {
    key: "in-2026-10", name: "India, from October 2026 (PF ceiling ₹25,000)",
    summary: "PF 12% + 12% on wages up to ₹25,000, ESI 0.75% + 3.25% up to ₹21,000 gross, new tax regime, Maharashtra PT (none in Uttar Pradesh).",
    effectiveFrom: "2026-10-01",
    rules: { pf: { enabled: true, employeeBps: 1200, employerBps: 1200, wageCeilingPaise: 25_000_00 }, esi: ESI, tds: NEW_REGIME_TDS, professionalTax: { enabled: true, monthlyPaise: 0, byState: PT_BY_STATE } },
    source: SHORT, sources: SOURCES,
  },
  {
    key: "in-2025-04", name: "India, April 2025 to September 2026 (PF ceiling ₹15,000)",
    summary: "Same as above with the earlier ₹15,000 PF wage ceiling. Use for months before October 2026.",
    effectiveFrom: "2025-04-01",
    rules: { pf: { enabled: true, employeeBps: 1200, employerBps: 1200, wageCeilingPaise: 15_000_00 }, esi: ESI, tds: NEW_REGIME_TDS, professionalTax: { enabled: true, monthlyPaise: 0, byState: PT_BY_STATE } },
    source: SHORT.replace("(EPF ceiling)", "(EPF ceiling ₹15,000 before 17 Sep 2026)"), sources: SOURCES,
  },
  {
    key: "in-2026-10-nopf", name: "India, under 20 employees (no PF yet)",
    summary: "PF is compulsory only from 20 employees, so it is off here. ESI (needed from 10 employees), new tax regime and state PT stay on. Switch to the first preset once you cross 20 or register for PF voluntarily.",
    effectiveFrom: "2026-10-01",
    rules: { pf: { enabled: false, employeeBps: 1200, employerBps: 1200, wageCeilingPaise: 25_000_00 }, esi: ESI, tds: NEW_REGIME_TDS, professionalTax: { enabled: true, monthlyPaise: 0, byState: PT_BY_STATE } },
    source: SHORT, sources: SOURCES,
  },
];

export type TemplatePreset = { key: string; name: string; summary: string; components: ComponentDef[] };

/**
 * Salary structures that keep basic pay at half of gross, so allowances stay within the 50% limit of the
 * Code on Wages (in force from 21 Nov 2025) and PF is worked out on basic.
 */
export const TEMPLATE_PRESETS: TemplatePreset[] = [
  {
    key: "standard", name: "Complynz standard (basic 50%)", summary: "Basic 50% of gross, HRA 40% of basic, rest as special allowance. Same split as the current offer letters (₹45,000 = ₹22,500 + ₹9,000 + ₹13,500).",
    components: [
      { code: "BASIC", name: "Basic salary", calc: { type: "percent", of: "gross", bps: 5000 }, pfWage: true },
      { code: "HRA", name: "House rent allowance", calc: { type: "percent", of: "BASIC", bps: 4000 } },
      { code: "SPECIAL", name: "Special allowance", calc: { type: "balance" } },
    ],
  },
  {
    key: "metro", name: "Metro city (basic 50%, HRA 50% of basic)", summary: "For Mumbai, Delhi, Kolkata, Chennai: HRA at 50% of basic.",
    components: [
      { code: "BASIC", name: "Basic salary", calc: { type: "percent", of: "gross", bps: 5000 }, pfWage: true },
      { code: "HRA", name: "House rent allowance", calc: { type: "percent", of: "BASIC", bps: 5000 } },
      { code: "SPECIAL", name: "Special allowance", calc: { type: "balance" } },
    ],
  },
  {
    key: "flexi", name: "With LTA and telephone (basic 50%)", summary: "Basic 50%, HRA 40% of basic, leave travel 5% of gross, phone and internet ₹1,500, rest special.",
    components: [
      { code: "BASIC", name: "Basic salary", calc: { type: "percent", of: "gross", bps: 5000 }, pfWage: true },
      { code: "HRA", name: "House rent allowance", calc: { type: "percent", of: "BASIC", bps: 4000 } },
      { code: "LTA", name: "Leave travel allowance", calc: { type: "percent", of: "gross", bps: 500 } },
      { code: "PHONE", name: "Phone and internet allowance", calc: { type: "fixed", amount: 1_500_00 } },
      { code: "SPECIAL", name: "Special allowance", calc: { type: "balance" } },
    ],
  },
  {
    key: "intern", name: "Intern stipend", summary: "One stipend line, no PF. Tax still applies if the stipend crosses the limits.",
    components: [{ code: "STIPEND", name: "Stipend", calc: { type: "balance" } }],
  },
];

/** Key-order-independent JSON, so rules read back from jsonb compare equal to the preset they came from. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

/** True when two rule sets hold the same statutory values. */
export const sameRules = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/** True when a saved rule set is this preset (same effective date and the same values, not just the same date). */
export const isPresetRow = (p: Pick<RulePreset, "effectiveFrom" | "rules">, row: { effectiveFrom: string; rules: unknown }) =>
  row.effectiveFrom === p.effectiveFrom && sameRules(p.rules, row.rules);
