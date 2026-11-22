import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { openHtml } from "../lib/openHtml";
import { Card, ErrorNote, Field, Page } from "../lib/ui";
import { DataTable, type Col } from "../lib/DataTable";
import { SEGMENTS, defaultPriority, segmentOf, type Category, type Segment } from "../../../shared/hr/compliance";
import "./compliance.css";

type Facts = { headcount: number; interns: number; states: string[]; officeStates: string[]; extraStates: string[]; entity: "private_limited" | "llp" | "opc"; industry: string; turnoverBand: string; gstRegistered: boolean; dpiit: boolean; foreignInvestment: boolean; msme: boolean; msmeVendors: boolean; incorporatedOn: string | null };
type Item = { key: string; title: string; category: string; law: string; frequency: string; dueText: string; form: string | null; portal: string | null; template: string | null; need: string; why: string; status: string; due: string | null; period: string | null; last: { period: string; status: string; doneOn: string | null; note: string | null; by: string } | null;
  trigger: "headcount" | "interns" | "office" | null; priority: "High" | "Medium" | "Low"; priorityAuto: "High" | "Medium" | "Low"; priorityManual: { by: string; at: string } | null; segment: Segment; configNote?: { text: string; ok: boolean; href: string } | null };
type Resp = { today: string; facts: Facts; items: Item[]; options: { industries: string[]; turnoverBands: Record<string, string>; states: string[] } };
type Hist = { id: string; itemKey: string; title: string; period: string; status: string; doneOn: string | null; note: string | null; by: string; createdAt: string };

const CATEGORIES = ["HR and labour", "Payroll taxes", "Finance and tax", "Corporate (MCA)", "Foreign investment", "Startup and MSME", "Data protection and IT"];
const STATUS_ORDER = ["Overdue", "Due in 30 days", "To do", "Upcoming", "Ongoing", "On event", "Done", "Not applicable"];
const dd = (d: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "");
const ENTITY: Record<Facts["entity"], string> = { private_limited: "Private limited company", llp: "LLP", opc: "One person company" };

function MarkDone({ it, onClose }: { it: Item; onClose: () => void }) {
  const qc = useQueryClient();
  const [doneOn, setDoneOn] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const m = useMutation({ mutationFn: (status: "done" | "na") => api(`/compliance/${it.key}/done`, { body: { period: it.period, status, doneOn, note: note || undefined } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["compliance"] }); onClose(); } });
  return <Card><h2>{it.title}</h2>
    <p className="k">{it.due ? `Due ${dd(it.due)}. ` : ""}{it.dueText}. {it.law}.</p>
    <div className="form-row cp-mark-row"><Field label="Done on"><input type="date" value={doneOn} onChange={(e) => setDoneOn(e.target.value)} /></Field>
      <Field label="Note (acknowledgement or challan number, optional)"><input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></Field></div>
    {m.error && <ErrorNote error={m.error} />}
    <div className="form-actions"><button className="btn p" disabled={m.isPending} onClick={() => m.mutate("done")}>Mark done</button>
      <button className="btn" disabled={m.isPending} onClick={() => m.mutate("na")}>Not needed this time</button>
      <button className="btn" onClick={onClose}>Cancel</button></div></Card>;
}

function Profile({ d }: { d: Resp }) {
  const qc = useQueryClient();
  const [p, setP] = useState(d.facts);
  useEffect(() => setP(d.facts), [d.facts]);
  const save = useMutation({ mutationFn: () => api("/compliance/profile", { method: "PUT", body: { entity: p.entity, industry: p.industry, turnoverBand: p.turnoverBand, gstRegistered: p.gstRegistered, dpiit: p.dpiit, foreignInvestment: p.foreignInvestment, msme: p.msme, msmeVendors: p.msmeVendors, incorporatedOn: p.incorporatedOn || null, extraStates: p.extraStates } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["compliance"] }) });
  const tick = (k: "gstRegistered" | "dpiit" | "foreignInvestment" | "msme" | "msmeVendors", label: string) => <label className="dt-group"><input type="checkbox" checked={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.checked })} /> {label}</label>;
  return <Card><h2>Company profile</h2>
    <p className="k">Headcount, interns and office states come from People and Organisation and update by themselves: <b>{d.facts.headcount} employees</b>, <b>{d.facts.interns} interns</b>, offices in <b>{d.facts.officeStates.join(" and ") || "no state set yet"}</b>. The rest is set here.</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: "0 12px" }}>
      <Field label="Type of entity"><select value={p.entity} onChange={(e) => setP({ ...p, entity: e.target.value as Facts["entity"] })}>{Object.entries(ENTITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Industry"><select value={p.industry} onChange={(e) => setP({ ...p, industry: e.target.value })}>{d.options.industries.map((i) => <option key={i}>{i}</option>)}</select></Field>
      <Field label="Turnover last year"><select value={p.turnoverBand} onChange={(e) => setP({ ...p, turnoverBand: e.target.value })}>{Object.entries(d.options.turnoverBands).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Incorporated on"><input type="date" value={p.incorporatedOn ?? ""} onChange={(e) => setP({ ...p, incorporatedOn: e.target.value || null })} /></Field>
      <Field label="Other states with staff or registrations"><select multiple size={3} value={p.extraStates} onChange={(e) => setP({ ...p, extraStates: [...e.target.selectedOptions].map((o) => o.value) })}>{d.options.states.filter((s) => !d.facts.officeStates.includes(s)).map((s) => <option key={s}>{s}</option>)}</select></Field>
    </div>
    <div className="row-gap" style={{ margin: "8px 0 12px" }}>{tick("gstRegistered", "GST registered")}{tick("dpiit", "DPIIT recognised startup")}{tick("foreignInvestment", "Has foreign investment (FDI)")}{tick("msme", "Registered as MSME (Udyam)")}{tick("msmeVendors", "Buys from MSME suppliers")}</div>
    {save.error && <ErrorNote error={save.error} />}
    <button className="btn p" disabled={save.isPending} onClick={() => save.mutate()}>{save.isSuccess ? "Saved" : "Save profile"}</button></Card>;
}

function History() {
  const q = useQuery({ queryKey: ["compliance", "history"], queryFn: () => api<Hist[]>("/compliance/history") });
  const qc = useQueryClient();
  const undo = useMutation({ mutationFn: (h: Hist) => api(`/compliance/${h.itemKey}/undo`, { body: { period: h.period } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["compliance"] }) });
  if (q.error) return <ErrorNote error={q.error} />;
  const cols: Col<Hist>[] = [
    { key: "title", label: "Item", value: (h) => h.title, filter: true },
    { key: "period", label: "Period", value: (h) => h.period },
    { key: "status", label: "Outcome", value: (h) => (h.status === "done" ? "Done" : "Not needed"), filter: true },
    { key: "doneOn", label: "Done on", value: (h) => h.doneOn, render: (h) => dd(h.doneOn) },
    { key: "note", label: "Note", value: (h) => h.note },
    { key: "by", label: "By", value: (h) => h.by, filter: true },
    { key: "undo", label: "", value: () => null, render: (h) => <button className="btn" onClick={() => undo.mutate(h)}>Undo</button> },
  ];
  return <Card><DataTable rows={q.data ?? []} cols={cols} rowKey={(h) => h.id} file="compliance-history" empty="Nothing marked done yet." initialSort={{ key: "doneOn", dir: -1 }} /></Card>;
}

type Prio = "High" | "Medium" | "Low";
const PRIOS: Prio[] = ["High", "Medium", "Low"];
const ON_TRACK = ["Upcoming", "Ongoing", "On event"];
const STATUS_FILTERS: [string, string][] = [["all", "Any status"], ["Overdue", "Overdue"], ["Due in 30 days", "Due in 30 days"], ["To do", "To set up"], ["track", "On track"], ["Done", "Done"]];
const daysTo = (today: string, d: string) => Math.round((Date.parse(d) - Date.parse(today)) / 86400000);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const countdown = (today: string, i: Item) => {
  if (!i.due) return i.status === "To do" ? "One-time setup" : i.frequency;
  const n = daysTo(today, i.due);
  return n < 0 ? `Overdue by ${plural(-n, "day")}` : n === 0 ? "Due today" : n === 1 ? "Due tomorrow" : `Due in ${plural(n, "day")}`;
};
const isNew = (i: Item) => !!i.trigger && i.status === "To do" && i.need === "Mandatory";
const TRIGGER_LABEL = { headcount: "New at current headcount", interns: "New with interns on rolls", office: "New for an office state" } as const;
const statusLabel = (s: string) => (s === "To do" ? "To set up" : s === "Due in 30 days" ? "Due soon" : s);
const statusTone = (s: string) => (s === "Overdue" ? "red" : s === "Due in 30 days" || s === "To do" ? "amber" : s === "Done" ? "green" : "slate");

/** Priority pill: shows the current priority and opens a small menu to change it or go back to the computed one. */
function PriorityPick({ it }: { it: Item }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const m = useMutation({ mutationFn: (priority: Prio | null) => api(`/compliance/${it.key}/priority`, { method: "PUT", body: { priority } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["compliance"] }) });
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [open]);
  const pick = (p: Prio | null) => { setOpen(false); m.mutate(p); };
  const manual = !!it.priorityManual;
  return <span className="cp-pp" ref={box}>
    <button type="button" className={`cp-prio cp-${it.priority.toLowerCase()}`} aria-haspopup="menu" aria-expanded={open} disabled={m.isPending}
      title={manual ? `Set manually by ${it.priorityManual!.by}. Automatic would be ${it.priorityAuto}.` : "Automatic, from requirement and due date. Click to change."}
      onClick={() => setOpen(!open)}><i className="cp-dotc" aria-hidden />{it.priority}{manual && <span className="cp-pin">Manual</span>}<svg width="8" height="5" viewBox="0 0 8 5" aria-hidden><path d="M1 1l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg></button>
    {open && <span className="cp-menu" role="menu">
      {PRIOS.map((p) => <button key={p} type="button" role="menuitemradio" aria-checked={it.priority === p} className={`cp-${p.toLowerCase()}${it.priority === p ? " on" : ""}`} onClick={() => pick(p)}><i className="cp-dotc" aria-hidden />{p}{p === it.priorityAuto && <span className="k">Automatic</span>}</button>)}
      {manual && <button type="button" role="menuitem" className="cp-reset" onClick={() => pick(null)}>Reset to automatic ({it.priorityAuto})</button>}
    </span>}
  </span>;
}

function Actions({ it, onMark, primaryOnly }: { it: Item; onMark: (i: Item) => void; primaryOnly?: boolean }) {
  const canMark = !!it.period && it.status !== "Done" && it.status !== "Not applicable";
  const tpl = it.template && <button className="btn sm" onClick={() => openHtml(`/compliance/templates/${it.template}`)}>Template</button>;
  const portal = it.portal && <a className="btn sm" href={it.portal} target="_blank" rel="noreferrer">Open portal</a>;
  if (primaryOnly) return canMark ? <button className="btn sm p" onClick={() => onMark(it)}>Mark done</button> : tpl || portal || null;
  return <div className="form-actions" style={{ marginTop: 8 }}>{canMark && <button className="btn sm p" onClick={() => onMark(it)}>Mark done</button>}{tpl}{portal}</div>;
}

function AttentionCard({ it, today, onMark }: { it: Item; today: string; onMark: (i: Item) => void }) {
  const late = it.status === "Overdue";
  return <div className={`cp-att ${late ? "late" : ""}`}>
    <div className="cp-att-top"><span className={`cp-tag ${late ? "red" : isNew(it) ? "slate" : "amber"}`}>{late ? "Overdue" : isNew(it) ? TRIGGER_LABEL[it.trigger!] : "Due soon"}</span><PriorityPick it={it} /></div>
    <div className="cp-att-title">{it.title}</div>
    <div className="cp-why">{it.why}</div>
    {it.configNote && <a className={`cp-config ${it.configNote.ok ? "ok" : ""}`} href={it.configNote.href}>{it.configNote.text}</a>}
    <div className="cp-att-foot"><span className={`cp-count ${late ? "late" : ""}`}>{countdown(today, it)}{it.due && <span className="k"> · {dd(it.due)}</span>}</span><Actions it={it} onMark={onMark} primaryOnly /></div>
  </div>;
}

function Row({ it, today, onMark }: { it: Item; today: string; onMark: (i: Item) => void }) {
  const [open, setOpen] = useState(false);
  return <div className={`cp-row${open ? " open" : ""}`}>
    <div className="cp-row-main">
      <PriorityPick it={it} />
      <button type="button" className="cp-row-title" aria-expanded={open} onClick={() => setOpen(!open)}><span className="cp-t">{it.title}</span><span className="k">{it.category} · {it.need}</span></button>
      <span className={`cp-tag ${statusTone(it.status)}`}>{statusLabel(it.status)}</span>
      <span className={`cp-row-due${it.status === "Overdue" ? " late" : ""}`}>{it.due ? dd(it.due) : <span className="k">{it.frequency}</span>}</span>
      <button type="button" className="cp-more" aria-expanded={open} aria-label={open ? "Hide details" : "Show details"} onClick={() => setOpen(!open)}><svg width="10" height="6" viewBox="0 0 10 6" aria-hidden><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg></button>
    </div>
    {open && <div className="cp-detail">
      <dl>
        <dt>Why it applies</dt><dd>{it.why}</dd>
        <dt>When</dt><dd>{it.dueText} ({it.frequency.toLowerCase()}){it.due ? ` · ${countdown(today, it)}` : ""}</dd>
        <dt>Law</dt><dd>{it.law}{it.form ? ` · Form ${it.form}` : ""}</dd>
        {it.last && <><dt>Last recorded</dt><dd>{it.last.status === "done" ? "Done" : "Not needed"} {dd(it.last.doneOn)}{it.last.note ? ` · ${it.last.note}` : ""}</dd></>}
        {it.configNote && <><dt>Set up in</dt><dd><a className="cp-link" href={it.configNote.href}>{it.configNote.text}</a></dd></>}
        {it.priorityManual && <><dt>Priority</dt><dd>Set to {it.priority} by {it.priorityManual.by}; automatic would be {it.priorityAuto}</dd></>}
      </dl>
      <Actions it={it} onMark={onMark} />
    </div>}
  </div>;
}

function Group({ title, items, today, onMark, open, onToggle, hint }: { title: string; items: Item[]; today: string; onMark: (i: Item) => void; open: boolean; onToggle: () => void; hint?: string }) {
  const late = items.filter((i) => i.status === "Overdue").length, soon = items.filter((i) => i.status === "Due in 30 days").length;
  return <section className="cp-group">
    <button type="button" className="cp-group-head" aria-expanded={open} onClick={onToggle}>
      <svg className="cp-caret" width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M3 1.5L6.5 5 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
      <span className="cp-gt">{title}</span><span className="cp-n">{items.length}</span>
      {late > 0 && <span className="cp-tag red">{late} overdue</span>}{soon > 0 && <span className="cp-tag amber">{soon} due soon</span>}
      {hint && <span className="k cp-hint">{hint}</span>}
    </button>
    {open && <div className="cp-rows">
      <div className="cp-row-main cp-thead" aria-hidden><span>Priority</span><span>Item</span><span>Status</span><span className="r">Due</span><span /></div>
      {items.map((i) => <Row key={i.key} it={i} today={today} onMark={onMark} />)}</div>}
  </section>;
}

type SegStats = { all: Item[]; overdue: number; soon: number; setup: number; track: number; high: number; score: number; next: Item | null };
/** Health per segment: the share of applicable items that are neither overdue nor a mandatory setup still pending. */
function segStats(items: Item[]): SegStats {
  const all = items.filter((i) => i.need !== "Not applicable");
  const c = (f: (i: Item) => boolean) => all.filter(f).length;
  const overdue = c((i) => i.status === "Overdue"), setup = c((i) => i.status === "To do"), setupMust = c((i) => i.status === "To do" && i.need === "Mandatory");
  const late = all.filter((i) => i.status === "Overdue").sort((a, b) => (a.due ?? "").localeCompare(b.due ?? ""));
  const upcoming = all.filter((i) => i.due && i.status !== "Overdue" && i.status !== "Done").sort((a, b) => a.due!.localeCompare(b.due!));
  return { all, overdue, setup, soon: c((i) => i.status === "Due in 30 days"), track: c((i) => ON_TRACK.includes(i.status) || i.status === "Done"),
    high: c((i) => i.priority === "High" && i.status !== "Done"), score: all.length ? Math.round((100 * (all.length - overdue - setupMust)) / all.length) : 100, next: late[0] ?? upcoming[0] ?? null };
}
const scoreTone = (n: number) => (n >= 80 ? "green" : n >= 50 ? "amber" : "red");
function Health({ score }: { score: number }) {
  return <span className="cp-health"><span className="cp-health-top"><span className="k">Health</span><b>{score}%</b></span>
    <span className={`cp-bar ${scoreTone(score)}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={score} aria-label="Health"><i style={{ width: `${score}%` }} /></span></span>;
}
function SegmentTile({ seg, st, today, onOpen }: { seg: (typeof SEGMENTS)[number]; st: SegStats; today: string; onOpen: () => void }) {
  return <button type="button" className="cp-seg-tile" onClick={onOpen} aria-label={`Open ${seg.name}`}>
    <span className="cp-seg-top"><span className="cp-seg-name">{seg.name}</span><span className="k">{st.all.length} items</span></span>
    <span className="k cp-seg-blurb">{seg.blurb}</span>
    <Health score={st.score} />
    <span className="cp-seg-counts">
      <span><b className={st.overdue ? "red" : ""}>{st.overdue}</b>Overdue</span><span><b className={st.soon ? "amber" : ""}>{st.soon}</b>Due soon</span>
      <span><b>{st.setup}</b>To set up</span><span><b>{st.track}</b>On track</span>
    </span>
    <span className="cp-seg-next">{st.next ? <><span className="k">Next</span><span className="cp-seg-next-t">{st.next.title}</span><span className={`k ${st.next.status === "Overdue" ? "cp-late" : ""}`}>{countdown(today, st.next)}</span></> : <span className="k">No dated items coming up</span>}</span>
    <span className="cp-seg-foot"><span className="k">{st.high ? `${st.high} high priority open` : "No high-priority items"}</span><span className="cp-link">View</span></span>
  </button>;
}

const ATTENTION_MAX = 6;
export default function Compliance() {
  const q = useQuery({ queryKey: ["compliance"], queryFn: () => api<Resp>("/compliance") });
  const [tab, setTab] = useState("items");
  const [mark, setMark] = useState<Item | null>(null);
  const [search, setSearch] = useState("");
  const [prio, setPrio] = useState<"all" | Prio>("all");
  const [status, setStatus] = useState("all");
  const [cat, setCat] = useState("all");
  const [needF, setNeedF] = useState("all");
  const [showNa, setShowNa] = useState(false);
  const [groupBy, setGroupBy] = useState<"priority" | "category">("priority");
  const [openGroups, setOpenGroups] = useState<string[]>([]);
  const [seg, setSeg] = useState<Segment | null>(null);
  const markRef = useRef<HTMLDivElement>(null);
  const onMark = (i: Item) => { setMark(i); setTimeout(() => markRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 0); };
  if (q.error) return <Page title="Compliance"><ErrorNote error={q.error} /></Page>;
  if (!q.data) return <Page title="Compliance"><Card><p>Loading…</p></Card></Page>;
  const today = q.data.today;
  // A server that predates priorities sends none; fall back to the computed default so the page still works.
  const d = { ...q.data, items: q.data.items.map((i) => ({ ...(i.priority ? i : { ...i, trigger: i.trigger ?? null, priorityManual: null, priority: defaultPriority(i, today), priorityAuto: defaultPriority(i, today) }), segment: i.segment ?? segmentOf({ key: i.key, category: i.category as Category }) })) };
  const everything = d.items;
  const stats = Object.fromEntries(SEGMENTS.map((s) => [s.key, segStats(everything.filter((i) => i.segment === s.key))])) as Record<Segment, SegStats>;
  const segInfo = seg ? SEGMENTS.find((s) => s.key === seg)! : null;
  const scope = seg ? everything.filter((i) => i.segment === seg) : everything;
  const openSeg = (k: Segment | null) => { setSeg(k); setOpenGroups([]); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const byUrgency = (a: Item, b: Item) => PRIOS.indexOf(a.priority) - PRIOS.indexOf(b.priority) || STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || (a.due ?? "9").localeCompare(b.due ?? "9");
  const applies = scope.filter((i) => i.need !== "Not applicable").sort(byUrgency);
  const open = applies.filter((i) => i.status !== "Done");
  const count = (f: (i: Item) => boolean) => applies.filter(f).length;
  const overdue = count((i) => i.status === "Overdue"), dueSoon = count((i) => i.status === "Due in 30 days"), setup = count((i) => i.status === "To do"), track = count((i) => ON_TRACK.includes(i.status) || i.status === "Done");
  // Needs attention: open high-priority items, overdue first, then the nearest due date, then thresholds just crossed.
  const rank = (i: Item) => (i.status === "Overdue" ? 0 : i.due ? 1 : 2);
  const hot = open.filter((i) => i.priority === "High").sort((a, b) => rank(a) - rank(b) || (a.due ?? "9").localeCompare(b.due ?? "9"));
  const attention = hot.slice(0, ATTENTION_MAX);
  const shownKeys = new Set(attention.map((i) => i.key));

  const term = search.trim().toLowerCase();
  const filtering = !!term || prio !== "all" || status !== "all" || cat !== "all" || needF !== "all" || showNa;
  const pool = (showNa ? [...applies, ...scope.filter((i) => i.need === "Not applicable")] : applies).filter((i) => filtering || !shownKeys.has(i.key));
  const list = pool.filter((i) => (!term || `${i.title} ${i.why} ${i.law} ${i.form ?? ""} ${i.category}`.toLowerCase().includes(term))
    && (prio === "all" || i.priority === prio)
    && (status === "all" || (status === "track" ? ON_TRACK.includes(i.status) : i.status === status))
    && (cat === "all" || i.category === cat)
    && (needF === "all" || i.need === needF));
  const groups: [string, string, Item[]][] = groupBy === "priority"
    ? [...PRIOS.map((p) => [p, `${p} priority`, list.filter((i) => i.priority === p && i.need !== "Not applicable")] as [string, string, Item[]]), ["na", "Does not apply", list.filter((i) => i.need === "Not applicable")] as [string, string, Item[]]]
    : CATEGORIES.map((c) => [c, c, list.filter((i) => i.category === c)] as [string, string, Item[]]);
  const segBar = <div className="cp-segbar" role="tablist" aria-label="Segment">
    <button type="button" role="tab" aria-selected={!seg} className={!seg ? "on" : ""} onClick={() => openSeg(null)}>All</button>
    {SEGMENTS.map((s) => <button key={s.key} type="button" role="tab" aria-selected={seg === s.key} className={seg === s.key ? "on" : ""} onClick={() => openSeg(s.key)}>{s.name}{stats[s.key].overdue ? <span className="cp-dot" aria-label={`${stats[s.key].overdue} overdue`}>{stats[s.key].overdue}</span> : null}</button>)}
  </div>;
  const isOpen = (k: string) => filtering || openGroups.includes(k);
  const toggle = (k: string) => setOpenGroups(openGroups.includes(k) ? openGroups.filter((x) => x !== k) : [...openGroups, k]);
  const clear = () => { setSearch(""); setPrio("all"); setStatus("all"); setCat("all"); setNeedF("all"); setShowNa(false); };
  const jump = (s: string) => { clear(); setStatus(s); document.getElementById("cp-all")?.scrollIntoView({ behavior: "smooth" }); };

  return <Page title="Compliance">
    <div className="tabs cp-tabs" role="tablist">{[["items", "What to do"], ["profile", "Company profile"], ["history", "Done so far"]].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
    {tab === "items" && <div className="cp">
      {segBar}
      {!seg && <section className="cp-dash" aria-label="Segments">
        <div className="cp-seg-grid">{SEGMENTS.filter((s) => stats[s.key].all.length).map((s) => <SegmentTile key={s.key} seg={s} st={stats[s.key]} today={today} onOpen={() => openSeg(s.key)} />)}</div>
      </section>}
      {segInfo && <section className="cp-seg-head">
        <button type="button" className="cp-link" onClick={() => openSeg(null)}>← All segments</button>
        <div className="cp-seg-hero"><div><h2>{segInfo.name}</h2><p className="k">{segInfo.blurb} · {stats[segInfo.key].all.length} items apply</p></div><Health score={stats[segInfo.key].score} /></div>
      </section>}
      <div className="cp-strip" aria-label="Summary">
        <button type="button" className="cp-stat" onClick={() => jump("Overdue")}><b className={overdue ? "red" : ""}>{overdue}</b><span>Overdue</span></button>
        <button type="button" className="cp-stat" onClick={() => jump("Due in 30 days")}><b className={dueSoon ? "amber" : ""}>{dueSoon}</b><span>Due in 30 days</span></button>
        <button type="button" className="cp-stat" onClick={() => jump("To do")}><b>{setup}</b><span>To set up</span></button>
        <button type="button" className="cp-stat" onClick={() => jump("track")}><b>{track}</b><span>On track</span><span className="cp-bar green"><i style={{ width: `${applies.length ? Math.round((100 * track) / applies.length) : 0}%` }} /></span></button>
      </div>
      {!seg && <p className="k cp-team">Based on {d.facts.headcount} employees, {d.facts.interns} interns and {d.facts.officeStates.length || "no"} office state{d.facts.officeStates.length === 1 ? "" : "s"}.</p>}

      {mark && <div ref={markRef}><MarkDone it={mark} onClose={() => setMark(null)} /></div>}

      <section className="cp-attn">
        <div className="cp-sec-head"><h2>Needs attention{segInfo ? ` in ${segInfo.name}` : ""}</h2>{hot.length > attention.length && <button type="button" className="cp-link" onClick={() => { clear(); setPrio("High"); document.getElementById("cp-all")?.scrollIntoView({ behavior: "smooth" }); }}>View all {hot.length} high priority</button>}</div>
        {attention.length ? <div className="cp-att-grid">{attention.map((i) => <AttentionCard key={i.key} it={i} today={today} onMark={onMark} />)}</div>
          : <div className="cp-zen">Nothing needs attention. All high-priority items are done or not yet due.</div>}
      </section>

      <section className="cp-all" id="cp-all">
        <div className="cp-sec-head"><h2>{segInfo ? `All ${segInfo.name} items` : "All items"}</h2>
          <div className="cp-seg" role="group" aria-label="Group by">{([["priority", "By priority"], ["category", "By area"]] as const).map(([k, l]) => <button key={k} type="button" className={groupBy === k ? "on" : ""} aria-pressed={groupBy === k} onClick={() => setGroupBy(k)}>{l}</button>)}</div>
        </div>
        <div className="cp-filters">
          <input className="cp-search" type="search" placeholder="Search by name, law or form" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search compliance items" />
          <div className="cp-chips" role="group" aria-label="Priority">{(["all", ...PRIOS] as const).map((p) => <button key={p} type="button" className={prio === p ? "on" : ""} aria-pressed={prio === p} onClick={() => setPrio(p)}>{p === "all" ? "All priorities" : p}</button>)}</div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">{STATUS_FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Area"><option value="all">All areas</option>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          <select value={needF} onChange={(e) => setNeedF(e.target.value)} aria-label="Requirement"><option value="all">Mandatory and optional</option><option>Mandatory</option><option>Optional</option></select>
          <label className="cp-check"><input type="checkbox" checked={showNa} onChange={(e) => setShowNa(e.target.checked)} /> Show what does not apply</label>
          {filtering && <button type="button" className="cp-link" onClick={clear}>Clear filters</button>}
        </div>
        {filtering && <p className="k">{list.length} match{list.length === 1 ? "" : "es"}{list.length ? "" : ". Try a different search."}</p>}
        {groups.filter(([, , g]) => g.length).map(([k, t, g]) => <Group key={k} title={t} items={g} today={today} onMark={onMark} open={isOpen(k)} onToggle={() => toggle(k)}
          hint={groupBy === "priority" && k === "Low" ? "Optional or done" : undefined} />)}
      </section>

      <details className="cp-how"><summary>How is this worked out?</summary>
        <p className="k">From your headcount ({d.facts.headcount} employees, {d.facts.interns} interns), office states ({d.facts.states.join(", ") || "none set"}) and the company profile. Due dates are the standard statutory ones; government extensions are not tracked.</p>
        <p className="k">Priority is automatic unless you change it: mandatory items that are overdue, due within 14 days, or just switched on by a headcount, intern or office threshold are <b>High</b>; other mandatory items are <b>Medium</b>; optional and done items are <b>Low</b>. "Manual" means someone set it by hand; open the priority to reset it.</p>
      </details>
    </div>}
    {tab === "profile" && <div className="cp"><Profile d={d} /></div>}
    {tab === "history" && <div className="cp"><History /></div>}
  </Page>;
}
