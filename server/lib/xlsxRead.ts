import { inflateRawSync } from "node:zlib";

/**
 * Minimal reader for the first worksheet of an .xlsx file (no dependency), plus CSV.
 * Returns rows of cell text. Good enough for the payroll import template; not a general spreadsheet parser.
 */
function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  // End of central directory record: scan back from the end.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Not a valid .xlsx file");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Not a valid .xlsx file");
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    const lnlen = buf.readUInt16LE(local + 26), lxlen = buf.readUInt16LE(local + 28);
    const data = buf.subarray(local + 30 + lnlen + lxlen, local + 30 + lnlen + lxlen + csize);
    if (name.endsWith(".xml") || name.endsWith(".rels")) out.set(name, method === 8 ? inflateRawSync(data) : method === 0 ? Buffer.from(data) : Buffer.alloc(0));
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

const unxml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d))).replace(/&amp;/g, "&");
const textOf = (xml: string) => [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unxml(m[1])).join("");
const colIndex = (ref: string) => { const letters = ref.replace(/\d+/g, ""); let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

function readXlsx(buf: Buffer): string[][] {
  const files = unzip(buf);
  const shared = files.get("xl/sharedStrings.xml")?.toString("utf8");
  const strings = shared ? [...shared.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1])) : [];
  const sheetName = [...files.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))[0];
  if (!sheetName) throw new Error("The workbook has no worksheet");
  const xml = files.get(sheetName)!.toString("utf8");
  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row: string[] = [];
    for (const cm of (rm[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], body = cm[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const t = attrs.match(/\bt="(\w+)"/)?.[1];
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const val = t === "s" ? strings[Number(v)] ?? "" : t === "inlineStr" ? textOf(body) : v != null ? unxml(v) : "";
      const at = ref ? colIndex(ref) : row.length;
      while (row.length < at) row.push("");
      row[at] = val;
    }
    rows.push(row);
  }
  return rows;
}

function readCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; } else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Rows of trimmed cell text from an .xlsx (first sheet) or a CSV file. Blank rows are dropped. */
export function readSheet(buf: Buffer): string[][] {
  const rows = buf.subarray(0, 2).toString("latin1") === "PK" ? readXlsx(buf) : readCsv(buf.toString("utf8").replace(/^﻿/, ""));
  return rows.map((r) => r.map((c) => String(c ?? "").trim())).filter((r) => r.some((c) => c !== ""));
}
