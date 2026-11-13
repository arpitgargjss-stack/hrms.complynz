import { env } from "../env";

/** Send via Resend when configured. Never throws. Logs never include addresses or content. */
export async function sendEmail(opts: { to: string; subject: string; text: string; html?: string }): Promise<boolean> {
  if (!env.RESEND_API_KEY) { console.log("email skipped (no provider configured)"); return false; }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [opts.to], subject: opts.subject, text: opts.text, ...(opts.html ? { html: opts.html } : {}) }),
    });
    if (!r.ok) { console.log(`email failed (status ${r.status})`); return false; }
    return true;
  } catch { console.log("email failed (network)"); return false; }
}

/** Replace {{key}} placeholders. Values are inserted as plain text. */
export function fillTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");
}
