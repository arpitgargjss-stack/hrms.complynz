import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Card, ErrorNote, Page } from "../lib/ui";

type N = { id: string; name: string; code: string; designation: string | null; department: string | null; children: N[] };
const initials = (n: string) => n.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();

function Node({ n, depth }: { n: N; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const has = n.children.length > 0;
  return (
    <li style={{ listStyle: "none", margin: "8px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "1px solid #c9cfe0", borderRadius: 10, padding: "8px 12px", maxWidth: 420 }}>
        <span aria-hidden style={{ width: 36, height: 36, borderRadius: "50%", background: "#e4e9fb", color: "#2438a8", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 600, fontSize: 13, flex: "0 0 36px" }}>{initials(n.name)}</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <Link href={`/people/${n.id}`}>{n.name}</Link>
          <span className="k" style={{ display: "block" }}>{[n.designation, n.department].filter(Boolean).join(" · ") || n.code}</span>
        </span>
        {has && <button className="btn" aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${n.name}, ${n.children.length} direct report${n.children.length > 1 ? "s" : ""}`} onClick={() => setOpen(!open)} style={{ minWidth: 44, padding: "6px 10px" }}>{open ? "−" : `+${n.children.length}`}</button>}
      </div>
      {has && open && <ul style={{ margin: 0, paddingLeft: 28, borderLeft: "2px solid #e3e6ef", marginLeft: 18 }}>{n.children.map((c) => <Node key={c.id} n={c} depth={depth + 1} />)}</ul>}
    </li>
  );
}

export default function OrgChart() {
  const q = useQuery({ queryKey: ["org-chart"], queryFn: () => api<{ tree: N[] }>("/org-chart") });
  return (
    <Page title="Org chart">
      <ErrorNote error={q.error} />
      <Card>
        {q.isLoading && <p>Loading…</p>}
        {q.data && (q.data.tree.length === 0 ? <p>No employees yet.</p> : <ul aria-label="Reporting lines" style={{ margin: 0, padding: 0 }}>{q.data.tree.map((n) => <Node key={n.id} n={n} depth={0} />)}</ul>)}
      </Card>
    </Page>
  );
}
