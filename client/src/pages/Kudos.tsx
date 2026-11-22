import { useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { ErrorNote } from "../lib/ui";
import { Story, ago, celebrate } from "../lib/gz";
import { POLL_MS, playChime, useNewItemChime } from "../lib/sound";
import { KUDOS_VALUES } from "@shared/hr/buzz";
import "../gz.css";

type Who = { id: string; fullName: string; photoFileId: string | null };
type K = { id: string; from: Who; to: Who; value: string; message: string; createdAt: string; counts: { clap: number; fire: number }; mine: string[]; canHide: boolean; canDelete: boolean };
type Wall = { givenThisWeek: number; items: K[] };
const VALUE_STYLE: Record<string, [string, string]> = {
  Ownership: ["#f0f5ff", "#0048e4"], "Customer love": ["#eff6ff", "#1d4ed8"], "Helping hand": ["#ecfdf5", "#047857"],
  "Big brain": ["#eff6ff", "#1e40af"], "Team player": ["#e0f2fe", "#075985"], Wishes: ["#f0f5ff", "#1e3a8a"],
};

export default function Kudos() {
  const search = new URLSearchParams(useSearch());
  const to = search.get("to") ?? "";
  const [filter, setFilter] = useState<string>("");
  const wall = useQuery({ queryKey: ["kudos", filter], refetchInterval: POLL_MS, queryFn: () => api<Wall>(`/kudos${filter ? `?value=${encodeURIComponent(filter)}` : ""}`) });
  useNewItemChime(wall.data?.items, (k) => k.createdAt, (k) => k.from.id);
  return (
    <div className="gz" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="pagehead" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 0 }}>
        <div><span className="gz-eyebrow" style={{ color: "#2563eb" }}>Recognition</span><h1 style={{ margin: "4px 0" }}>Kudos wall</h1>
          <span style={{ color: "var(--gz-mute)" }}>Specific, public thank-yous. No points, no leaderboards.</span></div>
        {wall.data && <span className="gz-pill" style={{ background: "#eff6ff", color: "#0048e4" }}>You gave {wall.data.givenThisWeek} this week</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 20, alignItems: "start" }}>
        <section className="gz-hero" style={{ display: "block", padding: 22, maxWidth: 460 }}><KudosComposer initialTo={to} initialValue={search.get("value") ?? (search.get("wave") ? "Team player" : "")} /></section>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 2 }}>
          <div className="gz-tabs">{["", ...KUDOS_VALUES].map((v) => <button key={v || "all"} className={filter === v ? "on" : ""} aria-pressed={filter === v} onClick={() => setFilter(v)}>{v || "All"}</button>)}</div>
          <ErrorNote error={wall.error} />
          {wall.data?.items.length === 0 && <div className="gz-empty">No kudos yet. Someone helped you this week: be the first to say it.</div>}
          {wall.data?.items.map((k, i) => <KudosCard key={k.id} k={k} delay={i * 0.04} />)}
        </div>
      </div>
    </div>
  );
}

function KudosCard({ k, delay, compact }: { k: K; delay?: number; compact?: boolean }) {
  const qc = useQueryClient();
  const inv = () => qc.invalidateQueries({ queryKey: ["kudos"] });
  const react = useMutation({ mutationFn: (v: { kind: string; on: boolean }) => api(`/kudos/${k.id}/react`, { body: v }), onSuccess: inv });
  const hide = useMutation({ mutationFn: () => api(`/kudos/${k.id}/hide`, { method: "POST" }), onSuccess: inv });
  const del = useMutation({ mutationFn: () => api(`/kudos/${k.id}`, { method: "DELETE" }), onSuccess: inv });
  const [bg, fg] = VALUE_STYLE[k.value] ?? ["#f1f5f9", "#334155"];
  const btn = (kind: "clap" | "fire", label: string) => { const on = k.mine.includes(kind); return <button className="gz-btn sm" aria-pressed={on} style={on ? { background: "var(--gz-tint)", borderColor: "#c7d8ff", color: "var(--gz-deep)" } : undefined} onClick={() => react.mutate({ kind, on: !on })}>{label} {k.counts[kind]}</button>; };
  return (
    <article className={compact ? "" : "gz-card lift gz-pop"} style={{ animationDelay: `${delay ?? 0}s`, display: "flex", flexDirection: "column", gap: 10, ...(compact ? { padding: 14, borderRadius: 16, border: "1px solid #eff6ff", background: "#f8fafc", color: "#0f172a" } : {}) }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 14 }}>
        {!compact && <Story name={k.from.fullName} fileId={k.from.photoFileId} size={38} />}
        <Link href={`/vibe/${k.from.id}`} style={{ fontWeight: 700, color: "inherit" }}>{k.from.fullName.split(" ")[0]}</Link><span style={{ color: "var(--gz-mute)" }}>to</span>
        <Link href={`/vibe/${k.to.id}`} style={{ fontWeight: 700, color: "inherit" }}>{k.to.fullName.split(" ")[0]}</Link>
        <span className="gz-pill" style={{ marginLeft: "auto", fontSize: 11, background: bg, color: fg }}>{k.value}</span>
      </div>
      <p style={{ margin: 0, fontSize: compact ? 14 : 16, lineHeight: 1.5 }}>{k.message}</p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>{btn("clap", "Clap")}{btn("fire", "Fire")}
        <span style={{ fontSize: 12, color: "var(--gz-mute)", marginLeft: "auto" }}>{ago(k.createdAt)}</span>
        {!compact && k.canHide && <button className="gz-btn sm" onClick={() => hide.mutate()}>Hide from wall</button>}
        {!compact && k.canDelete && <button className="gz-btn sm" onClick={() => del.mutate()}>Remove</button>}</div>
    </article>
  );
}

export function KudosComposer({ initialTo = "", initialValue = "" }: { initialTo?: string; initialValue?: string }) {
  const qc = useQueryClient();
  const team = useQuery({ queryKey: ["team"], queryFn: () => api<{ people: { id: string; fullName: string; self: boolean; department: string | null }[] }>("/team") });
  const [to, setTo] = useState(initialTo);
  const [value, setValue] = useState<string>(KUDOS_VALUES.includes(initialValue as never) ? initialValue : "Ownership");
  const [message, setMessage] = useState("");
  const people = useMemo(() => (team.data?.people ?? []).filter((p) => !p.self), [team.data]);
  const send = useMutation({
    mutationFn: () => api<{ id: string }>("/kudos", { body: { toEmployeeId: to, value, message } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["kudos"] }); setMessage(""); playChime(); celebrate("Kudos sent", `${people.find((p) => p.id === to)?.fullName.split(" ")[0] ?? "They"} will love this`, true); },
  });
  const lbl = { fontSize: 12, fontWeight: 700, color: "#dbeafe" } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, position: "relative" }}>
      <b className="display" style={{ fontSize: 20 }}>{value === "Wishes" ? "Send wishes" : "Give kudos"}</b>
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}><span style={lbl}>To</span>
        <select value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose a colleague</option>{people.map((p) => <option key={p.id} value={p.id}>{p.fullName}{p.department ? ` · ${p.department}` : ""}</option>)}</select></label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>{KUDOS_VALUES.map((v) => <button key={v} type="button" aria-pressed={value === v} onClick={() => setValue(v)}
        style={{ font: "inherit", fontSize: 12, fontWeight: 800, minHeight: 36, padding: "0 12px", borderRadius: 999, border: 0, cursor: "pointer", background: value === v ? "#fff" : "rgba(255,255,255,.16)", color: value === v ? "#0048e4" : "#fff" }}>{v}</button>)}</div>
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}><span style={lbl}>What did they do?</span>
        <textarea rows={3} maxLength={400} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={value === "Wishes" ? "Happy birthday! Have a great one." : "Be specific: what happened and why it mattered"} /></label>
      <ErrorNote error={send.error} />
      <button className="gz-btn white" style={{ minHeight: 50, fontSize: 16 }} disabled={!to || message.trim().length < 3 || send.isPending} onClick={() => send.mutate()}>Send kudos</button>
      <span style={{ fontSize: 12, color: "#dbeafe" }}>Posted under your name for everyone at Complynz. The person you thank can hide it.</span>
    </div>
  );
}

export function KudosPreview() {
  const wall = useQuery({ queryKey: ["kudos", ""], refetchInterval: POLL_MS, queryFn: () => api<Wall>("/kudos") });
  useNewItemChime(wall.data?.items, (k) => k.createdAt, (k) => k.from.id);
  return (
    <section className="gz-card gz-pop" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}><b style={{ fontSize: 16 }}>Kudos wall</b><Link href="/kudos" style={{ fontSize: 13, fontWeight: 700 }}>Open wall</Link></div>
      {wall.data?.items.length === 0 && <span className="k">No kudos yet. <Link href="/kudos">Be the first</Link>.</span>}
      {wall.data?.items.slice(0, 3).map((k) => <KudosCard key={k.id} k={k} compact />)}
    </section>
  );
}

