/**
 * Converts between a stored policy template (HTML with {{key}} placeholders) and the visual editor's HTML, where each
 * placeholder is a non-editable chip showing a friendly label. The round trip keeps every {{key}} exactly.
 */
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function chipHtml(key: string, label: string, known = true): string {
  return `<span class="ph-chip${known ? "" : " ph-chip-bad"}" contenteditable="false" data-ph="${esc(key)}" title="{{${esc(key)}}}">${esc(label)}</span>`;
}

/** Template → editor HTML: each {{key}} becomes a chip. */
export function toEditorHtml(template: string, labelOf: (key: string) => string | null): string {
  return template.replace(/\{\{\s*([a-z0-9_.]+)\s*\}\}/gi, (_m, k: string) => { const l = labelOf(k); return chipHtml(k, l ?? k, !!l); });
}

/** Editor HTML → template: chips become {{key}} again; editor-only artefacts are removed. */
export function fromEditorHtml(html: string): string {
  return html
    .replace(/<span[^>]*\bdata-ph="([a-z0-9_.]+)"[^>]*>[\s\S]*?<\/span>/gi, (_m, k: string) => `{{${k}}}`)
    .replace(/\s*contenteditable="(true|false)"/gi, "")
    .replace(/<div>/gi, "<p>").replace(/<\/div>/gi, "</p>")
    .replace(/<br\s*\/?>(\s*<\/(p|li|h[1-6])>)/gi, "$1") // trailing line breaks browsers add inside blocks
    .replace(/<p>\s*<\/p>/gi, "")
    .replace(/&nbsp;/g, " ")
    .trim();
}
