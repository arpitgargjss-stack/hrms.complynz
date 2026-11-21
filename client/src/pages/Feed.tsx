import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { ErrorNote } from "../lib/ui";
import { Story, ago, celebrate } from "../lib/gz";
import { POLL_MS, playChime, useNewItemChime } from "../lib/sound";
import { FEED_KIND_LABEL, type FeedKind } from "@shared/hr/vibe";
import "../gz.css";

type Post = {
  id: string; kind: FeedKind; kindLabel: string; audience: "team" | "everyone"; quote: string | null; source: string | null; url: string | null; host: string | null;
  title: string | null; note: string | null; createdAt: string; author: { id: string; fullName: string; photoFileId: string | null };
  counts: Record<"clap" | "mind" | "save", number>; mine: string[]; canDelete: boolean;
};
const TAG: Record<FeedKind, [string, string, string]> = {
  quote: ["#eff6ff", "#1d4ed8", "linear-gradient(135deg,#60a5fa,#2563eb)"], ai_news: ["#eff6ff", "#1e40af", "linear-gradient(135deg,#0048e4,#0048e4)"],
  article: ["#ecfdf5", "#047857", "linear-gradient(135deg,#10b981,#bfdbfe)"], linkedin: ["#e0f2fe", "#075985", "linear-gradient(135deg,#0a66c2,#60a5fa)"],
};

export default function Feed() {
  const [tab, setTab] = useState<"team" | "everyone" | "saved">("team");
  const posts = useQuery({ queryKey: ["feed", tab], refetchInterval: POLL_MS, queryFn: () => api<Post[]>(`/feed?tab=${tab}`) });
  useNewItemChime(posts.data, (p) => p.createdAt, (p) => p.author.id);
  const top = useQuery({ queryKey: ["feed-top"], queryFn: () => api<{ id: string; title: string | null; saves: number }[]>("/feed/top") });
  return (
    <div className="gz" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="pagehead" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 0 }}>
        <div><span className="gz-eyebrow" style={{ color: "#2563eb" }}>New</span><h1 style={{ margin: "4px 0" }}>The team feed</h1>
          <span style={{ color: "var(--gz-mute)" }}>Book quotes, AI news, articles and LinkedIn posts worth a colleague's five minutes.</span></div>
        <div className="gz-tabs" role="tablist">{(["team", "everyone", "saved"] as const).map((t) =>
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t === "team" ? "My team" : t === "everyone" ? "Everyone" : "Saved"}</button>)}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 20, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 460 }}>
          <section className="gz-hero" style={{ padding: 22, borderRadius: 28, display: "block" }}><ShareComposer onDark /></section>
          <section className="gz-card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span className="gz-eyebrow" style={{ color: "#0048e4" }}>Most saved this week</span>
            {top.data?.length === 0 && <span className="k">Nothing saved yet. Hit "Save" on a post you want to come back to.</span>}
            {top.data?.map((t, i) => <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <span style={{ width: 28, height: 28, borderRadius: 9, background: ["#0048e4", "#0048e4", "#2563eb"][i], color: "#fff", fontWeight: 800, fontSize: 13, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{i + 1}</span>
              <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{t.title}</span><span className="k">{t.saves} saves</span></div>)}
          </section>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14, flex: 2 }}>
          <ErrorNote error={posts.error} />
          {posts.data?.length === 0 && <div className="gz-empty">{tab === "saved" ? "Nothing saved yet." : "Quiet in here. Be the first to share something good."}</div>}
          {posts.data?.map((p, i) => <PostCard key={p.id} p={p} delay={i * 0.05} />)}
        </div>
      </div>
    </div>
  );
}

function PostCard({ p, delay }: { p: Post; delay: number }) {
  const qc = useQueryClient();
  const react = useMutation({ mutationFn: (v: { kind: string; on: boolean }) => api(`/feed/${p.id}/react`, { body: v }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["feed"] }); qc.invalidateQueries({ queryKey: ["feed-top"] }); } });
  const del = useMutation({ mutationFn: () => api(`/feed/${p.id}`, { method: "DELETE" }), onSuccess: () => qc.invalidateQueries({ queryKey: ["feed"] }) });
  const [bg, fg, thumb] = TAG[p.kind];
  const btn = (kind: "clap" | "mind" | "save", label: string) => {
    const on = p.mine.includes(kind);
    return <button className="gz-btn sm" aria-pressed={on} style={on ? { background: "var(--gz-tint)", borderColor: "#c7d8ff", color: "var(--gz-deep)" } : undefined} onClick={() => react.mutate({ kind, on: !on })}>{label}{kind !== "save" ? ` ${p.counts[kind]}` : on ? "d" : ""}</button>;
  };
  return (
    <article className="gz-card lift gz-pop" style={{ animationDelay: `${delay}s`, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Link href={`/vibe/${p.author.id}`} aria-label={p.author.fullName}><Story name={p.author.fullName} fileId={p.author.photoFileId} size={42} /></Link>
        <span style={{ flex: 1 }}><Link href={`/vibe/${p.author.id}`} style={{ fontWeight: 700, color: "inherit", textDecoration: "none" }}>{p.author.fullName}</Link>
          <span style={{ display: "block", fontSize: 12, color: "var(--gz-mute)" }}>{ago(p.createdAt)} · {p.audience === "team" ? "Team" : "Everyone"}</span></span>
        <span className="gz-pill" style={{ background: bg, color: fg, fontSize: 11, letterSpacing: ".06em" }}>{p.kindLabel.toUpperCase()}</span>
      </div>
      {p.kind === "quote" ? <div style={{ padding: "18px 20px", borderRadius: 18, background: "linear-gradient(140deg,#eff6ff,#eff6ff)", color: "#0f172a" }}>
        <span className="display" style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.35, display: "block" }}>“{p.quote}”</span>{p.source && <span style={{ fontSize: 13, fontWeight: 600, color: "#1e3a8a" }}>{p.source}</span>}</div>
        : <a href={p.url ?? "#"} target="_blank" rel="noreferrer noopener" style={{ display: "flex", gap: 14, alignItems: "center", padding: 12, borderRadius: 18, border: "1px solid var(--gz-line)", textDecoration: "none", color: "inherit" }}>
          <span style={{ width: 88, height: 66, flex: "none", borderRadius: 12, background: thumb }} aria-hidden="true" />
          <span style={{ minWidth: 0 }}><span style={{ fontSize: 12, color: "var(--gz-mute)" }}>{p.host}{p.source ? ` · ${p.source}` : ""} · opens outside Complynz</span><b style={{ display: "block", fontSize: 16, lineHeight: 1.35, overflowWrap: "anywhere" }}>{p.title ?? p.url}</b></span></a>}
      {p.note && <span style={{ fontSize: 14, lineHeight: 1.5 }}>{p.note}</span>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{btn("clap", "Clap")}{btn("mind", "Mind blown")}{btn("save", "Save")}
        {p.canDelete && <button className="gz-btn sm" style={{ marginLeft: "auto" }} onClick={() => del.mutate()}>Remove</button>}</div>
    </article>
  );
}

/** Share box. Consent is ticked by the person on every post, and recorded with a receipt. */
export function ShareComposer({ preset, onDone, onDark }: { preset?: { kind: FeedKind; quote?: string; source?: string }; onDone?: () => void; onDark?: boolean }) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<FeedKind>(preset?.kind ?? "quote");
  const [f, setF] = useState({ quote: preset?.quote ?? "", source: preset?.source ?? "", url: "", title: "", note: "" });
  const [aud, setAud] = useState<"team" | "everyone">("team");
  const share = useMutation({
    mutationFn: () => api<{ id: string }>("/feed", { body: { kind, audience: aud, quote: kind === "quote" ? f.quote : undefined, source: f.source || undefined,
      url: kind !== "quote" ? f.url : undefined, title: kind !== "quote" && f.title ? f.title : undefined, note: f.note || undefined } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["feed"] }); qc.invalidateQueries({ queryKey: ["vibe"] }); qc.invalidateQueries({ queryKey: ["privacy"] });
      setF({ quote: "", source: "", url: "", title: "", note: "" }); playChime(); celebrate("Shared", aud === "team" ? "Your team can see it now" : "Everyone at Complynz can see it now", true); onDone?.(); },
  });
  const lbl = { fontSize: 12, fontWeight: 700, color: onDark ? "#dbeafe" : "var(--gz-mute)" } as const;
  const filled = kind === "quote" ? f.quote.trim() : f.url.trim();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, position: "relative" }}>
      {onDark && <b className="display" style={{ fontSize: 20 }}>Share something good</b>}
      {!preset && <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 6 }}>{(Object.keys(FEED_KIND_LABEL) as FeedKind[]).map((k) =>
        <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} style={{ font: "inherit", minHeight: 40, borderRadius: 12, border: 0, fontSize: 12, fontWeight: 800, cursor: "pointer",
          background: kind === k ? "#fff" : onDark ? "rgba(255,255,255,.16)" : "var(--gz-tint)", color: kind === k ? "#0048e4" : onDark ? "#fff" : "var(--gz-deep)" }}>{FEED_KIND_LABEL[k].toUpperCase()}</button>)}</div>}
      {kind === "quote" ? <>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}><span style={lbl}>The quote</span><textarea rows={3} maxLength={400} value={f.quote} onChange={(e) => setF({ ...f, quote: e.target.value })} placeholder="The line that stuck with you" /></label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}><span style={lbl}>Book and author</span><input maxLength={160} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} /></label>
      </> : <>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}><span style={lbl}>Link (https)</span><input type="url" maxLength={600} value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder={kind === "linkedin" ? "https://www.linkedin.com/posts/…" : "https://…"} /></label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}><span style={lbl}>Headline</span><input maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="What it's about" /></label>
      </>}
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}><span style={lbl}>Why it's worth reading (optional)</span><input maxLength={280} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="One line for your team" /></label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>{(["team", "everyone"] as const).map((a) =>
        <button key={a} type="button" aria-pressed={aud === a} onClick={() => setAud(a)} style={{ font: "inherit", minHeight: 44, borderRadius: 12, cursor: "pointer", fontWeight: 700, fontSize: 13,
          border: aud === a ? `2px solid ${onDark ? "#fff" : "var(--gz-blue)"}` : `1px solid ${onDark ? "rgba(255,255,255,.35)" : "var(--gz-line)"}`, background: onDark ? (aud === a ? "rgba(255,255,255,.28)" : "rgba(255,255,255,.08)") : aud === a ? "var(--gz-tint)" : "var(--gz-card)", color: onDark ? "#fff" : "var(--gz-ink)" }}>
          {a === "team" ? "My team" : "Everyone at Complynz"}</button>)}</div>
      <ErrorNote error={share.error} />
      <button className={`gz-btn ${onDark ? "white" : "primary"}`} style={{ minHeight: 50, fontSize: 16 }} disabled={!filled || share.isPending} onClick={() => share.mutate()}>Share to {aud === "team" ? "my team" : "everyone"}</button>
      <span style={{ fontSize: 12, color: onDark ? "#dbeafe" : "var(--gz-mute)" }}>Posted under your name. Keep it free of anything confidential about clients or Complynz. You can remove a post any time.</span>
    </div>
  );
}
