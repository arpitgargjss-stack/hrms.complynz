import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { openAuthed } from "../lib/openHtml";
import { RichEditor } from "../lib/RichEditor";
import { Card, ErrorNote, Field } from "../lib/ui";
import { PLACEHOLDERS, type PlaceholderDef } from "../../../shared/hr/placeholders";
import { replaceBlank, suggestFor } from "../../../shared/hr/legacyPolicy";

type Ver = { id: string; version: number; status: string; statusLabel: string; summary: string | null; createdBy: string | null; createdAt: string; submittedBy: string | null; submittedAt: string | null;
  approvedBy: string | null; approvedAt: string | null; reviewNote: string | null; publishedBy: string | null; publishedAt: string | null; fileId: string | null; hasTemplate: boolean };
type Row = { slug: string; title: string; category: string | null; kind: string; version: number | null; publishedAt: string | null; draft: Ver | null; acks: { done: number; total: number } | null; updatedSince: string[]; missing: string[]; blanks: number };
type ListResp = { ceo: boolean; starters: { slug: string; title: string; category: string; summary: string }[]; policies: Row[] };
type Detail = { ceo: boolean; policy: { slug: string; title: string; category: string | null; kind: string; version: number | null };
  draft: (Ver & { template: string | null }) | null; published: (Ver & { html: string; template: string | null; legacy: boolean; missing: string[]; unknown: string[]; blanks: string[]; updatedSince: string[]; updates: { group: string; at: string }[] }) | null;
  preview: Preview | null; convertible: number; history: Ver[] };
type Preview = { html: string; missing: string[]; unknown: string[]; blanks?: string[] };

const label = (k: string) => PLACEHOLDERS.find((p) => p.key === k)?.label ?? k;
const dt = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");
const tone = (s: string) => (s === "published" ? "green" : s === "pending_approval" || s === "approved" ? "amber" : "slate");
const fileToBase64 = (f: File) => new Promise<string>((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] ?? ""); r.onerror = bad; r.readAsDataURL(f); });
const DOC_CSS = "<style>body{font-family:Inter,system-ui,sans-serif;color:#101828;line-height:1.65;font-size:14px;margin:20px}h1{font-size:20px}h2{font-size:15px;margin-top:20px}table{border-collapse:collapse;width:100%;margin:8px 0}th,td{border:1px solid #e4e7ec;padding:6px 8px;text-align:left;font-size:13px}th{background:#f7f8fa;font-weight:600}mark.ph-missing{background:#fffaeb;color:#b54708;border:1px dashed #f79009;padding:0 4px;border-radius:3px}mark.ph-bad{background:#fef3f2;color:#b42318;padding:0 4px;border-radius:3px}</style>";

function Doc({ html, title }: { html: string; title: string }) {
  return <iframe className="cfg-doc" title={title} sandbox="" srcDoc={DOC_CSS + html} />;
}
function Missing({ p, goConfig, onReplace, template }: { p: Preview; goConfig: (tab: string) => void; onReplace?: (blank: string, key: string) => void; template?: string }) {
  const blanks = p.blanks ?? [];
  if (!p.missing.length && !p.unknown.length && !blanks.length) return <p className="cfg-ok-line">All fields are linked and have values. Ready to submit.</p>;
  return <div className="cfg-missing" role="status">
    <b>Needs attention before submitting</b>
    {blanks.length > 0 && <ul>{blanks.map((b) => <li key={b}><code>[{b}]</code> is old text, not linked to Configuration.
      {onReplace && <select className="cfg-replace" aria-label={`Replace [${b}] with a field`} value="" onChange={(e) => e.target.value && onReplace(b, e.target.value)}>
        <option value="">Replace with field…</option>
        {(() => { const k = template ? suggestFor(template, b) : null; const def = k ? PLACEHOLDERS.find((x) => x.key === k) : null; return def ? <optgroup label="Suggested"><option value={def.key}>{def.label}</option></optgroup> : null; })()}
        {[...new Set(PLACEHOLDERS.map((x) => x.group))].map((g) => <optgroup key={g} label={g}>{PLACEHOLDERS.filter((x) => x.group === g).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</optgroup>)}
      </select>} <span className="k">or edit the text.</span></li>)}</ul>}
    <ul>{p.missing.map((k) => { const d = PLACEHOLDERS.find((x) => x.key === k)!; const tab = d.source.includes("Company") ? "company" : d.source.includes("People") ? "people" : null;
      return <li key={k}>{d.label} <code>{`{{${k}}}`}</code> {tab ? <button type="button" className="cp-link" onClick={() => goConfig(tab)}>{d.source}</button> : <span className="k">{d.source}</span>}</li>; })}
      {p.unknown.map((k) => <li key={k} className="cfg-bad"><code>{`{{${k}}}`}</code> is not a known placeholder. Use the Insert placeholder list.</li>)}</ul>
  </div>;
}

function PlaceholderPicker({ onPick }: { onPick: (d: PlaceholderDef) => void }) {
  const groups = [...new Set(PLACEHOLDERS.map((p) => p.group))];
  return <select aria-label="Insert placeholder" value="" onChange={(e) => { const d = PLACEHOLDERS.find((p) => p.key === e.target.value); if (d) onPick(d); }}>
    <option value="">Insert placeholder…</option>
    {groups.map((g) => <optgroup key={g} label={g}>{PLACEHOLDERS.filter((p) => p.group === g).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}</optgroup>)}
  </select>;
}

type AckResp = { total: number; done: number; pending: { id: string; name: string; code: string; reminders: number; lastRemindedAt: string | null }[] };
/** Who has not acknowledged the published version, with reminders (in-app notice, and email where configured). */
function Acks({ slug }: { slug: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["config-policy-acks", slug], queryFn: () => api<AckResp>(`/config/policies/${slug}/acks`) });
  const remind = useMutation({ mutationFn: (ids?: string[]) => api<{ reminded: number; emailed: number; emailAvailable: boolean }>(`/config/policies/${slug}/remind`, { body: ids ? { employeeIds: ids } : {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["config-policy-acks", slug] }) });
  if (!q.data) return null;
  const a = q.data, pct = a.total ? Math.round((100 * a.done) / a.total) : 0;
  return <Card>
    <div className="cfg-card-head"><div><h2>Acknowledgements</h2><p className="k">{a.done} of {a.total} people ({pct}%) have acknowledged the published version.</p></div>
      {a.pending.length > 0 && <button className="btn sm p" disabled={remind.isPending} onClick={() => remind.mutate(undefined)}>Remind all {a.pending.length}</button>}</div>
    <span className={`cp-bar ${pct >= 80 ? "green" : "amber"}`} style={{ maxWidth: 320, marginBottom: 12 }}><i style={{ width: `${pct}%` }} /></span>
    {remind.data && <p className="cfg-ok-line" role="status">Reminded {remind.data.reminded} {remind.data.reminded === 1 ? "person" : "people"} with a notice on their Home page{remind.data.emailAvailable ? `, and ${remind.data.emailed} by email` : ". Email is not set up here, so no emails were sent"}.</p>}
    {remind.error && <ErrorNote error={remind.error} />}
    {a.pending.length ? <div className="cfg-table-wrap"><table className="cfg-table"><thead><tr><th>Not yet acknowledged</th><th>Code</th><th>Last reminded</th><th /></tr></thead>
      <tbody>{a.pending.slice(0, 200).map((e) => <tr key={e.id}><td>{e.name}</td><td className="k">{e.code}</td><td className="k">{e.lastRemindedAt ? `${dt(e.lastRemindedAt)} (${e.reminders})` : "Never"}</td>
        <td style={{ textAlign: "right" }}><button className="btn sm" disabled={remind.isPending} onClick={() => remind.mutate([e.id])}>Remind</button></td></tr>)}</tbody></table></div>
      : <p className="cfg-ok-line">Everyone has acknowledged this version.</p>}
  </Card>;
}

type CompareResp = { from: number; to: number; ops: { op: "same" | "add" | "del"; text: string }[]; added: number; removed: number };
/** Side by side is hard to read for policies; an inline diff of the rendered text shows what changed. */
function Compare({ slug, versions }: { slug: string; versions: number[] }) {
  const sorted = [...versions].sort((x, y) => x - y);
  const [from, setFrom] = useState(sorted[sorted.length - 2]), [to, setTo] = useState(sorted[sorted.length - 1]);
  const [changedOnly, setChangedOnly] = useState(true);
  const q = useQuery({ queryKey: ["config-policy-compare", slug, from, to], enabled: from !== to, queryFn: () => api<CompareResp>(`/config/policies/${slug}/compare?from=${from}&to=${to}`) });
  const near = (o?: { op: string }) => !!o && o.op !== "same";
  const ops = (q.data?.ops ?? []).filter((o, i, all) => !changedOnly || o.op !== "same" || near(all[i - 1]) || near(all[i + 1]));
  return <Card>
    <div className="cfg-card-head"><div><h2>Compare versions</h2><p className="k">Rendered text of two versions; a draft uses today's values.</p></div></div>
    <div className="form-row cfg-cmp-row">
      <Field label="From version"><select value={from} onChange={(e) => setFrom(Number(e.target.value))}>{sorted.map((v) => <option key={v} value={v}>Version {v}</option>)}</select></Field>
      <Field label="To version"><select value={to} onChange={(e) => setTo(Number(e.target.value))}>{sorted.map((v) => <option key={v} value={v}>Version {v}</option>)}</select></Field>
      <label className="cp-check"><input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} /> Only changes and their neighbours</label>
    </div>
    {from === to ? <p className="k">Choose two different versions.</p> : q.error ? <ErrorNote error={q.error} /> : !q.data ? <p className="k">Comparing…</p> : <>
      <p className="k">{q.data.added} added, {q.data.removed} removed.</p>
      <div className="cfg-diff">{ops.length ? ops.map((o, i) => <div key={i} className={`cfg-diff-${o.op}`}><span aria-hidden>{o.op === "add" ? "+" : o.op === "del" ? "−" : " "}</span>{o.op === "add" ? <ins>{o.text}</ins> : o.op === "del" ? <del>{o.text}</del> : o.text}</div>) : <p className="k">No differences in the text.</p>}</div>
    </>}
  </Card>;
}

function Editor({ slug, onBack, goConfig }: { slug: string; onBack: () => void; goConfig: (tab: string) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["config-policy", slug], queryFn: () => api<Detail>(`/config/policies/${slug}`) });
  const d = q.data;
  const [f, setF] = useState({ title: "", category: "", summary: "", template: "" });
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  useEffect(() => { if (d) { setF({ title: d.policy.title, category: d.policy.category ?? "", summary: d.draft?.summary ?? "", template: d.draft?.template ?? "" }); setPreview(d.preview); } }, [d]);
  const dirty = !!d?.draft && (f.template !== (d.draft.template ?? "") || f.title !== d.policy.title || (f.category || null) !== d.policy.category || (f.summary || null) !== (d.draft.summary ?? null));
  // Live preview with real values, a moment after typing stops.
  useEffect(() => {
    if (!d?.draft?.hasTemplate) return;
    const t = setTimeout(() => { api<Preview>("/config/policies/preview", { body: { template: f.template } }).then(setPreview).catch(() => undefined); }, 400);
    return () => clearTimeout(t);
  }, [f.template, d?.draft?.hasTemplate]);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["config-policy", slug] }); qc.invalidateQueries({ queryKey: ["config-policies"] }); qc.invalidateQueries({ queryKey: ["config-placeholders"] }); };
  const save = useMutation({ mutationFn: () => api(`/config/policies/${slug}/draft`, { method: "PUT", body: { title: f.title, category: f.category || null, summary: f.summary || null, template: f.template } }), onSuccess: refresh });
  const act = useMutation({ mutationFn: (a: string) => api(`/config/policies/${slug}/${a}`, { body: a === "return" || a === "approve" ? { note: note || undefined } : {} }), onSuccess: () => { setNote(""); refresh(); } });
  const newVersion = useMutation({ mutationFn: () => api("/config/policies", { body: { slug, title: d!.policy.title, category: d!.policy.category } }), onSuccess: refresh });
  if (q.error) return <ErrorNote error={q.error} />;
  if (!d) return <Card><p className="k">Loading…</p></Card>;
  const dr = d.draft, pub = d.published, ready = !!preview && !preview.missing.length && !preview.unknown.length && !(preview.blanks ?? []).length;
  const unlinked = dr ? (preview?.blanks ?? []).length : pub?.blanks.length ?? 0;
  const err = save.error ?? act.error ?? newVersion.error;
  return <>
    <div className="cfg-crumb"><button type="button" className="cp-link" onClick={onBack}>← All policies</button></div>
    <div className="cfg-pol-head">
      <div><h2>{d.policy.title}</h2><p className="k">{d.policy.category ?? "Uncategorised"} · {d.policy.kind === "pdf" ? "PDF, view and acknowledge" : unlinked ? `Legacy text: ${unlinked} blank${unlinked === 1 ? "" : "s"} not linked` : "Linked to Configuration"}{pub ? ` · Published version ${pub.version} on ${dt(pub.publishedAt)}` : " · Not published yet"}</p></div>
      {dr ? <span className={`cp-tag ${tone(dr.status)}`}>Version {dr.version}: {dr.statusLabel}</span> : pub && <span className="cp-tag green">Published</span>}
    </div>
    {pub && pub.missing.length > 0 && <div className="cfg-banner amber"><b>Details missing in the published policy:</b> {pub.missing.map(label).join(", ")}. Employees see these as highlighted blanks until they are set. <button type="button" className="cp-link" onClick={() => goConfig(pub.missing.some((k) => k.startsWith("company.")) ? "company" : "people")}>Fill them in Configuration</button></div>}
    {pub && pub.updates.length > 0 && <div className="cfg-banner slate">Details updated since version {pub.version} was published: {pub.updates.map((u) => `${u.group} on ${dt(u.at)}`).join(", ")}. Employees already see the new details; no re-publish or new acknowledgement is needed.</div>}
    {pub?.legacy && <div className="cfg-banner slate">This version was published before fields existed. Its blanks have been matched to Configuration where the context was clear and fill in live.</div>}
    {!dr && pub && pub.blanks.length > 0 && <div className="cfg-banner amber"><b>{pub.blanks.length} blank{pub.blanks.length === 1 ? "" : "s"} not linked:</b> {pub.blanks.map((b) => `[${b}]`).join(", ")}. Start a new version to link them to a field or edit the text.</div>}
    {dr && d.convertible > 0 && <div className="cfg-banner slate">{d.convertible} old blank{d.convertible === 1 ? " was" : "s were"} linked to Configuration automatically (for example the committee table). They are kept when you save, submit or publish.</div>}
    {dr?.reviewNote && <div className="cfg-banner slate"><b>CEO note:</b> {dr.reviewNote}</div>}
    {err && <ErrorNote error={err} />}

    {dr && dr.hasTemplate && <Card>
      <div className="form-row">
        <Field label="Title"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Category"><input value={f.category} placeholder="Conduct, People, Pay…" onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
        <Field label="What changed in this version (optional)"><input value={f.summary} maxLength={500} onChange={(e) => setF({ ...f, summary: e.target.value })} /></Field>
      </div>
      <div className="cfg-editor">
        <div className="cfg-pane">
          <div className="cfg-pane-bar"><b>Policy text</b></div>
          <RichEditor label="Policy text" value={f.template} onChange={(t) => setF((x) => ({ ...x, template: t }))} />
        </div>
        <div className="cfg-pane">
          <div className="cfg-pane-bar"><b>Preview with current values</b></div>
          {preview && <Doc html={preview.html} title="Preview" />}
          {preview && <Missing p={preview} template={f.template} goConfig={goConfig} onReplace={(b, k) => setF((x) => ({ ...x, template: replaceBlank(x.template, b, k) }))} />}
        </div>
      </div>
    </Card>}
    {dr && !dr.hasTemplate && <Card><h2>Uploaded PDF</h2><p className="k">PDF policies are view and acknowledge only; they have no placeholders.</p>{dr.fileId && <button className="btn sm" onClick={() => openAuthed(`/files/${dr.fileId}`, "application/pdf")}>Open PDF</button>}</Card>}

    <Card>
      <div className="cfg-actions">
        {dr ? <>
          {dr.hasTemplate && <button className="btn" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : dirty ? "Save draft" : "Saved"}</button>}
          {dr.status === "draft" && <button className="btn p" disabled={dirty || act.isPending || (dr.hasTemplate && !ready)} title={dirty ? "Save first" : !ready ? "Fill every placeholder first" : ""} onClick={() => act.mutate("submit")}>Submit for CEO approval</button>}
          {d.ceo && (dr.status === "pending_approval" || dr.status === "draft") && <button className="btn p" disabled={dirty || act.isPending} onClick={() => act.mutate("approve")}>Approve</button>}
          {dr.status === "approved" && <button className="btn p" disabled={dirty || act.isPending || (dr.hasTemplate && !ready)} onClick={() => act.mutate("publish")}>Publish version {dr.version}</button>}
          {d.ceo && dr.status === "pending_approval" && <><input className="cfg-note" aria-label="Note to HR" placeholder="Note for HR (needed to send back)" value={note} onChange={(e) => setNote(e.target.value)} /><button className="btn" disabled={!note.trim() || act.isPending} onClick={() => act.mutate("return")}>Send back</button></>}
          <button className="btn cfg-danger" disabled={act.isPending} onClick={() => { if (confirm("Discard this draft?")) act.mutate("discard"); }}>Discard draft</button>
          <span className="k cfg-flow">{dr.status === "draft" ? "Next: submit, then the CEO approves, then publish." : dr.status === "pending_approval" ? `Submitted by ${dr.submittedBy} on ${dt(dr.submittedAt)}. Waiting for the CEO.` : dr.status === "approved" ? `Approved by ${dr.approvedBy} on ${dt(dr.approvedAt)}. Publishing asks everyone to acknowledge again.` : ""}</span>
        </> : <><button className="btn p" disabled={newVersion.isPending} onClick={() => newVersion.mutate()}>Start new version</button><span className="k cfg-flow">Copies the published template into a draft. The published version stays live until the new one is approved and published.</span></>}
      </div>
    </Card>

    {pub && <Card><h2>Published version {pub.version}</h2><p className="k">What employees see and acknowledge, filled in with today's details from Configuration.</p>
      {pub.fileId ? <button className="btn sm" onClick={() => openAuthed(`/policies/${slug}/file`, "application/pdf")}>Open PDF</button> : <Doc html={pub.html} title="Published version" />}</Card>}

    {pub && <Acks slug={slug} />}
    {d.history.filter((v) => !v.fileId).length > 1 && <Compare slug={slug} versions={d.history.filter((v) => !v.fileId).map((v) => v.version)} />}

    <Card><h2>Version history</h2>
      <div className="cfg-table-wrap"><table className="cfg-table">
        <thead><tr><th>Version</th><th>Status</th><th>Created</th><th>Submitted</th><th>Approved</th><th>Published</th><th>Note</th></tr></thead>
        <tbody>{d.history.map((v) => <tr key={v.id}><td>{v.version}</td><td><span className={`cp-tag ${tone(v.status)}`}>{v.statusLabel}</span></td>
          <td>{dt(v.createdAt)}<span className="k cfg-by">{v.createdBy}</span></td><td>{dt(v.submittedAt)}<span className="k cfg-by">{v.submittedBy}</span></td>
          <td>{dt(v.approvedAt)}<span className="k cfg-by">{v.approvedBy}</span></td><td>{dt(v.publishedAt)}<span className="k cfg-by">{v.publishedBy}</span></td><td className="k">{v.summary ?? v.reviewNote ?? ""}</td></tr>)}</tbody>
      </table></div>
      {pub && pub.updates.length > 0 && <ul className="cfg-updates">{pub.updates.map((u) => <li key={u.group}><span className="cp-tag slate">Updated details</span> {u.group} changed on {dt(u.at)}; shown live in version {pub.version}.</li>)}</ul>}</Card>
  </>;
}

function NewPolicy({ starters, onDone }: { starters: ListResp["starters"]; onDone: (slug: string) => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"starter" | "blank" | "pdf">("starter");
  const [f, setF] = useState({ starter: starters[0]?.slug ?? "", title: "", slug: "", category: "" });
  const [file, setFile] = useState<File | null>(null);
  const st = starters.find((s) => s.slug === f.starter);
  const create = useMutation({
    mutationFn: async () => {
      const title = mode === "starter" ? f.title || st!.title : f.title, slug = mode === "starter" ? f.slug || st!.slug : f.slug;
      if (mode === "pdf") return api<{ slug: string }>("/config/policies/pdf", { body: { slug, title, category: f.category || null, name: file!.name, dataBase64: await fileToBase64(file!) } });
      return api<{ slug: string }>("/config/policies", { body: { slug, title, category: f.category || (mode === "starter" ? st!.category : null), ...(mode === "starter" ? { starter: st!.slug } : {}) } });
    },
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["config-policies"] }); onDone(r.slug); },
  });
  const slugOk = (s: string) => /^[a-z0-9][a-z0-9-]{1,78}$/.test(s);
  const valid = mode === "starter" ? !!st && (!f.slug || slugOk(f.slug)) : f.title.trim().length > 1 && slugOk(f.slug) && (mode !== "pdf" || !!file);
  return <Card>
    <h2>New policy</h2>
    <div className="cp-seg" role="group" aria-label="Start from" style={{ margin: "8px 0 4px" }}>{([["starter", "Starter template"], ["blank", "Blank template"], ["pdf", "Upload PDF"]] as const).map(([k, l]) => <button key={k} type="button" className={mode === k ? "on" : ""} aria-pressed={mode === k} onClick={() => setMode(k)}>{l}</button>)}</div>
    <div className="form-row">
      {mode === "starter" && <Field label="Starter template"><select value={f.starter} onChange={(e) => setF({ ...f, starter: e.target.value })}>{starters.map((s) => <option key={s.slug} value={s.slug}>{s.title}</option>)}</select></Field>}
      <Field label={mode === "starter" ? "Title (optional)" : "Title"}><input value={f.title} placeholder={mode === "starter" ? st?.title : ""} onChange={(e) => setF({ ...f, title: e.target.value, slug: f.slug || "" })} /></Field>
      <Field label={mode === "starter" ? "Short name (optional)" : "Short name (lowercase, hyphens)"}><input value={f.slug} placeholder={mode === "starter" ? st?.slug : "code-of-conduct"} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} /></Field>
      <Field label="Category"><input value={f.category} placeholder={mode === "starter" ? st?.category : "People, Conduct, Pay…"} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
      {mode === "pdf" && <Field label="PDF file"><input type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>}
    </div>
    {mode === "starter" && st && <p className="k">{st.summary}.</p>}
    {mode === "pdf" && <p className="k">PDF policies are view and acknowledge only. They go through the same CEO approval before publishing.</p>}
    {create.error && <ErrorNote error={create.error} />}
    <div className="form-actions"><button className="btn p" disabled={!valid || create.isPending} onClick={() => create.mutate()}>{mode === "pdf" ? "Upload as draft" : "Create draft"}</button></div>
  </Card>;
}

export function PoliciesTab({ goConfig }: { goConfig: (tab: string) => void }) {
  const q = useQuery({ queryKey: ["config-policies"], queryFn: () => api<ListResp>("/config/policies") });
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  if (open) return <Editor slug={open} onBack={() => setOpen(null)} goConfig={goConfig} />;
  if (q.error) return <ErrorNote error={q.error} />;
  if (!q.data) return <Card><p className="k">Loading…</p></Card>;
  const rows = q.data.policies;
  const waiting = rows.filter((r) => r.draft?.status === "pending_approval").length;
  return <>
    <div className="cfg-sec-head"><p className="k">Policies are drafted here, approved by the CEO and then published. Employees see and acknowledge the published version only.{waiting ? ` ${waiting} waiting for CEO approval.` : ""}</p>
      <button className="btn p" onClick={() => setAdding(!adding)} aria-expanded={adding}>New policy</button></div>
    {adding && <NewPolicy starters={q.data.starters} onDone={(s) => { setAdding(false); setOpen(s); }} />}
    <div className="cfg-list">
      <div className="cfg-pol-row cfg-list-head" aria-hidden><span>Policy</span><span>Published</span><span>In progress</span><span>Acknowledged</span><span /></div>
      {rows.length === 0 && <div className="cfg-pol-row"><span className="k">No policies yet. Start from the POSH or Leave template.</span></div>}
      {rows.map((r) => { const pct = r.acks && r.acks.total ? Math.round((100 * r.acks.done) / r.acks.total) : 0; return <div key={r.slug} className="cfg-pol-row">
        <span><b>{r.title}</b><span className="k">{r.category ?? "Uncategorised"}{r.kind === "pdf" ? " · PDF" : ""}</span></span>
        <span>{r.version ? <>Version {r.version}<span className="k">{dt(r.publishedAt)}</span></> : <span className="k">Not yet</span>}{r.blanks > 0 ? <span className="cp-tag amber cfg-ood">{r.blanks} blank{r.blanks === 1 ? "" : "s"} not linked</span> : r.missing.length > 0 ? <span className="cp-tag amber cfg-ood" title={`Missing: ${r.missing.map(label).join(", ")}`}>{r.missing.length} detail{r.missing.length === 1 ? "" : "s"} missing</span>
          : r.updatedSince.length > 0 && <span className="cp-tag slate cfg-ood" title={`Updated: ${r.updatedSince.map(label).join(", ")}`}>Details updated, shown live</span>}</span>
        <span>{r.draft ? <span className={`cp-tag ${tone(r.draft.status)}`}>v{r.draft.version}: {r.draft.statusLabel}</span> : <span className="k">None</span>}</span>
        <span>{r.acks ? <span className="cfg-ack"><span className="k">{r.acks.done} of {r.acks.total} ({pct}%)</span><span className={`cp-bar ${pct >= 80 ? "green" : "amber"}`}><i style={{ width: `${pct}%` }} /></span></span> : <span className="k">–</span>}</span>
        <span className="cfg-go"><button className="btn sm" onClick={() => setOpen(r.slug)}>Open</button></span>
      </div>; })}
    </div>
  </>;
}

type Ph = PlaceholderDef & { value: string | { headers: string[]; rows: string[][] } | null; usedBy: string[] };
export function PlaceholdersTab() {
  const q = useQuery({ queryKey: ["config-placeholders"], queryFn: () => api<Ph[]>("/config/placeholders") });
  const groups = useMemo(() => [...new Set((q.data ?? []).map((p) => p.group))], [q.data]);
  if (q.error) return <ErrorNote error={q.error} />;
  if (!q.data) return <Card><p className="k">Loading…</p></Card>;
  const missing = q.data.filter((p) => p.value == null).length;
  return <>
    <p className="k cfg-sec-intro">The fixed list of placeholders policies can use, with today's value and where each is used. {missing ? `${missing} have no value yet.` : "All have values."}</p>
    <div className="cfg-table-wrap"><table className="cfg-table">
      <thead><tr><th>Placeholder</th><th>Current value</th><th>Used by</th><th>Set in</th></tr></thead>
      <tbody>{groups.map((g) => <Fragment key={g}>
        <tr className="cfg-grp"><td colSpan={4}>{g}</td></tr>
        {q.data!.filter((p) => p.group === g).map((p) => <tr key={p.key}>
          <td><b className="cfg-ph-label">{p.label}</b><code className="k">{`{{${p.key}}}`}</code></td>
          <td>{p.value == null ? <span className="cp-tag amber">Not set</span> : typeof p.value === "string" ? p.value : <span className="k">Table, {p.value.rows.length} row{p.value.rows.length === 1 ? "" : "s"}</span>}</td>
          <td>{p.usedBy.length ? p.usedBy.join(", ") : <span className="k">Not used</span>}</td>
          <td className="k">{p.source}</td>
        </tr>)}
      </Fragment>)}</tbody>
    </table></div>
  </>;
}
