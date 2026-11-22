/**
 * Email templates HR can edit in Admin configuration. Each template may use its own send-time values
 * (such as {{name}} and {{link}}) plus any key from the fixed policy placeholder list (such as {{company.legal_name}}).
 * Anything else is flagged as unknown and blocks saving.
 */
import { PLACEHOLDERS, placeholdersIn } from "./placeholders";

export type EmailVar = { key: string; label: string; example: string };
export type EmailTemplateDef = { key: string; label: string; when: string; vars: EmailVar[]; subject: string; body: string };

const COMMON: EmailVar[] = [
  { key: "name", label: "Recipient's name", example: "Asha" },
  { key: "link", label: "Secure link", example: "https://hrms.example.com/…" },
  { key: "expiry", label: "Link expiry date", example: "2026-12-06" },
];
export const EMAIL_TEMPLATES: EmailTemplateDef[] = [
  { key: "offer_link", label: "Offer letter link", when: "Sent when HR shares an issued offer letter for acceptance", vars: COMMON,
    subject: "Your offer from Complynz",
    body: "Hello {{name}},\n\nYour offer documents from Complynz are ready. Please open the secure link below, verify with a one-time code sent to this email address, and review and accept.\n\n{{link}}\n\nThis link expires on {{expiry}}. If you did not expect this email, you can ignore it.\n\nComplynz HR" },
  { key: "onboarding_link", label: "Onboarding link", when: "Sent when HR creates an onboarding link for a new joiner", vars: COMMON,
    subject: "Complete your joining details at Complynz",
    body: "Hello {{name}},\n\nPlease complete your joining details using the secure link below. You will verify with a one-time code sent to this email address.\n\n{{link}}\n\nThis link expires on {{expiry}}.\n\nComplynz HR" },
  { key: "policy_reminder", label: "Policy acknowledgement reminder", when: "Sent when HR reminds people to acknowledge a published policy", vars: [
    { key: "name", label: "Recipient's name", example: "Asha" }, { key: "policy", label: "Policy title", example: "Leave Policy" }, { key: "link", label: "Link to the policy", example: "https://hrms.example.com/policies/leave" }],
    subject: "Please acknowledge: {{policy}}",
    body: "Hello {{name}},\n\nPlease read and acknowledge the {{policy}} in the HRMS:\n\n{{link}}\n\nThank you,\n{{company.brand_name}} HR" },
];
export const emailTemplateDef = (key: string) => EMAIL_TEMPLATES.find((t) => t.key === key);

/** Unknown placeholders in a subject and body for this template (send-time values and fixed placeholders are allowed). */
export function unknownEmailPlaceholders(def: EmailTemplateDef, subject: string, body: string): string[] {
  const allowed = new Set([...def.vars.map((v) => v.key), ...PLACEHOLDERS.filter((p) => p.kind === "text").map((p) => p.key)]);
  return [...new Set([...placeholdersIn(subject), ...placeholdersIn(body)])].filter((k) => !allowed.has(k));
}

/** Fills a plain-text email: send-time values first, then fixed placeholders; anything missing is left blank. */
export function fillEmail(text: string, vars: Record<string, string | null | undefined>): string {
  return text.replace(/\{\{\s*([a-z0-9_.]+)\s*\}\}/gi, (_m, k: string) => vars[k] ?? "");
}
