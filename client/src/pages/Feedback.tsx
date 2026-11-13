import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Card, Chip, ErrorNote, Field, Page } from "../lib/ui";

type Me = { email: string; employeeId: string | null; roles: string[] };
type Question = { id: string; type: "rating" | "text"; text: string };
type Current = { cycle: null | { id: string; title: string; questions: Question[] }; participated?: boolean };
type Cycle = { id: string; title: string; status: string; questions: Question[]; createdAt: string };
type Results = { hidden: true; minResponses: number } | { hidden: false; cycle: { id: string; title: string; status: string }; responses: number; participationPct: number | null;
  questions: { id: string; text: string; type: string; count: number; average?: number | null; distribution?: number[]; comments?: string[] }[] };
type Suggestion = { id: string; body: string; status: string; reply: string | null; createdDay: string };

function Esat() {
  const qc = useQueryClient();
  const cur = useQuery({ queryKey: ["esatCurrent"], queryFn: () => api<Current>("/esat/current") });
  const [a, setA] = useState<Record<string, string | number>>({});
  const send = useMutation({
    mutationFn: () => api("/esat/responses", { body: { cycleId: cur.data!.cycle!.id, answers: Object.fromEntries(Object.entries(a).filter(([, v]) => v !== "")) } }),
    onSuccess: () => { setA({}); qc.invalidateQueries({ queryKey: ["esatCurrent"] }); },
  });
  const c = cur.data?.cycle;
  return (
    <Card><h2>Employee satisfaction survey</h2><ErrorNote error={cur.error} />
      {cur.isLoading ? <p>Loading…</p> : !c ? <p>There is no open survey right now.</p> : cur.data!.participated || send.isSuccess ? <p><Chip tone="ok">Thank you</Chip> You have taken part in "{c.title}".</p> : (
        <form onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
          <p className="k">{c.title}. Your answers are anonymous. Nothing links them to you, and results show only when enough people have answered.</p>
          {c.questions.map((q) => q.type === "rating" ? (
            <fieldset key={q.id} style={{ border: 0, padding: 0, margin: "16px 0 0" }}><legend>{q.text}</legend>
              <div className="row-gap">{[1, 2, 3, 4, 5].map((n) => <label key={n} style={{ display: "flex", gap: 6, alignItems: "center", minHeight: 44, padding: "0 10px", border: "1px solid #c9cfe0", borderRadius: 8 }}>
                <input type="radio" name={q.id} checked={a[q.id] === n} onChange={() => setA({ ...a, [q.id]: n })} />{n}</label>)}</div>
              <span className="k">1 is lowest, 5 is highest</span></fieldset>
          ) : <Field key={q.id} label={q.text}><textarea rows={3} maxLength={2000} value={String(a[q.id] ?? "")} onChange={(e) => setA({ ...a, [q.id]: e.target.value })} /></Field>)}
          <ErrorNote error={send.error} />
          <p><button className="btn p" disabled={send.isPending || !Object.values(a).some((v) => v !== "")}>Submit answers</button></p>
        </form>)}
    </Card>
  );
}

function Suggest() {
  const [body, setBody] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [look, setLook] = useState("");
  const send = useMutation({ mutationFn: () => api<{ replyCode: string }>("/suggestions", { body: { body, anonymous: true } }), onSuccess: (r) => { setCode(r.replyCode); setBody(""); setCopied(false); } });
  const lookup = useMutation({ mutationFn: () => api<{ status: string; reply: string | null; createdDay: string }>("/suggestions/lookup", { body: { replyCode: look } }) });
  return (
    <>
      <Card><h2>Suggestion box</h2>
        <p className="k">Anonymous. We do not store who sent it. You get a reply code to check for a reply later.</p>
        <form onSubmit={(e) => { e.preventDefault(); send.mutate(); }}>
          <Field label="Your suggestion"><textarea required minLength={3} maxLength={5000} rows={5} value={body} onChange={(e) => setBody(e.target.value)} /></Field>
          <ErrorNote error={send.error} />
          <p><button className="btn p" disabled={send.isPending}>Send anonymously</button></p>
        </form>
        {code && <div className="note ok" role="status"><strong>Your reply code</strong>
          <p style={{ margin: "6px 0" }}>Save this now. It is shown once and is the only way to see a reply.</p>
          <div className="row-gap"><code style={{ fontSize: 20, letterSpacing: 1 }}>{code}</code>
            <button className="btn p" onClick={async () => { try { await navigator.clipboard.writeText(code); setCopied(true); } catch { setCopied(false); } }}>{copied ? "Copied" : "Copy code"}</button>
            <button className="btn" onClick={() => setCode(null)}>I have saved it</button></div></div>}
      </Card>
      <Card><h2>Check for a reply</h2>
        <form onSubmit={(e) => { e.preventDefault(); lookup.mutate(); }}>
          <Field label="Reply code"><input required value={look} onChange={(e) => setLook(e.target.value)} placeholder="ABCD-EFGH-JKLM" autoComplete="off" /></Field>
          <ErrorNote error={lookup.error} />
          <p><button className="btn" disabled={lookup.isPending}>Look up</button></p>
        </form>
        {lookup.data && <div className="note info" role="status">Sent {lookup.data.createdDay} · <Chip>{lookup.data.status.replace(/_/g, " ")}</Chip><p style={{ margin: "6px 0 0" }}>{lookup.data.reply ?? "No reply yet."}</p></div>}
      </Card>
    </>
  );
}

function Cycles() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["esatCycles"], queryFn: () => api<Cycle[]>("/esat/cycles") });
  const [title, setTitle] = useState("");
  const [qs, setQs] = useState<{ type: "rating" | "text"; text: string }[]>([{ type: "rating", text: "" }]);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["esatCycles"] }); qc.invalidateQueries({ queryKey: ["esatResults"] }); qc.invalidateQueries({ queryKey: ["esatCurrent"] }); };
  const create = useMutation({ mutationFn: () => api("/esat/cycles", { body: { title, questions: qs.map((q, i) => ({ id: `q${i + 1}`, ...q })) } }), onSuccess: () => { setTitle(""); setQs([{ type: "rating", text: "" }]); refresh(); } });
  const close = useMutation({ mutationFn: (id: string) => api(`/esat/cycles/${id}/close`, { method: "POST", body: {} }), onSuccess: refresh });
  return (
    <>
      <Card><h2>Start a survey</h2>
        <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Field label="Title"><input required minLength={3} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          {qs.map((q, i) => <div key={i} className="row-gap" style={{ alignItems: "end" }}>
            <div style={{ flex: "1 1 260px" }}><Field label={`Question ${i + 1}`}><input required minLength={3} maxLength={300} value={q.text} onChange={(e) => setQs(qs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} /></Field></div>
            <Field label="Type"><select value={q.type} onChange={(e) => setQs(qs.map((x, j) => (j === i ? { ...x, type: e.target.value as "rating" | "text" } : x)))}><option value="rating">Rating 1 to 5</option><option value="text">Comment</option></select></Field>
            {qs.length > 1 && <button type="button" className="btn" onClick={() => setQs(qs.filter((_, j) => j !== i))}>Remove</button>}</div>)}
          <p className="row-gap"><button type="button" className="btn" disabled={qs.length >= 30} onClick={() => setQs([...qs, { type: "rating", text: "" }])}>Add question</button></p>
          <ErrorNote error={create.error} />
          <p><button className="btn p" disabled={create.isPending}>Open survey</button> <span className="k">Only one survey can be open at a time.</span></p>
        </form></Card>
      <Card><h2>Surveys</h2><ErrorNote error={close.error} />
        <div style={{ overflowX: "auto" }}><table className="t"><thead><tr><th>Title</th><th>Questions</th><th>Status</th><th></th></tr></thead><tbody>
          {(list.data ?? []).map((c) => <tr key={c.id}><td>{c.title}<br /><span className="k">{c.createdAt.slice(0, 10)}</span></td><td>{c.questions.length}</td><td><Chip tone={c.status === "open" ? "ok" : "mute"}>{c.status}</Chip></td>
            <td>{c.status === "open" && <button className="btn" onClick={() => window.confirm("Close this survey?") && close.mutate(c.id)}>Close</button>}</td></tr>)}
        </tbody></table></div></Card>
    </>
  );
}

function ResultsView() {
  const cycles = useQuery({ queryKey: ["esatCycles"], queryFn: () => api<Cycle[]>("/esat/cycles") });
  const [id, setId] = useState("");
  const res = useQuery({ queryKey: ["esatResults", id], queryFn: () => api<Results>(`/esat/results${id ? "?cycleId=" + id : ""}`), retry: false });
  const r = res.data;
  return (
    <Card><div className="row-gap" style={{ alignItems: "end", justifyContent: "space-between" }}><h2>Results</h2>
      <Field label="Survey"><select value={id} onChange={(e) => setId(e.target.value)}><option value="">Latest</option>{(cycles.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></Field></div>
      <ErrorNote error={res.error} />
      {r?.hidden && <div className="note warn">Hidden until {r.minResponses} responses. This protects anonymity.</div>}
      {r && !r.hidden && <>
        <p>{r.cycle.title} <Chip tone={r.cycle.status === "open" ? "ok" : "mute"}>{r.cycle.status}</Chip> · {r.responses} responses{r.participationPct != null ? ` · ${r.participationPct}% participation` : ""}</p>
        {r.questions.map((q) => <div key={q.id} style={{ borderTop: "1px solid #eceef4", padding: "10px 0" }}><strong>{q.text}</strong>
          {q.type === "rating" ? <div>Average {q.average ?? "-"} of 5 · {q.count} answers
            <div role="img" aria-label={`Distribution of ratings 1 to 5: ${(q.distribution ?? []).join(", ")}`} style={{ display: "flex", gap: 6, alignItems: "end", height: 60, marginTop: 6 }}>
              {(q.distribution ?? []).map((n, i) => <div key={i} style={{ flex: 1, textAlign: "center", fontSize: 12 }}><div style={{ background: "#2f4bd6", height: Math.max(2, (n / Math.max(1, ...(q.distribution ?? []))) * 40), borderRadius: 3 }} />{i + 1}</div>)}</div></div>
            : q.comments?.length ? <ul>{q.comments.map((c, i) => <li key={i}>{c}</li>)}</ul> : <p className="k">Comments show when at least 5 people have written one.</p>}</div>)}</>}
    </Card>
  );
}

function Suggestions() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["suggestions"], queryFn: () => api<Suggestion[]>("/suggestions") });
  const [t, setT] = useState<Record<string, string>>({});
  const reply = useMutation({ mutationFn: (id: string) => api(`/suggestions/${id}/reply`, { body: { reply: t[id], status: "replied" } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["suggestions"] }) });
  return (
    <Card><h2>Suggestions</h2><ErrorNote error={list.error || reply.error} />
      {list.data && !list.data.length && <p>No suggestions yet.</p>}
      {(list.data ?? []).map((s) => <div key={s.id} style={{ borderTop: "1px solid #eceef4", padding: "12px 0" }}>
        <p className="k" style={{ margin: 0 }}>{s.createdDay} · <Chip tone={s.status === "replied" ? "ok" : "warn"}>{s.status.replace(/_/g, " ")}</Chip></p>
        <p style={{ whiteSpace: "pre-wrap" }}>{s.body}</p>
        {s.reply && <p className="note info">Reply: {s.reply}</p>}
        <Field label={s.reply ? "Update reply" : "Reply"}><textarea rows={2} maxLength={3000} value={t[s.id] ?? ""} onChange={(e) => setT({ ...t, [s.id]: e.target.value })} /></Field>
        <p><button className="btn" disabled={reply.isPending || !(t[s.id] ?? "").trim()} onClick={() => reply.mutate(s.id)}>Send reply</button></p></div>)}
    </Card>
  );
}

export default function Feedback() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  const hr = (me.data?.roles ?? []).includes("hr_admin");
  const tabs = [{ k: "survey", l: "Survey" }, { k: "box", l: "Suggestion box" }, ...(hr ? [{ k: "cycles", l: "Cycles" }, { k: "results", l: "Results" }, { k: "inbox", l: "Suggestions inbox" }] : [])];
  const [tab, setTab] = useState("survey");
  return (
    <Page title="Feedback">
      <div className="tabs" role="tablist">{tabs.map((t) => <button key={t.k} role="tab" aria-selected={tab === t.k} className={tab === t.k ? "on" : ""} onClick={() => setTab(t.k)}>{t.l}</button>)}</div>
      {tab === "survey" && <Esat />}{tab === "box" && <Suggest />}{tab === "cycles" && <Cycles />}{tab === "results" && <ResultsView />}{tab === "inbox" && <Suggestions />}
    </Page>
  );
}
