/**
 * Small allow-by-removal sanitiser for admin-authored policy HTML.
 * Strips script/iframe/object/embed/etc, inline event handlers and script-bearing URLs.
 * Content is only authored by hr_admin and rendered to staff; this is defence in depth.
 */
const DANGEROUS_TAGS = ["script", "iframe", "object", "embed", "applet", "meta", "base", "link", "frame", "frameset"];

function decodeEntities(v: string): string {
  return v
    .replace(/&#x([0-9a-f]+);?/gi, (_m, h) => String.fromCodePoint(Math.min(parseInt(h, 16), 0x10ffff)))
    .replace(/&#(\d+);?/g, (_m, d) => String.fromCodePoint(Math.min(parseInt(d, 10), 0x10ffff)))
    .replace(/&colon;/gi, ":").replace(/&tab;/gi, "\t").replace(/&newline;/gi, "\n");
}
function isDangerousUrl(raw: string): boolean {
  // eslint-disable-next-line no-control-regex
  const v = decodeEntities(raw).replace(/[\s\u0000-\u001f]/g, "").toLowerCase();
  return /^(javascript|vbscript):/.test(v) || /^data:(text\/html|application\/xhtml|image\/svg)/.test(v);
}

export function sanitizeHtml(input: string): string {
  let html = input;
  for (let pass = 0; pass < 5; pass++) {
    const before = html;
    for (const tag of DANGEROUS_TAGS) {
      html = html.replace(new RegExp(`<\\s*${tag}\\b[^>]*>[\\s\\S]*?<\\s*/\\s*${tag}\\s*>`, "gi"), "");
      html = html.replace(new RegExp(`<\\s*/?\\s*${tag}\\b[^>]*>?`, "gi"), "");
    }
    // inline event handlers: onclick=..., including <img/onerror=...>
    html = html.replace(/[\s/"']on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]*)/gi, " ");
    // script-bearing URLs
    html = html.replace(/\b(href|src|xlink:href|action|formaction|poster|background)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
      (m, attr: string, _all: string, dq?: string, sq?: string, bare?: string) => (isDangerousUrl(dq ?? sq ?? bare ?? "") ? `${attr}="#"` : m));
    // style attributes that can run script in legacy engines
    html = html.replace(/\sstyle\s*=\s*("[^"]*(expression\(|javascript:)[^"]*"|'[^']*(expression\(|javascript:)[^']*')/gi, "");
    if (html === before) break;
  }
  return html;
}
