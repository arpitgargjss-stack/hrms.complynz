import { env } from "../env";

/** Strip anything that looks like an email address so provider errors can be logged safely. */
export function redactEmails(s: string): string {
  return s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]");
}

export const emailConfigured = () => !!env.RESEND_API_KEY;

/**
 * Send via Resend when configured. Never throws; returns false when the email was not accepted
 * by the provider, so callers must check the result. Logs never include recipient addresses or content.
 */
export async function sendEmail(opts: { to: string; subject: string; text: string; html?: string }): Promise<boolean> {
  if (!env.RESEND_API_KEY) { console.error("email NOT sent: RESEND_API_KEY is not set"); return false; }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [opts.to], subject: opts.subject, text: opts.text, ...(opts.html ? { html: opts.html } : {}) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      // Resend explains the failure in the body (e.g. "The complynz.com domain is not verified").
      const detail = redactEmails((await r.text().catch(() => "")).slice(0, 300));
      console.error(`email NOT sent: Resend returned ${r.status} ${detail}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`email NOT sent: network error ${redactEmails((e as Error)?.name ?? "")}`);
    return false;
  }
}

/** Replace {{key}} placeholders. Values are inserted as plain text. */
export function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");
}
