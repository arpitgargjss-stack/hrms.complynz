/**
 * Compares two policy versions by their rendered text. HTML is reduced to readable blocks (headings, paragraphs,
 * list items, table rows), then a line-level LCS diff marks each block as unchanged, added or removed.
 */
export type DiffOp = { op: "same" | "add" | "del"; text: string };

const decode = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
/** Readable blocks of a policy's HTML, one per heading, paragraph, list item or table row. */
export function htmlToBlocks(html: string): string[] {
  return decode(html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<\/?(h[1-6]|p|li|tr|div|br|ul|ol|table|thead|tbody)\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, ""))
    .split("\n").map((l) => l.replace(/\s*\|\s*$/, "").replace(/\s+/g, " ").trim()).filter(Boolean);
}

/** Line diff of two block lists (longest common subsequence). */
export function diffBlocks(a: string[], b: string[]): DiffOp[] {
  const n = a.length, m = b.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: DiffOp[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ op: "same", text: a[i] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) out.push({ op: "del", text: a[i++] });
    else out.push({ op: "add", text: b[j++] });
  }
  while (i < n) out.push({ op: "del", text: a[i++] });
  while (j < m) out.push({ op: "add", text: b[j++] });
  return out;
}
export const diffPolicies = (oldHtml: string, newHtml: string) => diffBlocks(htmlToBlocks(oldHtml), htmlToBlocks(newHtml));
