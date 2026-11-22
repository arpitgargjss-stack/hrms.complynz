/**
 * Default onboarding checklist, set in Admin configuration and versioned. Every new onboarding link copies the
 * current version, so later edits never change a link that was already sent.
 * Candidate steps are what the candidate fills in on the onboarding link; the rest are tasks HR ticks off.
 */
export type ChecklistKind = "candidate_step" | "document" | "nda" | "policy_ack" | "asset" | "custom";
export type ChecklistItem = { id: string; kind: ChecklistKind; label: string; key: string | null; required: boolean };
export type Checklist = { version: number; items: ChecklistItem[] };
export type LinkChecklist = { version: number; items: (ChecklistItem & { done: boolean; doneBy: string | null; doneAt: string | null })[] };

/** Steps the candidate-facing onboarding page knows how to show. */
export const CANDIDATE_STEPS: { key: string; label: string; hint: string }[] = [
  { key: "details", label: "Personal details", hint: "Name, date of birth, phone, address" },
  { key: "kyc", label: "PAN", hint: "Stored encrypted; shown to HR masked" },
  { key: "bank", label: "Bank details", hint: "Bank name, account number, IFSC" },
  { key: "documents", label: "Document uploads", hint: "Photo, PAN card, ID, address proof, other" },
];
export const KIND_LABEL: Record<ChecklistKind, string> = {
  candidate_step: "Candidate fills in", document: "Document to collect", nda: "NDA", policy_ack: "Policy to acknowledge", asset: "Asset to issue", custom: "Other step",
};

export const DEFAULT_CHECKLIST: Checklist = {
  version: 0,
  items: [
    ...CANDIDATE_STEPS.map((s) => ({ id: `step-${s.key}`, kind: "candidate_step" as const, label: s.label, key: s.key, required: true })),
    { id: "doc-address", kind: "document", label: "Address proof", key: null, required: true },
    { id: "doc-education", kind: "document", label: "Highest education certificate", key: null, required: false },
    { id: "nda", kind: "nda", label: "Non-disclosure agreement signed", key: null, required: true },
    { id: "asset-laptop", kind: "asset", label: "Laptop issued", key: null, required: false },
  ],
};

/** Problems that stop a checklist from being saved. */
export function validateChecklist(items: ChecklistItem[], publishedPolicySlugs: string[]): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  if (!items.some((i) => i.kind === "candidate_step")) out.push("Keep at least one step for the candidate to fill in");
  for (const i of items) {
    if (!i.label.trim()) out.push("Every item needs a name");
    if (ids.has(i.id)) out.push(`Duplicate item ${i.id}`);
    ids.add(i.id);
    if (i.kind === "candidate_step" && !CANDIDATE_STEPS.some((s) => s.key === i.key)) out.push(`Unknown candidate step: ${i.key ?? "none"}`);
    if (i.kind === "policy_ack" && !publishedPolicySlugs.includes(i.key ?? "")) out.push(`"${i.label}" must point to a published policy`);
  }
  return [...new Set(out)];
}

const same = (a: ChecklistItem[], b: ChecklistItem[]) => JSON.stringify(a.map(norm)) === JSON.stringify(b.map(norm));
const norm = (i: ChecklistItem) => [i.id, i.kind, i.label.trim(), i.key ?? null, !!i.required];
/** The version a save produces: unchanged content keeps the version, any change bumps it by one. */
export function nextChecklistVersion(current: Checklist, items: ChecklistItem[]): number {
  return same(current.items, items) ? current.version : current.version + 1;
}

/** A deep copy for a new onboarding link, with every item not yet done. */
export function copyForLink(c: Checklist): LinkChecklist {
  return { version: c.version, items: c.items.map((i) => ({ ...i, done: false, doneBy: null, doneAt: null })) };
}
/** Candidate step keys to show on the onboarding link, in checklist order. */
export const candidateSteps = (c: Pick<Checklist, "items">) => c.items.filter((i) => i.kind === "candidate_step" && i.key).map((i) => i.key!);
