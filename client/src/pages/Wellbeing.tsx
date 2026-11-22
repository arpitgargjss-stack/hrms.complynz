import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { ErrorNote } from "../lib/ui";
import { celebrate } from "../lib/gz";
import { WELLBEING_INDEXES, CARE_WHEN, isLowAnswer, type WellbeingKey } from "@shared/hr/buzz";
import "../gz.css";
import "./wellbeing.css";

type Pulse = { week: string; answered: boolean; team: { count: number; needed?: number; indexes?: Record<WellbeingKey, number | null> } };
const word = (key: WellbeingKey, index: number) => WELLBEING_INDEXES.find((x) => x.key === key)!.scale[Math.max(0, Math.min(4, Math.round(index / 25)))];

/** "How are you feeling today?": Stressometer, Happy Index and Motivation Index. Anonymous; a low answer offers support. */
export function PulseCard() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["pulse"], queryFn: () => api<Pulse>("/pulse") });
  const [a, setA] = useState<Partial<Record<WellbeingKey, number>>>({});
  const [support, setSupport] = useState<"low" | "asked" | null>(null);
  const answer = useMutation({
    mutationFn: () => api<Pulse>("/pulse", { body: a }),
    onSuccess: (d) => {
      qc.setQueryData(["pulse"], d);
      // Worked out here from your own taps. The server never learns that you answered low.
      const low = WELLBEING_INDEXES.some((x) => isLowAnswer(a[x.key]));
      setA({});
      if (low) setSupport("low"); else celebrate("Thank you for telling us", "Your answers are anonymous");
    },
  });
  const p = q.data;
  const all = WELLBEING_INDEXES.every((x) => a[x.key]);
  const picked = WELLBEING_INDEXES.filter((x) => a[x.key]).length;
  return (
    <section id="pulse" className="gz-card gz-pop wb">
      <div className="wb-head"><span className="wb-tag">✨ Weekly vibe check · 100% anonymous</span><h3>How are you feeling today?</h3></div>
      {p && !p.answered && <>
        {WELLBEING_INDEXES.map((x) => { const v = a[x.key];
          return <div key={x.key} className={`wb-q${v ? " done" : ""}`} role="radiogroup" aria-label={`${x.name}: ${x.q}`}>
            <div className="wb-qh"><b><span aria-hidden="true">{x.icon}</span><span>{x.name}<small>{x.q}</small></span></b>{v && <span className="wb-pick" key={v}>{x.scale[v - 1]}</span>}</div>
            <div className={`wb-row${v ? " has" : ""}`}>{x.scale.map((m, i) => { const on = v === i + 1;
              return <button key={m} role="radio" aria-checked={on} aria-label={m} title={m} className={`wb-e${on ? " on" : ""}`} disabled={answer.isPending} onClick={() => setA({ ...a, [x.key]: i + 1 })}>{x.emoji[i]}</button>; })}</div>
          </div>; })}
        <div className="wb-dots" aria-hidden="true">{WELLBEING_INDEXES.map((x) => <i key={x.key} className={a[x.key] ? "on" : ""} />)}</div>
        <button className="wb-send" disabled={!all || answer.isPending} onClick={() => answer.mutate()}>{all ? "Send it, anonymously 🚀" : `${picked} of 3 done. Tap an emoji on each`}</button>
      </>}
      {p?.answered && !support && (p.team.indexes
        ? <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 14 }}><b>Your team this week 👀 ({p.team.count} answers)</b>
            {WELLBEING_INDEXES.map((x) => { const v = p.team.indexes![x.key]; return v == null ? null : <Meter key={x.key} label={`${x.icon} ${x.name}`} value={v} sub={word(x.key, v)} />; })}</div>
        : <div style={{ fontSize: 14, display: "flex", gap: 10, alignItems: "center" }}><span style={{ fontSize: 28 }} aria-hidden="true">🙌</span><span><b>Thanks for checking in!</b><br />{p.team.count} of your team answered. Team vibes unlock at {p.team.needed}+ answers.</span></div>)}
      {support ? <Support asked={support === "asked"} onClose={() => setSupport(null)} />
        : <button className="wb-link" onClick={() => setSupport("asked")}>🫂 Need to talk? Book a private chat</button>}
      <span className="wb-fine">🔒 Nobody, not even HR or the CEO, can see who answered what. Team results show only at 5+ people.</span>
      <ErrorNote error={answer.error} />
    </section>
  );
}

function Meter({ label, value, sub }: { label: string; value: number; sub: string }) {
  return <div>
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span style={{ fontWeight: 700 }}>{label}</span><span>{value}/100 · {sub}</span></div>
    <div className="wb-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label={label}><i style={{ width: `${value}%` }} /></div>
  </div>;
}

type Options = { manager: { name: string } | null; ceo: { name: string } | null };
type Esat = { cycle: { id: string; title: string } | null; participated?: boolean };
const MODES = [["in_person", "In person", "👋"], ["call", "Phone call", "📞"], ["video", "Video call", "🎥"]] as const;

/** Shown after a low answer (or on request): an anonymous survey, or a private conversation with the manager or CEO. */
function Support({ asked, onClose }: { asked: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const opts = useQuery({ queryKey: ["care", "options"], queryFn: () => api<Options>("/care/options") });
  const esat = useQuery({ queryKey: ["esat", "current"], queryFn: () => api<Esat>("/esat/current") });
  const [f, setF] = useState<{ with?: "manager" | "ceo"; mode: string; when: string; note: string }>({ mode: "in_person", when: "This week", note: "" });
  const book = useMutation({
    mutationFn: () => api("/care", { body: { with: f.with, mode: f.mode, when: f.when, ...(f.note.trim() ? { note: f.note.trim() } : {}) } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["care"] }); celebrate("Request sent", "Only the person you picked can see it"); onClose(); },
  });
  const o = opts.data;
  const who = f.with === "manager" ? o?.manager?.name : f.with === "ceo" ? o?.ceo?.name : undefined;
  const survey = esat.data?.cycle && !esat.data.participated;
  return (
    <div className="wb-sup">
      <div><b style={{ fontSize: 17 }}>{asked ? "Let's get you some time to talk 🫂" : "Rough week? Thanks for being real 🫂"}</b>
        <div style={{ fontSize: 14, color: "#334155" }}>You don't have to carry it alone. Pick what feels right, or neither.</div></div>
      <div className="wb-tiles">
        <div className="wb-tile anon">
          <h4><span aria-hidden="true">🕶️</span>Say it anonymously</h4>
          <p>{survey ? `"${esat.data!.cycle!.title}" is open. Nobody can see who answered.` : "Drop it in the anonymous suggestion box. You get a secret code to read HR's reply."}</p>
          <Link href={survey ? "/feedback" : "/feedback?tab=box"} className="wb-chip" style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", textDecoration: "none" }}>{survey ? "Take the anonymous survey →" : "Open the suggestion box →"}</Link>
        </div>
        <div className="wb-tile talk">
          <h4><span aria-hidden="true">☕</span>Book a counselling session</h4>
          <p>A private 1:1 with your manager or the CEO. They suggest a time, you talk.</p>
          {o && !o.manager && !o.ceo && <p>Nobody is set up to take these yet. Try the suggestion box for now.</p>}
          <div className="wb-chips" role="radiogroup" aria-label="Who with">
            {o?.manager && <button role="radio" aria-checked={f.with === "manager"} className={`wb-chip${f.with === "manager" ? " on" : ""}`} onClick={() => setF({ ...f, with: "manager" })}>🧑‍💼 My manager, {o.manager.name.split(" ")[0]}</button>}
            {o?.ceo && <button role="radio" aria-checked={f.with === "ceo"} className={`wb-chip${f.with === "ceo" ? " on" : ""}`} onClick={() => setF({ ...f, with: "ceo" })}>🌟 The CEO, {o.ceo.name.split(" ")[0]}</button>}
          </div>
          {f.with && <>
            <div className="wb-chips" role="radiogroup" aria-label="How">{MODES.map(([k, l, e]) => <button key={k} role="radio" aria-checked={f.mode === k} className={`wb-chip${f.mode === k ? " on" : ""}`} onClick={() => setF({ ...f, mode: k })}>{e} {l}</button>)}</div>
            <div className="wb-chips" role="radiogroup" aria-label="When">{CARE_WHEN.map((w) => <button key={w} role="radio" aria-checked={f.when === w} className={`wb-chip${f.when === w ? " on" : ""}`} onClick={() => setF({ ...f, when: w })}>{w}</button>)}</div>
            <textarea className="wb-note" value={f.note} maxLength={500} rows={2} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Anything they should know first? Totally optional." />
            <span className="wb-fine">🔒 Only {who} sees this. Not HR, not your team, never on a dashboard. Your check-in stays anonymous. Withdraw any time.</span>
            <button className="wb-send" style={{ minHeight: 46 }} disabled={book.isPending} onClick={() => book.mutate()}>Ask {who?.split(" ")[0]} for a chat ☕</button>
          </>}
          <ErrorNote error={book.error ?? opts.error} />
        </div>
      </div>
      <button className="wb-link" style={{ borderStyle: "solid", borderColor: "#e2e8f0", color: "#334155" }} onClick={onClose}>Not now</button>
    </div>
  );
}

type Care = { id: string; with: "manager" | "ceo"; mode: string; when: string; note: string | null; status: string; scheduledFor: string | null; reply: string | null; createdAt: string };
type CareList = { mine: (Care & { counsellor: string })[]; toMe: (Care & { requester: string })[] };
const modeLabel = (m: string) => MODES.find(([k]) => k === m)?.[1] ?? m;
const at = (s: string) => new Date(s).toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Private conversations you asked for, and ones people asked you for. Hidden when there are none. */
export function CareCard() {
  const q = useQuery({ queryKey: ["care"], queryFn: () => api<CareList>("/care") });
  const mine = q.data?.mine.filter((x) => x.status === "requested" || x.status === "scheduled") ?? [];
  const toMe = q.data?.toMe.filter((x) => x.status === "requested" || x.status === "scheduled") ?? [];
  if (!mine.length && !toMe.length) return null;
  return (
    <section className="gz-card gz-pop wb" style={{ gap: 12 }}>
      <div className="wb-head"><span className="wb-tag">🔒 Only the two of you see this</span><h3>☕ 1:1 chats</h3></div>
      {toMe.map((x) => <ToMe key={x.id} x={x} />)}
      {mine.map((x) => <Mine key={x.id} x={x} />)}
    </section>
  );
}

function ToMe({ x }: { x: Care & { requester: string } }) {
  const qc = useQueryClient();
  const [when, setWhen] = useState(""); const [msg, setMsg] = useState("");
  const act = useMutation({ mutationFn: (body: object) => api(`/care/${x.id}`, { body }), onSuccess: () => qc.invalidateQueries({ queryKey: ["care"] }) });
  return <div style={{ borderTop: "1px solid var(--gz-line)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }}>
    <span><b>{x.requester}</b> would like a private conversation · {modeLabel(x.mode)} · {x.when.toLowerCase()}</span>
    {x.note && <span style={{ whiteSpace: "pre-wrap", color: "#334155" }}>"{x.note}"</span>}
    {x.scheduledFor && <span>You suggested {at(x.scheduledFor)}.</span>}
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="Time" style={{ font: "inherit", fontSize: 14, minHeight: 36, borderRadius: 10, border: "1px solid var(--gz-line)", padding: "0 8px" }} />
      <input value={msg} maxLength={500} onChange={(e) => setMsg(e.target.value)} placeholder="A short note, optional" aria-label="Note" style={{ font: "inherit", fontSize: 14, minHeight: 36, borderRadius: 10, border: "1px solid var(--gz-line)", padding: "0 8px", flex: "1 1 160px" }} />
      <button className="gz-btn sm primary" disabled={!when || act.isPending} onClick={() => act.mutate({ action: "schedule", at: new Date(when).toISOString(), ...(msg.trim() ? { reply: msg.trim() } : {}) })}>{x.scheduledFor ? "Change time" : "Suggest this time"}</button>
      <button className="gz-btn sm" disabled={act.isPending} onClick={() => act.mutate({ action: "done" })}>Mark done</button>
    </div>
    <ErrorNote error={act.error} />
  </div>;
}

function Mine({ x }: { x: Care & { counsellor: string } }) {
  const qc = useQueryClient();
  const done = useMutation({ mutationFn: () => api(`/care/${x.id}`, { body: { action: "done" } }), onSuccess: () => qc.invalidateQueries({ queryKey: ["care"] }) });
  const withdraw = useMutation({ mutationFn: () => api(`/care/${x.id}`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["care"] }) });
  return <div style={{ borderTop: "1px solid var(--gz-line)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 6, fontSize: 14 }}>
    <span>You asked <b>{x.counsellor}</b> for a conversation · {modeLabel(x.mode)}</span>
    {x.scheduledFor ? <span><b>{at(x.scheduledFor)}</b>{x.reply ? ` · "${x.reply}"` : ""}</span> : <span className="k">Waiting for them to suggest a time.</span>}
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {x.scheduledFor && <button className="gz-btn sm" disabled={done.isPending} onClick={() => done.mutate()}>We've talked</button>}
      <button className="gz-btn sm" disabled={withdraw.isPending} onClick={() => withdraw.mutate()}>Withdraw and erase</button>
    </div>
    <ErrorNote error={done.error ?? withdraw.error} />
  </div>;
}
