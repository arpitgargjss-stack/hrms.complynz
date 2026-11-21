import { useMemo, useState, type ReactNode } from "react";

/**
 * A table with search, sort on every column, dropdown filters and CSV download.
 * Columns declare how to read a value; `filter: true` turns the column into a dropdown filter.
 */
export type Col<T> = { key: string; label: string; value: (r: T) => string | number | null; render?: (r: T) => ReactNode; filter?: boolean; align?: "right" };

const csvCell = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function DataTable<T>({ rows, cols, rowKey, empty = "Nothing here yet.", file, initialSort, onRow, toolbar, groupBy, groupLabel = "Group into folders", groupOrder, rowClass }: {
  rows: T[]; cols: Col<T>[]; rowKey: (r: T) => string; empty?: string; file?: string; initialSort?: { key: string; dir: 1 | -1 }; onRow?: (r: T) => void; toolbar?: ReactNode;
  /** When set, rows can be shown in collapsible folders by this value. */ groupBy?: (r: T) => string; groupLabel?: string; groupOrder?: string[]; rowClass?: (r: T) => string | undefined;
}) {
  const [grouped, setGrouped] = useState(!!groupBy);
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(initialSort ?? null);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const fcols = cols.filter((c) => c.filter);
  const options = useMemo(() => Object.fromEntries(fcols.map((c) => [c.key, [...new Set(rows.map((r) => String(c.value(r) ?? "")))].filter(Boolean).sort()])), [rows, cols]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.filter((r) => (!needle || cols.some((c) => String(c.value(r) ?? "").toLowerCase().includes(needle)))
      && fcols.every((c) => !filters[c.key] || String(c.value(r) ?? "") === filters[c.key]));
    if (sort) { const c = cols.find((x) => x.key === sort.key); if (c) out = [...out].sort((a, b) => { const x = c.value(a), y = c.value(b); if (x == null) return 1; if (y == null) return -1; return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en", { numeric: true })) * sort.dir; }); }
    return out;
  }, [rows, cols, q, sort, filters]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => {
    if (!groupBy) return [] as [string, T[]][];
    const m = new Map<string, T[]>(); for (const r of shown) { const g = groupBy(r); m.set(g, [...(m.get(g) ?? []), r]); }
    const order = groupOrder ?? [];
    return [...m.entries()].sort((a, b) => { const x = order.indexOf(a[0]), y = order.indexOf(b[0]); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y) || a[0].localeCompare(b[0]); });
  }, [shown, groupBy, groupOrder]);
  const row = (r: T) => <tr key={rowKey(r)} onClick={onRow ? () => onRow(r) : undefined} className={[onRow ? "dt-click" : "", rowClass?.(r) ?? ""].join(" ").trim() || undefined}>{cols.map((c) => <td key={c.key} style={c.align ? { textAlign: c.align } : undefined}>{c.render ? c.render(r) : c.value(r) ?? "-"}</td>)}</tr>;
  const download = () => {
    const text = [cols.map((c) => csvCell(c.label)).join(","), ...shown.map((r) => cols.map((c) => csvCell(c.value(r))).join(","))].join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv" })); a.download = `${file ?? "table"}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const active = Object.values(filters).filter(Boolean).length + (q ? 1 : 0);
  return (
    <div className="dt">
      <div className="dt-bar">
        <input type="search" placeholder="Search" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        {fcols.map((c) => <select key={c.key} aria-label={`Filter by ${c.label}`} value={filters[c.key] ?? ""} onChange={(e) => setFilters({ ...filters, [c.key]: e.target.value })}>
          <option value="">All {c.label.toLowerCase()}</option>{options[c.key].map((o) => <option key={o} value={o}>{o}</option>)}</select>)}
        {active > 0 && <button type="button" className="btn" onClick={() => { setQ(""); setFilters({}); }}>Clear</button>}
        <span className="k dt-count">{shown.length} of {rows.length}</span>
        {groupBy && <label className="dt-group"><input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} /> {groupLabel}</label>}
        {toolbar}
        {file && <button type="button" className="btn" onClick={download}>Download CSV</button>}
      </div>
      <div className="dt-scroll"><table className="t">
        <thead><tr>{cols.map((c) => { const on = sort?.key === c.key; return <th key={c.key} aria-sort={on ? (sort!.dir === 1 ? "ascending" : "descending") : "none"} style={c.align ? { textAlign: c.align } : undefined}>
          <button type="button" className="dt-sort" onClick={() => setSort(on && sort!.dir === -1 ? null : { key: c.key, dir: on ? -1 : 1 })}>{c.label}<span aria-hidden>{on ? (sort!.dir === 1 ? " ▲" : " ▼") : " ↕"}</span></button></th>; })}</tr></thead>
        {!shown.length ? <tbody><tr><td colSpan={cols.length} className="k">{rows.length ? "No rows match the search or filters." : empty}</td></tr></tbody>
          : groupBy && grouped ? groups.map(([g, rs]) => <tbody key={g}>
            <tr className="dt-folder"><td colSpan={cols.length}><button type="button" aria-expanded={!closed[g]} onClick={() => setClosed({ ...closed, [g]: !closed[g] })}><span aria-hidden>{closed[g] ? "▸" : "▾"}</span> {g} <span className="k">({rs.length})</span></button></td></tr>
            {!closed[g] && rs.map(row)}</tbody>)
          : <tbody>{shown.map(row)}</tbody>}
      </table></div>
    </div>
  );
}
