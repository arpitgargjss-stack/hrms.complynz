import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Card, ErrorNote, Field, Page } from "../lib/ui";

type Item = { id: string; at: string; actorEmail: string; action: string; entityType: string | null; entityId: string | null; detail: unknown };
type Resp = { items: Item[]; total: number; limit: number; offset: number };
const LIMIT = 50;

/** One-line summary of an entry's detail, with the rest behind "Show details" (cut at 500 characters). */
function Detail({ d }: { d: unknown }) {
  if (d == null) return null;
  const json = JSON.stringify(d);
  const o = typeof d === "object" && !Array.isArray(d) ? (d as Record<string, unknown>) : null;
  const summary = o ? Object.entries(o).filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v)).slice(0, 4).map(([k, v]) => `${k}: ${String(v)}`).join(" · ") : "";
  const line = summary || json;
  if (json.length <= 120) return <>{json}</>;
  return <details><summary style={{ cursor: "pointer" }}>{line.slice(0, 120)}{line.length > 120 ? "…" : ""} <span style={{ color: "var(--brand)" }}>Show details</span></summary>
    <code style={{ display: "block", whiteSpace: "pre-wrap", marginTop: 4 }}>{json.length > 500 ? `${json.slice(0, 500)}… (${json.length} characters)` : json}</code></details>;
}

export default function Audit() {
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const qs = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
  if (action.trim()) qs.set("action", action.trim());
  if (actor.trim()) qs.set("actor", actor.trim());
  const q = useQuery({ queryKey: ["audit", offset, action, actor], queryFn: () => api<Resp>("/audit?" + qs) });
  const total = q.data?.total ?? 0;
  return (
    <Page title="Audit log">
      <Card>
        <div className="grid">
          <Field label="Action (exact, e.g. employee.create)"><input value={action} onChange={(e) => { setAction(e.target.value); setOffset(0); }} /></Field>
          <Field label="Actor email"><input type="email" value={actor} onChange={(e) => { setActor(e.target.value); setOffset(0); }} /></Field>
        </div>
      </Card>
      <ErrorNote error={q.error} />
      <Card>
        <div style={{ overflowX: "auto" }}>
          <table className="t"><caption className="k" style={{ textAlign: "left", paddingBottom: 8 }}>{total} entries. Newest first.</caption>
            <thead><tr><th scope="col">When</th><th scope="col">Who</th><th scope="col">Action</th><th scope="col">Entity</th><th scope="col">Detail</th></tr></thead>
            <tbody>{q.data?.items.map((i) => (
              <tr key={i.id}><td>{new Date(i.at).toLocaleString("en-IN")}</td><td>{i.actorEmail}</td><td>{i.action}</td>
                <td>{i.entityType ?? ""} <span className="k">{i.entityId ? i.entityId.slice(0, 8) : ""}</span></td>
                <td className="k" style={{ wordBreak: "break-word", maxWidth: 420 }}><Detail d={i.detail} /></td></tr>
            ))}</tbody></table>
        </div>
        {q.isLoading && <p>Loading…</p>}
        <div className="row-gap" style={{ marginTop: 12, alignItems: "center" }}>
          <button className="btn" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>Previous</button>
          <button className="btn" disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)}>Next</button>
          <span className="k">{total ? `${offset + 1}–${Math.min(offset + LIMIT, total)} of ${total}` : "No entries"}</span>
        </div>
      </Card>
    </Page>
  );
}
