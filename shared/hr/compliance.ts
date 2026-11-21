/**
 * Compliance centre catalogue for an Indian private limited company.
 * Each item says whether it applies to this company (from headcount, interns, office states and the company profile),
 * how often it recurs and when the next one is due. Due dates are the standard statutory ones; government extensions are not tracked.
 * Values checked on 21 November 2026. Re-check thresholds before each financial year.
 */
export type CompanyFacts = {
  headcount: number; interns: number; states: string[]; // derived from People and office locations
  entity: "private_limited" | "llp" | "opc"; industry: string; turnoverBand: "lt_40l" | "40l_1cr" | "1cr_2cr" | "2cr_10cr" | "gt_10cr";
  gstRegistered: boolean; dpiit: boolean; foreignInvestment: boolean; msme: boolean; msmeVendors: boolean; incorporatedOn: string | null;
};
export const DEFAULT_FACTS: Omit<CompanyFacts, "headcount" | "interns" | "states"> = {
  entity: "private_limited", industry: "Software and SaaS", turnoverBand: "lt_40l", gstRegistered: true, dpiit: true, foreignInvestment: true, msme: true, msmeVendors: true, incorporatedOn: null,
};
export const INDUSTRIES = ["Software and SaaS", "IT services", "Fintech", "E-commerce", "Manufacturing", "Healthcare", "Education", "Consulting", "Other"];
export const TURNOVER_BANDS: Record<CompanyFacts["turnoverBand"], string> = { lt_40l: "Up to ₹40 lakh", "40l_1cr": "₹40 lakh to ₹1 crore", "1cr_2cr": "₹1 to 2 crore", "2cr_10cr": "₹2 to 10 crore", gt_10cr: "Above ₹10 crore" };

export type Category = "HR and labour" | "Payroll taxes" | "Finance and tax" | "Corporate (MCA)" | "Foreign investment" | "Startup and MSME" | "Data protection and IT";
export type Frequency = "Monthly" | "Quarterly" | "Half-yearly" | "Annual" | "On event" | "One time" | "Ongoing";
export type Need = "Mandatory" | "Optional" | "Not applicable";
/** Due rule: monthly on a day of the next month, fixed dates in the year (MM-DD), or none. */
export type Due = { monthly?: number; dates?: string[]; fixed?: string };
export type Item = {
  key: string; title: string; category: Category; law: string; frequency: Frequency; due?: Due; dueText: string; form?: string; portal?: string; template?: string;
  applies: (f: CompanyFacts) => { need: Need; why: string };
};

const n = (f: CompanyFacts) => f.headcount + f.interns;
const has = (f: CompanyFacts, s: string) => f.states.includes(s);
const yes = (why: string) => ({ need: "Mandatory" as Need, why });
const opt = (why: string) => ({ need: "Optional" as Need, why });
const no = (why: string) => ({ need: "Not applicable" as Need, why });
const turnoverOver = (f: CompanyFacts, band: CompanyFacts["turnoverBand"]) => Object.keys(TURNOVER_BANDS).indexOf(f.turnoverBand) > Object.keys(TURNOVER_BANDS).indexOf(band);

export const ITEMS: Item[] = [
  // ---------------- HR and labour
  { key: "epf_registration", title: "EPF registration", category: "HR and labour", law: "EPF and MP Act, 1952 / Code on Social Security, 2020", frequency: "One time", dueText: "Within a month of reaching 20 employees", portal: "https://unifiedportal-emp.epfindia.gov.in/",
    applies: (f) => (f.headcount >= 20 ? yes(`${f.headcount} employees (interns not counted); the threshold is 20`) : opt(`${f.headcount} employees; compulsory from 20, voluntary before that`)) },
  { key: "epf_ecr", title: "EPF monthly return (ECR) and payment", category: "HR and labour", law: "EPF and MP Act, 1952", frequency: "Monthly", due: { monthly: 15 }, dueText: "15th of the next month", form: "ECR", portal: "https://unifiedportal-emp.epfindia.gov.in/",
    applies: (f) => (f.headcount >= 20 ? yes("EPF applies at 20 or more employees") : no("Only once EPF applies or you register voluntarily")) },
  { key: "esi_registration", title: "ESI registration", category: "HR and labour", law: "ESI Act, 1948 / Code on Social Security, 2020", frequency: "One time", dueText: "Within 15 days of reaching 10 employees", portal: "https://www.esic.gov.in/",
    applies: (f) => (n(f) >= 10 ? yes(`${n(f)} people including interns; the threshold is 10 in notified areas`) : no(`${n(f)} people; applies from 10`)) },
  { key: "esi_monthly", title: "ESI monthly contribution", category: "HR and labour", law: "ESI Act, 1948", frequency: "Monthly", due: { monthly: 15 }, dueText: "15th of the next month", portal: "https://www.esic.gov.in/",
    applies: (f) => (n(f) >= 10 ? yes("For employees earning up to ₹21,000 a month") : no("Applies from 10 people")) },
  { key: "shops_up", title: "Shops and establishments registration, Uttar Pradesh", category: "HR and labour", law: "UP Dukan Aur Vanijya Adhishthan Adhiniyam, 1962", frequency: "One time", dueText: "On reaching 10 employees; renew as required", portal: "https://uplabour.gov.in/",
    applies: (f) => (!has(f, "Uttar Pradesh") ? no("No office in Uttar Pradesh") : n(f) >= 10 ? yes("Office in Uttar Pradesh with 10 or more people") : opt("Office in Uttar Pradesh; registration is compulsory from 10 people")) },
  { key: "shops_mh", title: "Shops and establishments registration or intimation, Maharashtra", category: "HR and labour", law: "Maharashtra Shops and Establishments Act, 2017", frequency: "One time", dueText: "Within 60 days of starting; intimation below 10 employees", portal: "https://mahakamgar.maharashtra.gov.in/",
    applies: (f) => (!has(f, "Maharashtra") ? no("No office in Maharashtra") : yes(n(f) >= 10 ? "Office in Maharashtra with 10 or more people: registration" : "Office in Maharashtra under 10 people: one-time intimation")) },
  { key: "mlwf", title: "Maharashtra Labour Welfare Fund", category: "HR and labour", law: "Maharashtra Labour Welfare Fund Act, 1953", frequency: "Half-yearly", due: { dates: ["07-15", "01-15"] }, dueText: "15 July (June) and 15 January (December)", portal: "https://public.mlwb.in/",
    applies: (f) => (has(f, "Maharashtra") && n(f) >= 5 ? yes("Office in Maharashtra with 5 or more people") : no("Only for Maharashtra offices with 5 or more people")) },
  { key: "posh_policy", title: "POSH policy and awareness", category: "HR and labour", law: "Sexual Harassment of Women at Workplace Act, 2013", frequency: "Ongoing", dueText: "Keep the policy published and run awareness at least yearly",
    applies: () => yes("Every employer, whatever the size") },
  { key: "posh_ic", title: "POSH Internal Committee", category: "HR and labour", law: "Sexual Harassment of Women at Workplace Act, 2013, section 4", frequency: "One time", dueText: "As soon as there are 10 people, including interns", template: "posh_ic",
    applies: (f) => (n(f) >= 10 ? yes(`${n(f)} people including interns; required from 10`) : opt("Required from 10 people; the Local Committee covers you until then")) },
  { key: "posh_report", title: "POSH annual report to the District Officer", category: "HR and labour", law: "POSH Act, section 21 and Rule 14", frequency: "Annual", due: { dates: ["01-31"] }, dueText: "By 31 January for the calendar year", template: "posh_report",
    applies: (f) => (n(f) >= 10 ? yes("Once an Internal Committee exists") : no("Only once an Internal Committee is needed")) },
  { key: "wage_slips", title: "Wage slips and on-time salary", category: "HR and labour", law: "Code on Wages, 2019", frequency: "Monthly", due: { monthly: 7 }, dueText: "Pay monthly salary by the 7th of the next month",
    applies: () => yes("Every employer") },
  { key: "registers", title: "Registers of employees, wages and attendance", category: "HR and labour", law: "Code on Wages and state rules", frequency: "Ongoing", dueText: "Keep them current; this HRMS holds most of them", template: "registers",
    applies: () => yes("Every employer") },
  { key: "gratuity_notice", title: "Gratuity: notice of opening and payment of gratuity", category: "HR and labour", law: "Payment of Gratuity Act, 1972 / Code on Social Security, 2020", frequency: "One time", dueText: "Within 30 days of reaching 10 employees",
    applies: (f) => (n(f) >= 10 ? yes("Applies from 10 people") : no("Applies from 10 people")) },
  { key: "bonus", title: "Statutory bonus", category: "HR and labour", law: "Payment of Bonus Act, 1965 / Code on Wages, 2019", frequency: "Annual", due: { dates: ["11-30"] }, dueText: "Pay within 8 months of the year end (30 November)",
    applies: (f) => (f.headcount >= 20 ? yes("20 or more employees; for those earning up to ₹21,000 a month") : no("Applies from 20 employees")) },
  { key: "maternity", title: "Maternity benefit and creche", category: "HR and labour", law: "Maternity Benefit Act, 1961", frequency: "Ongoing", dueText: "26 weeks paid leave; creche from 50 employees",
    applies: (f) => (n(f) >= 10 ? yes(n(f) >= 50 ? "10 or more people, and a creche from 50" : "10 or more people") : opt("Applies from 10 people; good practice before that")) },
  { key: "standing_orders", title: "Standing orders", category: "HR and labour", law: "Industrial Relations Code, 2020", frequency: "One time", dueText: "On reaching 300 workers",
    applies: (f) => (n(f) >= 300 ? yes("300 or more workers") : no("Applies from 300 workers")) },
  { key: "interns", title: "Internship letters and stipend records", category: "HR and labour", law: "Contract and tax law", frequency: "Ongoing", dueText: "For every intern",
    applies: (f) => (f.interns > 0 ? yes(`${f.interns} interns on the rolls`) : opt("No interns right now")) },
  // ---------------- payroll taxes
  { key: "tds_salary", title: "TDS on salary: monthly deposit", category: "Payroll taxes", law: "Income-tax Act, section 192", frequency: "Monthly", due: { monthly: 7 }, dueText: "7th of the next month (30 April for March)", form: "Challan 281", portal: "https://www.incometax.gov.in/",
    applies: () => yes("Every employer paying salary above the exemption limit") },
  { key: "tds_24q", title: "TDS return on salary (Form 24Q)", category: "Payroll taxes", law: "Income-tax Act, section 200(3)", frequency: "Quarterly", due: { dates: ["07-31", "10-31", "01-31", "05-31"] }, dueText: "31 July, 31 October, 31 January, 31 May", form: "24Q", portal: "https://www.tdscpc.gov.in/",
    applies: () => yes("Every employer deducting TDS on salary") },
  { key: "form16", title: "Form 16 to employees", category: "Payroll taxes", law: "Income-tax Act, section 203", frequency: "Annual", due: { dates: ["06-15"] }, dueText: "By 15 June", form: "Form 16",
    applies: () => yes("Every employer deducting TDS on salary") },
  { key: "pt_mh", title: "Professional tax, Maharashtra (PTRC return and PTEC)", category: "Payroll taxes", law: "Maharashtra State Tax on Professions Act, 1975", frequency: "Monthly", due: { monthly: 31 }, dueText: "PTRC by the last day of the month (annual by 31 March if yearly tax is under ₹50,000); PTEC by 30 June", portal: "https://mahagst.gov.in/",
    applies: (f) => (has(f, "Maharashtra") ? yes("Office in Maharashtra") : no("No office in a state that levies it; Uttar Pradesh has none")) },
  // ---------------- finance and tax
  { key: "tds_vendor", title: "TDS on vendor payments and Form 26Q", category: "Finance and tax", law: "Income-tax Act, sections 194C, 194J and others", frequency: "Monthly", due: { monthly: 7 }, dueText: "Deposit by the 7th; 26Q quarterly with 24Q dates", form: "26Q",
    applies: () => yes("When paying contractors, professionals or rent above the limits") },
  { key: "advance_tax", title: "Advance tax", category: "Finance and tax", law: "Income-tax Act, section 211", frequency: "Quarterly", due: { dates: ["06-15", "09-15", "12-15", "03-15"] }, dueText: "15 June, 15 September, 15 December, 15 March",
    applies: () => opt("When the year's tax will be ₹10,000 or more") },
  { key: "gstr1", title: "GST: GSTR-1 outward supplies", category: "Finance and tax", law: "CGST Act, 2017", frequency: "Monthly", due: { monthly: 11 }, dueText: "11th of the next month (13th after the quarter under QRMP)", portal: "https://www.gst.gov.in/",
    applies: (f) => (f.gstRegistered ? yes("GST registered") : no("Not GST registered")) },
  { key: "gstr3b", title: "GST: GSTR-3B and payment", category: "Finance and tax", law: "CGST Act, 2017", frequency: "Monthly", due: { monthly: 20 }, dueText: "20th of the next month (22nd or 24th quarterly under QRMP)", portal: "https://www.gst.gov.in/",
    applies: (f) => (f.gstRegistered ? yes("GST registered") : no("Not GST registered")) },
  { key: "gstr9", title: "GST annual return (GSTR-9)", category: "Finance and tax", law: "CGST Act, section 44", frequency: "Annual", due: { dates: ["12-31"] }, dueText: "31 December", portal: "https://www.gst.gov.in/",
    applies: (f) => (!f.gstRegistered ? no("Not GST registered") : turnoverOver(f, "1cr_2cr") ? yes("Turnover above ₹2 crore") : opt("Optional up to ₹2 crore turnover")) },
  { key: "tax_audit", title: "Tax audit (Form 3CA/3CD)", category: "Finance and tax", law: "Income-tax Act, section 44AB", frequency: "Annual", due: { dates: ["09-30"] }, dueText: "30 September",
    applies: (f) => (turnoverOver(f, "2cr_10cr") ? yes("Turnover above ₹10 crore") : turnoverOver(f, "40l_1cr") ? opt("Needed above ₹1 crore unless 95% of receipts are digital (then ₹10 crore)") : no("Turnover under ₹1 crore")) },
  { key: "itr6", title: "Company income tax return (ITR-6)", category: "Finance and tax", law: "Income-tax Act, section 139", frequency: "Annual", due: { dates: ["10-31"] }, dueText: "31 October (audit cases)", portal: "https://www.incometax.gov.in/",
    applies: () => yes("Every company, even with no income") },
  { key: "stat_audit", title: "Statutory audit of accounts", category: "Finance and tax", law: "Companies Act, 2013, section 139", frequency: "Annual", due: { dates: ["09-30"] }, dueText: "Before the AGM (by 30 September)",
    applies: (f) => (f.entity === "private_limited" || f.entity === "opc" ? yes("Every company") : opt("LLPs need it above ₹40 lakh turnover or ₹25 lakh contribution")) },
  // ---------------- corporate
  { key: "board_meetings", title: "Board meetings", category: "Corporate (MCA)", law: "Companies Act, 2013, section 173", frequency: "Half-yearly", due: { dates: ["09-30", "03-31"] }, dueText: "Startups and small companies: one in each half of the year, at least 90 days apart", template: "board_minutes",
    applies: (f) => (f.entity === "llp" ? no("Not for LLPs") : yes("Every company")) },
  { key: "agm", title: "Annual general meeting", category: "Corporate (MCA)", law: "Companies Act, 2013, section 96", frequency: "Annual", due: { dates: ["09-30"] }, dueText: "Within 6 months of the year end (30 September)",
    applies: (f) => (f.entity === "private_limited" ? yes("Every private company") : no("Not for OPCs or LLPs")) },
  { key: "aoc4", title: "Financial statements (AOC-4)", category: "Corporate (MCA)", law: "Companies Act, 2013, section 137", frequency: "Annual", due: { dates: ["10-29"] }, dueText: "Within 30 days of the AGM", form: "AOC-4", portal: "https://www.mca.gov.in/",
    applies: (f) => (f.entity === "llp" ? no("LLPs file Form 8") : yes("Every company")) },
  { key: "mgt7", title: "Annual return (MGT-7A)", category: "Corporate (MCA)", law: "Companies Act, 2013, section 92", frequency: "Annual", due: { dates: ["11-28"] }, dueText: "Within 60 days of the AGM", form: "MGT-7A", portal: "https://www.mca.gov.in/",
    applies: (f) => (f.entity === "llp" ? no("LLPs file Form 11") : yes("Every company")) },
  { key: "adt1", title: "Auditor appointment (ADT-1)", category: "Corporate (MCA)", law: "Companies Act, 2013, section 139", frequency: "On event", dueText: "Within 15 days of the AGM where the auditor is appointed", form: "ADT-1",
    applies: (f) => (f.entity === "llp" ? no("Not for LLPs") : yes("On appointment, usually every 5 years")) },
  { key: "dir3kyc", title: "Director KYC (DIR-3 KYC)", category: "Corporate (MCA)", law: "Companies (Appointment of Directors) Rules", frequency: "Annual", due: { dates: ["09-30"] }, dueText: "30 September (web form if nothing changed, every 3 years in full)", form: "DIR-3 KYC",
    applies: () => yes("Every director with a DIN") },
  { key: "dpt3", title: "Return of deposits (DPT-3)", category: "Corporate (MCA)", law: "Companies (Acceptance of Deposits) Rules", frequency: "Annual", due: { dates: ["06-30"] }, dueText: "30 June", form: "DPT-3",
    applies: (f) => (f.entity === "llp" ? no("Not for LLPs") : yes("Every company with loans or money received that is not share capital")) },
  { key: "mbp1", title: "Directors' disclosure of interest (MBP-1, DIR-8)", category: "Corporate (MCA)", law: "Companies Act, 2013, sections 184 and 164", frequency: "Annual", due: { dates: ["04-30"] }, dueText: "At the first board meeting of the year", template: "board_minutes",
    applies: (f) => (f.entity === "llp" ? no("Not for LLPs") : yes("Every director, every year")) },
  { key: "inc20a", title: "Commencement of business (INC-20A)", category: "Corporate (MCA)", law: "Companies Act, 2013, section 10A", frequency: "One time", dueText: "Within 180 days of incorporation", form: "INC-20A",
    applies: (f) => (f.incorporatedOn && Date.now() - Date.parse(f.incorporatedOn) < 400 * 86400000 ? yes("Company incorporated in the last year") : opt("Done once after incorporation; mark it done if already filed")) },
  { key: "ben2", title: "Significant beneficial owners (BEN-2)", category: "Corporate (MCA)", law: "Companies Act, 2013, section 90", frequency: "On event", dueText: "Within 30 days of a declaration", form: "BEN-2",
    applies: () => yes("When anyone holds 10% or more, directly or indirectly") },
  // ---------------- foreign investment
  { key: "fc_gpr", title: "Shares issued to foreign investors (FC-GPR)", category: "Foreign investment", law: "FEMA (Non-debt Instruments) Rules, 2019", frequency: "On event", dueText: "Within 30 days of allotting shares", form: "FC-GPR", portal: "https://firms.rbi.org.in/",
    applies: (f) => (f.foreignInvestment ? yes("The company has foreign investment") : no("No foreign investment")) },
  { key: "fla", title: "Foreign liabilities and assets return (FLA)", category: "Foreign investment", law: "FEMA, RBI Master Direction", frequency: "Annual", due: { dates: ["07-15"] }, dueText: "15 July every year", form: "FLA", portal: "https://flair.rbi.org.in/",
    applies: (f) => (f.foreignInvestment ? yes("Any foreign investment received, in any year") : no("No foreign investment")) },
  { key: "fc_trs", title: "Transfer of shares with a foreign party (FC-TRS)", category: "Foreign investment", law: "FEMA (Non-debt Instruments) Rules, 2019", frequency: "On event", dueText: "Within 60 days of the transfer or payment", form: "FC-TRS", portal: "https://firms.rbi.org.in/",
    applies: (f) => (f.foreignInvestment ? yes("When shares move between residents and non-residents") : no("No foreign investment")) },
  // ---------------- startup and MSME
  { key: "dpiit_details", title: "Keep DPIIT recognition details current", category: "Startup and MSME", law: "DPIIT startup notification", frequency: "Ongoing", dueText: "Update when turnover, address or directors change", portal: "https://www.startupindia.gov.in/",
    applies: (f) => (f.dpiit ? yes("DPIIT recognised") : no("Not DPIIT recognised")) },
  { key: "s80iac", title: "Tax holiday under section 80-IAC", category: "Startup and MSME", law: "Income-tax Act, section 80-IAC", frequency: "One time", dueText: "Apply to the Inter-Ministerial Board (Form 1) before claiming", portal: "https://www.startupindia.gov.in/",
    applies: (f) => (f.dpiit ? opt("Optional: 3 of the first 10 years tax free for eligible startups") : no("Needs DPIIT recognition")) },
  { key: "labour_self_cert", title: "Self-certification under labour laws", category: "Startup and MSME", law: "Startup India labour law self-certification", frequency: "One time", dueText: "Optional, for the first 3 to 5 years", portal: "https://www.startupindia.gov.in/",
    applies: (f) => (f.dpiit ? opt("Optional for recognised startups: fewer inspections for 9 labour laws") : no("Needs DPIIT recognition")) },
  { key: "msme1", title: "Dues to MSME suppliers over 45 days (MSME-1)", category: "Startup and MSME", law: "MSMED Act, 2006 and MCA order", frequency: "Half-yearly", due: { dates: ["10-31", "04-30"] }, dueText: "31 October (April to September) and 30 April (October to March)", form: "MSME-1",
    applies: (f) => (f.msmeVendors ? yes("You buy from MSME suppliers; file if any dues were over 45 days") : no("No MSME suppliers")) },
  { key: "s43bh", title: "Pay MSME suppliers within 45 days", category: "Startup and MSME", law: "Income-tax Act, section 43B(h)", frequency: "Ongoing", dueText: "Unpaid amounts past 45 days are not deductible that year",
    applies: (f) => (f.msmeVendors ? yes("You buy from MSME suppliers") : no("No MSME suppliers")) },
  { key: "udyam", title: "Udyam registration up to date", category: "Startup and MSME", law: "MSMED Act, 2006", frequency: "Annual", due: { dates: ["03-31"] }, dueText: "Check after filing ITR and GST each year", portal: "https://udyamregistration.gov.in/",
    applies: (f) => (f.msme ? yes("Registered as an MSME") : opt("Register to get MSME benefits")) },
  // ---------------- data protection and IT
  { key: "dpdp_rules", title: "DPDP Rules obligations in force", category: "Data protection and IT", law: "Digital Personal Data Protection Act, 2023 and Rules, 2025", frequency: "One time", due: { fixed: "2027-05-13" }, dueText: "Notice, consent, security, retention and grievance duties apply from 13 May 2027",
    applies: () => yes("Every business that handles personal data, including employee data") },
  { key: "dpdp_breach", title: "Personal data breach notice", category: "Data protection and IT", law: "DPDP Rules, 2025", frequency: "On event", dueText: "Tell the Data Protection Board and affected people without delay; full report within 72 hours",
    applies: () => yes("Every business that handles personal data") },
  { key: "certin", title: "Cyber incident report to CERT-In", category: "Data protection and IT", law: "CERT-In Directions, 28 April 2022", frequency: "On event", dueText: "Within 6 hours of noticing a reportable incident; keep logs for 180 days", portal: "https://www.cert-in.org.in/",
    applies: () => yes("Every company") },
  { key: "grievance", title: "Grievance officer named and reachable", category: "Data protection and IT", law: "DPDP Act, section 8(10) and IT Rules", frequency: "Ongoing", dueText: "Publish the contact and reply within the set time",
    applies: () => yes("Every business that handles personal data") },
];

/** Next due date on or after `today` (YYYY-MM-DD), or null when the item has no calendar date. */
export function nextDue(item: Item, today: string): string | null {
  const d = item.due; if (!d) return null;
  if (d.fixed) return d.fixed;
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const last = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  if (d.monthly) {
    for (let k = 0; k < 3; k++) { const mm = ((m - 1 + k) % 12) + 1, yy = y + Math.floor((m - 1 + k) / 12); const day = Math.min(d.monthly, last(yy, mm)); const s = `${yy}-${String(mm).padStart(2, "0")}-${String(day).padStart(2, "0")}`; if (s >= today) return s; }
  }
  if (d.dates) { const all = [y, y + 1].flatMap((yy) => d.dates!.map((md) => `${yy}-${md}`)).sort(); return all.find((s) => s >= today) ?? null; }
  return null;
}
/** The latest due date strictly before `today`, looking back up to a year, or null. */
export function prevDue(item: Item, today: string): string | null {
  const d = item.due; if (!d || d.fixed) return null;
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const last = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  if (d.monthly) {
    for (let k = 0; k < 3; k++) { const t = y * 12 + (m - 1) - k, yy = Math.floor(t / 12), mm = (t % 12) + 1; const s = `${yy}-${String(mm).padStart(2, "0")}-${String(Math.min(d.monthly, last(yy, mm))).padStart(2, "0")}`; if (s < today) return s; }
  }
  if (d.dates) { const all = [y - 1, y].flatMap((yy) => d.dates!.map((md) => `${yy}-${md}`)).sort().reverse(); return all.find((s) => s < today) ?? null; }
  return null;
}
/** The period a due date belongs to, used to mark it done: the month for monthly items, else the due date itself. */
export const periodOf = (item: Item, due: string | null) => (due ? (item.frequency === "Monthly" ? due.slice(0, 7) : due) : "once");
