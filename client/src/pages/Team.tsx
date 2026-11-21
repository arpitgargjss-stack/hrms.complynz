import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { ErrorNote } from "../lib/ui";
import { Story } from "../lib/gz";
import "../gz.css";

type Person = { id: string; fullName: string; photoFileId: string | null; designation: string | null; department: string | null; location: string | null; self: boolean; sameTeam: boolean; isNew: boolean; shared: boolean; fact: string | null; tags: string[]; common: string[] };
type Filter = "team" | "all" | "new" | "common";

export default function Team() {
  const q = useQuery({ queryKey: ["team"], queryFn: () => api<{ myTags: string[]; people: Person[] }>("/team") });
  const [filter, setFilter] = useState<Filter>("team");
  const [text, setText] = useState("");
  const list = useMemo(() => {
    const t = text.trim().toLowerCase();
    return (q.data?.people ?? []).filter((p) => !p.self || filter === "all").filter((p) =>
      filter === "team" ? p.sameTeam : filter === "new" ? p.isNew : filter === "common" ? p.common.length > 0 : true).filter((p) =>
      !t || [p.fullName, p.department, p.designation, p.location, p.fact, ...p.tags].some((x) => x?.toLowerCase().includes(t)));
  }, [q.data, filter, text]);
  const popular = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of q.data?.people ?? []) if (p.sameTeam) for (const t of p.tags) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  }, [q.data]);
  return (
    <div className="gz" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="pagehead" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 0 }}>
        <div><span className="gz-eyebrow" style={{ color: "#0048e4" }}>People</span><h1 style={{ margin: "4px 0" }}>Know your team</h1>
          <span style={{ color: "var(--gz-mute)" }}>The humans behind the job titles. Everyone shares only what they want to.</span></div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <input type="search" aria-label="Search people" placeholder="Search by name, hobby or city" value={text} onChange={(e) => setText(e.target.value)} style={{ width: 300, borderRadius: 14, minHeight: 46 }} />
          <Link className="gz-btn primary" href="/vibe">My vibe page</Link>
        </div>
      </div>
      <div className="gz-tabs">{([["team", "My team"], ["all", "Everyone"], ["new", "New this month"], ["common", "Shares a hobby with you"]] as [Filter, string][]).map(([k, l]) =>
        <button key={k} className={filter === k ? "on" : ""} aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>)}</div>
      <ErrorNote error={q.error} />
      {filter === "common" && q.data && q.data.myTags.length === 0 && <div className="gz-empty">Add your interests on <Link href="/vibe">your vibe page</Link> to find people who share them.</div>}
      {list.length === 0 && q.data && <div className="gz-empty">Nobody here yet.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 16 }}>
        {list.map((p, i) => (
          <Link key={p.id} href={`/vibe/${p.id}`} className="gz-card lift gz-pop" style={{ animationDelay: `${i * 0.03}s`, display: "flex", flexDirection: "column", gap: 12, textDecoration: "none", color: "inherit", minHeight: 220 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Story name={p.fullName} fileId={p.photoFileId} size={58} />
              <span style={{ minWidth: 0 }}><b style={{ display: "block", fontSize: 16 }}>{p.fullName}</b><span style={{ fontSize: 13, color: "var(--gz-mute)" }}>{[p.designation, p.department].filter(Boolean).join(" · ")}</span></span>
            </div>
            {p.isNew && <span className="gz-pill" style={{ alignSelf: "flex-start", background: "#f0f5ff", color: "#0048e4", fontSize: 12 }}>New here, say hi</span>}
            {p.shared ? <>
              {p.fact && <span style={{ fontSize: 14, lineHeight: 1.5 }}>{p.fact}</span>}
              <div className="gz-chips" style={{ marginTop: "auto" }}>{p.tags.map((t) => <span key={t} className="gz-pill" style={{ fontSize: 12, background: p.common.includes(t) ? "#f0f5ff" : "var(--gz-tint)", color: p.common.includes(t) ? "#1e3a8a" : "var(--gz-deep)" }}>{t}</span>)}</div>
            </> : <span style={{ marginTop: "auto", fontSize: 13, color: "var(--gz-mute)", padding: 12, borderRadius: 14, border: "1px dashed #cbd5e1" }}>Keeps their vibe page private. Say hi the old-fashioned way.</span>}
          </Link>))}
      </div>
      {popular && popular[1] >= 2 && <div className="gz-card" style={{ background: "#eff6ff", borderColor: "#bfdbfe", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <b style={{ flex: 1, color: "#00236e" }}>{popular[1]} people on your team are into {popular[0].toLowerCase()}.</b>
        <span className="k" style={{ color: "#1e40af" }}>Counted only from vibe pages shared with you.</span></div>}
    </div>
  );
}
