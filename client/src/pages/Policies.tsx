import { useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Card, Chip, ErrorNote, Field, Page } from "../lib/ui";
import { celebrate } from "../lib/gz";

type PolicyRow = { slug: string; title: string; version: number; acknowledged: boolean };
type Policy = PolicyRow & { html: string; publishedAt: string | null; acknowledgedAt: string | null };
type Summary = { slug: string; total: number; acknowledged: number; pending: { id: string; name: string; code: string }[] };
const DOC_CSS = "<style>body{font-family:system-ui,sans-serif;color:#2b3350;line-height:1.7;font-size:15px;margin:16px}h1,h2,h3{color:#1a2036}</style>";

export default function Policies() {
  const { slug } = useParams<{ slug?: string }>();
  const [, nav] = useLocation();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ roles: string[] }>("/me") });
  const admin = !!me.data?.roles.includes("hr_admin");
  const list = useQuery({ queryKey: ["policies"], queryFn: () => api<PolicyRow[]>("/policies") });
  const one = useQuery({ queryKey: ["policy", slug], enabled: !!slug, queryFn: () => api<Policy>(`/policies/${slug}`) });
  const sums = useQuery({ queryKey: ["policy-acks"], enabled: admin, queryFn: () => api<Summary[]>("/policies/acks/summary") });
  const ack = useMutation({ mutationFn: () => api(`/policies/${slug}/ack`, { method: "POST", body: {} }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["policy", slug] }); qc.invalidateQueries({ queryKey: ["policies"] }); qc.invalidateQueries({ queryKey: ["policy-acks"] }); qc.invalidateQueries({ queryKey: ["home"] }); qc.invalidateQueries({ queryKey: ["privacy"] }); celebrate("Acknowledged", "Saved to My privacy"); } });
  const [show, setShow] = useState(false);
  const [f, setF] = useState({ slug: "", title: "", html: "" });
  const pub = useMutation({
    mutationFn: () => api<{ slug: string }>("/policies", { method: "POST", body: f }),
    onSuccess: (r) => { setShow(false); setF({ slug: "", title: "", html: "" }); qc.invalidateQueries({ queryKey: ["policies"] }); qc.invalidateQueries({ queryKey: ["policy-acks"] }); nav(`/policies/${r.slug}`); },
  });
  const sum = (s: string) => sums.data?.find((x) => x.slug === s);

  return (
    <Page title="Policies" actions={admin && <button className="btn p" onClick={() => setShow(!show)} aria-expanded={show}>Upload policy</button>}>
      {show && (
        <Card>
          <form onSubmit={(e) => { e.preventDefault(); pub.mutate(); }}>
            <h2>Upload and publish a policy</h2>
            <p className="k">Publishing an existing slug creates a new version and asks everyone to acknowledge it again. HTML is sanitised on the server.</p>
            <div className="grid">
              <Field label="Title"><input required maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
              <Field label="Slug (lowercase letters, digits, hyphens)"><input required pattern="[a-z0-9][a-z0-9\-]{1,78}" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase() })} /></Field>
            </div>
            <Field label="Load from an HTML file (optional)"><input type="file" accept=".html,.htm,text/html" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setF({ ...f, html: await file.text() }); }} /></Field>
            <Field label="Policy HTML"><textarea required rows={10} value={f.html} onChange={(e) => setF({ ...f, html: e.target.value })} /></Field>
            <ErrorNote error={pub.error} />
            <div className="row-gap" style={{ marginTop: 12 }}><button className="btn p" disabled={pub.isPending}>Publish</button><button type="button" className="btn" onClick={() => setShow(false)}>Cancel</button></div>
          </form>
        </Card>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 260px" }}><Card>
          <ErrorNote error={list.error} />
          <nav aria-label="Policies">
            {list.data?.map((p) => (
              <Link key={p.slug} href={`/policies/${p.slug}`} aria-current={p.slug === slug ? "page" : undefined}
                style={{ display: "block", padding: "12px 4px", minHeight: 44, borderBottom: "1px solid var(--line)", color: "var(--ink)", textDecoration: "none", fontWeight: p.slug === slug ? 600 : 400 }}>
                {p.title} <span className="k">v{p.version}</span>{" "}
                {p.acknowledged ? <Chip tone="ok">Acknowledged</Chip> : <Chip tone="warn">To acknowledge</Chip>}
                {sum(p.slug) && <span className="k" style={{ display: "block" }}>{sum(p.slug)!.acknowledged} of {sum(p.slug)!.total} acknowledged</span>}
              </Link>
            ))}
          </nav>
          {list.data?.length === 0 && <p className="k">No policies published yet.</p>}
        </Card></div>
        <div style={{ flex: "3 1 380px", minWidth: 0 }}>
          {!slug && <Card><p className="k">Choose a policy to read it.</p></Card>}
          {slug && (
            <Card>
              <ErrorNote error={one.error} />
              {one.data && (
                <>
                  <h2 style={{ fontSize: 20 }}>{one.data.title}</h2>
                  <p className="k">Version {one.data.version}{one.data.publishedAt ? ` · published ${new Date(one.data.publishedAt).toLocaleDateString("en-IN")}` : ""}</p>
                  <iframe title={`${one.data.title} policy text`} sandbox="" srcDoc={DOC_CSS + one.data.html} style={{ width: "100%", height: 480, border: "1px solid var(--line)", borderRadius: 8, background: "#fff" }} />
                  <div style={{ marginTop: 12 }}>
                    {one.data.acknowledged
                      ? <Chip tone="ok">Acknowledged{one.data.acknowledgedAt ? ` on ${new Date(one.data.acknowledgedAt).toLocaleDateString("en-IN")}` : ""}</Chip>
                      : <><ErrorNote error={ack.error} /><button className="btn p" disabled={ack.isPending} onClick={() => ack.mutate()}>I have read and acknowledge this policy</button></>}
                  </div>
                  {admin && sum(slug) && sum(slug)!.pending.length > 0 && (
                    <details style={{ marginTop: 12 }}><summary>{sum(slug)!.pending.length} pending acknowledgement</summary>
                      <ul>{sum(slug)!.pending.map((p) => <li key={p.id}>{p.name} <span className="k">{p.code}</span></li>)}</ul></details>
                  )}
                </>
              )}
              {one.isLoading && <p>Loading…</p>}
            </Card>
          )}
        </div>
      </div>
    </Page>
  );
}
