import { useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, fileToBase64 } from "../lib/api";
import { squarePhoto, usePhotoUrl, initials } from "../lib/Avatar";
import { ErrorNote } from "../lib/ui";
import { AudiencePicker, ConsentBox, Modal, PALETTE, Story, ago, celebrate, consentBody, type VibeConsent } from "../lib/gz";
import { ShareComposer } from "./Feed";
import { playChime } from "../lib/sound";
import { AUDIENCE_LABEL, VIBE_SECTIONS, type Audience, type VibeSectionKey } from "@shared/hr/vibe";
import "../gz.css";

type Me = { employeeId: string | null };
type Card = { id: string; fullName: string; photoFileId: string | null; designation: string | null; department: string | null; location: string | null; joiningDate: string };
type Post = { id: string; kindLabel: string; quote: string | null; title: string | null; host: string | null; note: string | null; url: string | null; counts: Record<string, number>; createdAt: string };
type VibeView = {
  person: Card & { manager: { id: string; fullName: string } | null; self: boolean; sameTeam: boolean };
  sections: Partial<Record<VibeSectionKey, { content: any; audience: Audience }>>;
  common: string[]; team: { id: string; fullName: string; photoFileId: string | null }[]; recentPosts: Post[];
};
type MySection = { key: VibeSectionKey; label: string; hint: string; others: boolean; content: any; audience: Audience; consent: string };

const years = (d: string) => { const y = (Date.now() - new Date(d).getTime()) / (365.25 * 86400_000); return y >= 1 ? `${Math.floor(y)} yr${y >= 2 ? "s" : ""}` : `${Math.max(1, Math.floor(y * 12))} mo`; };
const newId = () => Math.random().toString(36).slice(2, 10);

export default function Vibe() {
  const params = useParams<{ id?: string }>();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  const id = params.id ?? me.data?.employeeId ?? undefined;
  const v = useQuery({ queryKey: ["vibe", id], enabled: !!id, queryFn: () => api<VibeView>(`/vibe/${id}`) });
  const mine = useQuery({ queryKey: ["vibe-me"], enabled: !!v.data?.person.self, queryFn: () => api<MySection[]>("/vibe/me") });
  const [editing, setEditing] = useState<VibeSectionKey | null>(null);
  const [sharing, setSharing] = useState<{ quote: string; source: string } | null>(null);
  if (me.data && !me.data.employeeId && !params.id) return <div className="note warn">No employee record is linked to this login yet.</div>;
  if (v.error) return <ErrorNote error={v.error} />;
  if (!v.data) return <p>Loading…</p>;
  const { person: p, sections: s } = v.data;
  const own = p.self;
  const c = <K extends VibeSectionKey>(k: K) => s[k]?.content as any;
  const edit = (k: VibeSectionKey) => own && setEditing(k);
  const tags: string[] = c("interests")?.tags ?? [];
  const marquee = tags.map((t, i) => ({ t, bg: PALETTE[i % PALETTE.length][0], fg: PALETTE[i % PALETTE.length][1] }));
  const first = p.fullName.split(" ")[0];
  const show = (k: VibeSectionKey) => !!s[k] || own;
  let delay = 0; const d = () => ({ animationDelay: `${(delay += 0.05)}s` });

  return (
    <div className="gz" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--gz-mute)", flexWrap: "wrap" }}>
        <Link href="/team" style={{ fontWeight: 700 }}>Know your team</Link><span>/</span><span>{own ? "My vibe page" : `${first}'s vibe`}</span>
        {own && <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}><SharingSwitch /><Link className="gz-btn sm" href="/privacy">My privacy</Link></span>}
      </div>

      <section className="gz-hero">
        <svg className="gz-float" width="64" height="64" viewBox="0 0 24 24" aria-hidden="true" style={{ right: "34%", top: 20 }}><path d="M12 2l2.6 6.6L21 9.3l-5 4.4 1.5 6.8L12 17l-5.5 3.5L8 13.7 3 9.3l6.4-.7z" fill="#bfdbfe" /></svg>
        <svg className="gz-float" width="110" height="110" viewBox="0 0 120 120" aria-hidden="true" style={{ right: -20, bottom: -30, animationDelay: "-2s" }}><circle cx="60" cy="60" r="54" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="10" strokeDasharray="10 14" /></svg>
        <span className="gz-float" style={{ right: 180, top: 130, width: 24, height: 24, borderRadius: 8, background: "#34d399", animationDelay: "-1s" }} />
        <div className="gz-ringwrap"><div className="gz-ring" /><div className="gz-avatar"><PhotoOrInitials name={p.fullName} fileId={p.photoFileId} /></div>
          <span style={{ position: "absolute", right: 4, bottom: 12, padding: "5px 10px", borderRadius: 999, background: "#fff", color: "#0f172a", fontSize: 12, fontWeight: 800 }}>{years(p.joiningDate)}</span></div>
        <div style={{ position: "relative", flex: "1 1 320px", display: "flex", flexDirection: "column", gap: 12 }}>
          {c("status")?.text ? <button className="gz-pill gz-glass" style={{ alignSelf: "flex-start", color: "#fff", cursor: own ? "pointer" : "default", font: "inherit", fontWeight: 700 }} onClick={() => edit("status")}><span className="gz-live" />Currently: {c("status").text}</button>
            : own && <button className="gz-pill gz-glass" style={{ alignSelf: "flex-start", color: "#fff", cursor: "pointer", font: "inherit", fontWeight: 700 }} onClick={() => edit("status")}>+ Add what you're up to</button>}
          <h1>{p.fullName}</h1>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 16 }}>
            {c("pronouns")?.text && <span style={{ padding: "4px 10px", borderRadius: 10, background: "rgba(15,23,42,.25)", fontWeight: 700 }}>{c("pronouns").text}</span>}
            {own && !c("pronouns")?.text && <button className="gz-btn sm ghost" onClick={() => edit("pronouns")}>+ Pronouns</button>}
            <span>{[p.designation, p.department, p.location].filter(Boolean).join(" · ")}</span>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {own ? <><button className="gz-btn white" onClick={() => edit("bio")}>Edit my vibe</button><Link className="gz-btn ghost" href="/profile">Work profile</Link></>
              : <><Link className="gz-btn white" href={`/kudos?to=${p.id}`}>Send kudos</Link><Link className="gz-btn ghost" href={`/kudos?to=${p.id}&wave=1`}>Wave hi</Link></>}
          </div>
        </div>
      </section>

      {marquee.length > 0 && <div className="gz-marquee" aria-label={`Into: ${tags.join(", ")}`}><div className="gz-track">{[...marquee, ...marquee].map((m, i) =>
        <span key={i} aria-hidden="true" className="gz-pill" style={{ background: m.bg, color: m.fg, fontSize: 15 }}>{m.t}</span>)}</div></div>}

      <div className="gz-grid">
        {show("bio") && <Section k="bio" own={own} onEdit={edit} span={2} style={{ ...d(), border: "2px solid transparent", background: "linear-gradient(var(--gz-card),var(--gz-card)) padding-box, linear-gradient(120deg,#0048e4,#2563eb,#60a5fa) border-box" }}
          eyebrowColor="#0048e4" aud={s.bio?.audience}>
          {c("bio")?.text ? <p className="display" style={{ margin: 0, fontSize: 22, fontWeight: 700, lineHeight: 1.4 }}>{c("bio").text}</p> : <Empty>Write a few lines in your own words.</Empty>}
        </Section>}
        {show("music") && <Section k="music" own={own} onEdit={edit} style={{ ...d(), background: "linear-gradient(160deg,#0f172a,#00236e)", color: "#fff", border: 0 }} eyebrowColor="#93c5fd" aud={s.music?.audience}>
          <div className="gz-eq" aria-hidden="true">{["#93c5fd", "#93c5fd", "#60a5fa", "#34d399", "#bfdbfe"].map((col, i) => <span key={col} style={{ background: col, animationDelay: `${i * 0.15}s` }} />)}</div>
          {c("music")?.song ? <div style={{ marginTop: "auto" }}><b style={{ fontSize: 20, display: "block" }}>{c("music").song}</b><span style={{ fontSize: 13, color: "#bfdbfe" }}>{c("music").artist}</span></div> : <Empty dark>What's on repeat?</Empty>}
        </Section>}
        {!own && <div className="gz-card lift gz-pop" style={{ ...d(), background: "linear-gradient(150deg,#bfdbfe,#bfdbfe)", color: "#172554", border: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="gz-eyebrow">You two match</span>
          <span className="display" style={{ fontSize: 60, fontWeight: 800, lineHeight: 1 }}>{v.data.common.length} <span style={{ fontSize: 18, letterSpacing: 0 }}>thing{v.data.common.length === 1 ? "" : "s"}</span></span>
          <div className="gz-chips" style={{ marginTop: "auto" }}>{v.data.common.length ? v.data.common.map((t) => <span key={t} className="gz-pill" style={{ background: "rgba(255,255,255,.7)" }}>{t}</span>)
            : <span style={{ fontSize: 13 }}>Add your interests on your vibe page to find what you share.</span>}</div>
        </div>}
        {own && <Section k="interests" own onEdit={edit} style={{ ...d() }} eyebrowColor="#2563eb" aud={s.interests?.audience}>
          {tags.length ? <div className="gz-chips">{tags.map((t) => <span key={t} className="gz-pill" style={{ background: "var(--gz-tint)", color: "var(--gz-deep)" }}>{t}</span>)}</div> : <Empty>Hobbies help people find what you share.</Empty>}
        </Section>}

        {show("snaps") && <Section k="snaps" own={own} onEdit={edit} span={2} rows={2} style={{ ...d() }} eyebrowColor="#2563eb" aud={s.snaps?.audience}>
          {c("snaps")?.photos?.length ? <div className="gz-polgrid">{c("snaps").photos.map((ph: { fileId: string; caption: string }, i: number) =>
            <figure key={ph.fileId} className="gz-pol" style={{ margin: 0, transform: `rotate(${[-5, 4, 3, -4, 5, -3, 2, -2][i % 8]}deg)` }}><SnapImg fileId={ph.fileId} alt={ph.caption || "Photo"} /><figcaption>{ph.caption}</figcaption></figure>)}</div>
            : <Empty>Add trip, pet or weekend photos. Only people you choose will see them.</Empty>}
        </Section>}
        {show("flags") && <Section k="flags" own={own} onEdit={edit} label="Green flags" style={{ ...d(), background: "linear-gradient(160deg,#d1fae5,#a7f3d0)", color: "#064e3b", border: 0 }} aud={s.flags?.audience}>
          {c("flags")?.green?.length ? <div className="gz-chips">{c("flags").green.map((t: string) => <span key={t} className="gz-pill" style={{ background: "rgba(255,255,255,.75)" }}>{t}</span>)}</div> : <Empty>What do you love in a teammate?</Empty>}
        </Section>}
        {s.flags && c("flags")?.ick?.length > 0 && <div className="gz-card lift gz-pop" style={{ ...d(), background: "linear-gradient(160deg,#eff6ff,#dbeafe)", color: "#172554", border: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <span className="gz-eyebrow">Gives me the ick</span><div className="gz-chips">{c("flags").ick.map((t: string) => <span key={t} className="gz-pill" style={{ background: "rgba(255,255,255,.75)" }}>{t}</span>)}</div>
        </div>}
        {show("sliders") && <Section k="sliders" own={own} onEdit={edit} style={{ ...d() }} eyebrowColor="#0048e4" aud={s.sliders?.audience}>
          {c("sliders") ? ([["Introvert", "Extrovert", "social"], ["Planner", "Spontaneous", "planning"], ["Chai", "Coffee", "drink"]] as const).map(([a, b, k]) =>
            <div key={k} style={{ display: "flex", flexDirection: "column", gap: 6 }}><div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, fontWeight: 700, color: "var(--gz-mute)" }}><span>{a}</span><span>{b}</span></div>
              <div className="gz-slider" role="img" aria-label={`${c("sliders")[k]}% towards ${b}`}><i style={{ left: `${c("sliders")[k]}%` }} /></div></div>) : <Empty>Introvert or extrovert? Chai or coffee?</Empty>}
        </Section>}
        {show("family") && <Section k="family" own={own} onEdit={edit} style={{ ...d(), background: "linear-gradient(160deg,#dbeafe,#bfdbfe)", color: "#172554", border: 0 }} aud={s.family?.audience}>
          {c("family")?.text ? <p style={{ margin: 0, fontSize: 15, fontWeight: 600, lineHeight: 1.5 }}>{c("family").text}</p> : <Empty>Family, partner, pets: only what they're happy to share.</Empty>}
        </Section>}

        {show("reading") && <Section k="reading" own={own} onEdit={edit} span={2} style={{ ...d(), background: "linear-gradient(150deg,#eff6ff,#eff6ff)", borderColor: "#dbeafe" }} eyebrowColor="#1d4ed8" aud={s.reading?.audience}>
          {c("reading")?.title ? <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
            <div style={{ width: 92, height: 132, flex: "none", borderRadius: "6px 12px 12px 6px", background: "linear-gradient(160deg,#0048e4,#2563eb)", boxShadow: "inset 6px 0 0 rgba(15,23,42,.25), 0 16px 30px -14px rgba(134,25,143,.7)", color: "#fff", padding: "12px 10px 10px 14px", boxSizing: "border-box", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
              <b className="display" style={{ fontSize: 13, lineHeight: 1.15 }}>{c("reading").title}</b><span style={{ fontSize: 10, opacity: 0.85 }}>{c("reading").author}</span></div>
            <div style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: 8 }}>
              <b style={{ fontSize: 17 }}>{c("reading").title}{c("reading").author && <span style={{ fontWeight: 500, color: "var(--gz-mute)", fontSize: 14 }}> by {c("reading").author}</span>}</b>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}><div style={{ flex: 1, height: 8, borderRadius: 99, background: "#dbeafe" }}><div style={{ width: `${c("reading").progress}%`, height: 8, borderRadius: 99, background: "linear-gradient(90deg,#2563eb,#60a5fa)" }} /></div><span style={{ fontSize: 12, fontWeight: 700, color: "#1e3a8a" }}>{c("reading").progress}%</span></div>
              {(c("reading").quotes ?? []).map((q: { id: string; text: string; note?: string }) => (
                <div key={q.id} style={{ padding: "12px 14px", borderRadius: 16, background: "var(--gz-card)", display: "flex", flexDirection: "column", gap: 8 }}>
                  <span className="display" style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.4 }}>“{q.text}”</span>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontSize: 12, color: "var(--gz-mute)" }}><span>{q.note}</span>
                    {own && <button className="gz-btn sm primary" onClick={() => setSharing({ quote: q.text, source: [c("reading").title, c("reading").author].filter(Boolean).join(", ") })}>Share this quote</button>}</div>
                </div>))}
            </div></div> : <Empty>What are you reading? Save the lines that stick and share them with your team.</Empty>}
        </Section>}
        {(own || v.data.recentPosts.length > 0) && <div className="gz-card lift gz-pop gz-span2" style={{ ...d(), display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span className="gz-eyebrow" style={{ color: "#0048e4" }}>Recently shared</span><Link href="/feed" style={{ fontSize: 13, fontWeight: 700 }}>Open the team feed</Link></div>
          {v.data.recentPosts.length === 0 && <Empty>Share a quote, AI news or an article you loved.</Empty>}
          {v.data.recentPosts.map((x) => <a key={x.id} href={x.url ?? "/feed"} target={x.url ? "_blank" : undefined} rel="noreferrer noopener" style={{ display: "flex", gap: 12, alignItems: "center", padding: 12, borderRadius: 18, border: "1px solid var(--gz-line)", textDecoration: "none", color: "inherit" }}>
            <span style={{ width: 64, height: 64, flex: "none", borderRadius: 14, background: "linear-gradient(135deg,#0048e4,#2563eb)", color: "#fff", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 4 }}>{x.kindLabel.toUpperCase()}</span>
            <span style={{ minWidth: 0 }}><span style={{ fontSize: 12, color: "var(--gz-mute)" }}>{x.host ?? "Quote"} · {ago(x.createdAt)}</span><b style={{ display: "block", fontSize: 15, lineHeight: 1.35 }}>{x.title ?? (x.quote ? `“${x.quote}”` : x.host)}</b>{x.note && <span style={{ fontSize: 13, color: "var(--gz-mute)" }}>{x.note}</span>}</span></a>)}
        </div>}

        {show("work") && <Section k="work" own={own} onEdit={edit} span={2} style={{ ...d() }} eyebrowColor="#0048e4" aud={s.work?.audience}>
          {c("work") ? <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
            {([["Best time to ping", "bestTime", "#f0f5ff", "#0048e4"], ["I do my best work when", "bestWhen", "#eff6ff", "#1d4ed8"], ["Feedback style", "feedback", "#f0f5ff", "#1e3a8a"]] as const).filter(([, k]) => c("work")[k]).map(([l, k, bg, fg]) =>
              <div key={k} style={{ padding: 14, borderRadius: 18, background: bg, color: "#0f172a" }}><span style={{ fontSize: 12, fontWeight: 700, color: fg }}>{l}</span><b style={{ display: "block", fontSize: 15, lineHeight: 1.35, marginTop: 4 }}>{c("work")[k]}</b></div>)}
          </div> : <Empty>Tell people when and how to reach you.</Empty>}
        </Section>}
        {show("ask") && <Section k="ask" own={own} onEdit={edit} style={{ ...d(), background: "#0f172a", color: "#fff", border: 0 }} eyebrowColor="#bfdbfe" aud={s.ask?.audience}>
          {c("ask")?.text ? <b className="display" style={{ fontSize: 19, lineHeight: 1.35 }}>{c("ask").text}</b> : <Empty dark>Give people a conversation starter.</Empty>}
        </Section>}
        <div className="gz-card lift gz-pop" style={{ ...d(), display: "flex", flexDirection: "column", gap: 12 }}>
          <span className="gz-eyebrow" style={{ color: "#0048e4" }}>{own ? "My squad" : `${first}'s squad`}</span>
          <div className="gz-chips" style={{ gap: 10 }}>{v.data.team.map((t) => <Link key={t.id} href={`/vibe/${t.id}`} title={t.fullName} aria-label={t.fullName}><Story name={t.fullName} fileId={t.photoFileId} size={52} /></Link>)}</div>
          {p.manager && <span style={{ fontSize: 13, color: "var(--gz-mute)" }}>Reports to <Link href={`/vibe/${p.manager.id}`}>{p.manager.fullName}</Link></span>}
        </div>
        <div className="gz-card gz-span3" style={{ background: "var(--gz-tint)", borderColor: "#c7d8ff", display: "flex", gap: 12, alignItems: "center", fontSize: 13, color: "#1e3a8a" }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#0048e4" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
          {own ? <span>You choose who sees each card. One consent covers your whole page; turn it off any time in <Link href="/privacy">My privacy</Link> and every card is hidden at once.</span>
            : <span>{first} chose everything here and who sees it, with consent on record. Nothing on this page is used in reviews, pay or hiring.</span>}
        </div>
      </div>

      {editing && <SectionEditor k={editing} mine={mine.data?.find((x) => x.key === editing)} onClose={() => setEditing(null)} />}
      {sharing && <Modal title="Share this quote" onClose={() => setSharing(null)}><ShareComposer preset={{ kind: "quote", quote: sharing.quote, source: sharing.source }} onDone={() => setSharing(null)} /></Modal>}
    </div>
  );
}

function PhotoOrInitials({ name, fileId }: { name: string; fileId: string | null }) {
  const q = usePhotoUrl(fileId);
  return q.data ? <img src={q.data} alt={name} /> : <span aria-label={name}>{initials(name)}</span>;
}
function SnapImg({ fileId, alt }: { fileId: string; alt: string }) {
  const q = usePhotoUrl(fileId);
  return q.data ? <img src={q.data} alt={alt} /> : <img alt="" aria-hidden="true" />;
}
function Empty({ children, dark }: { children: ReactNode; dark?: boolean }) { return <span style={{ fontSize: 14, color: dark ? "#cbd5e1" : "var(--gz-mute)" }}>{children}</span>; }

function Section({ k, own, onEdit, label, children, span, rows, style, eyebrowColor, aud }: { k: VibeSectionKey; own: boolean; onEdit: (k: VibeSectionKey) => void; label?: string; children: ReactNode; span?: 2 | 3; rows?: 2; style?: React.CSSProperties; eyebrowColor?: string; aud?: Audience }) {
  return (
    <section className={`gz-card lift gz-pop ${span ? `gz-span${span}` : ""} ${rows ? "gz-row2" : ""}`} style={{ display: "flex", flexDirection: "column", gap: 12, ...style }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span className="gz-eyebrow" style={{ color: eyebrowColor }}>{label ?? VIBE_SECTIONS[k].label}</span>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {aud && aud !== "everyone" && <span className="gz-aud">{AUDIENCE_LABEL[aud]}</span>}
          {own && <button className="gz-btn sm" onClick={() => onEdit(k)} aria-label={`Edit ${VIBE_SECTIONS[k].label}`}>Edit</button>}
        </span>
      </div>
      {children}
    </section>
  );
}

/** Page-level sharing: the one consent for the whole vibe page. */
export function SharingSwitch() {
  const qc = useQueryClient();
  const pc = useQuery({ queryKey: ["vibe-consent"], queryFn: () => api<VibeConsent>("/me/vibe/consent") });
  const [open, setOpen] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const turnOn = useMutation({
    mutationFn: () => api<VibeConsent>("/me/vibe/consent", { body: consentBody() }),
    onSuccess: (r) => { ["vibe-consent", "vibe", "vibe-me", "privacy", "team"].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); setOpen(false); celebrate("Sharing is on", `Consent receipt ${r.receipt}`, true); },
  });
  if (!pc.data || pc.data.status === "granted") return pc.data ? <span className="gz-pill" style={{ fontSize: 12, background: "#ecfdf5", color: "#047857" }}>Sharing on</span> : null;
  return <>
    <button className="gz-btn sm primary" onClick={() => { setAgreed(false); setOpen(true); }}>Turn on sharing</button>
    {open && <Modal title="Share your vibe page" onClose={() => setOpen(false)}>
      <ConsentBox agreed={agreed} onChange={setAgreed} />
      <ErrorNote error={turnOn.error} />
      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 14 }}>
        <button className="gz-btn" onClick={() => setOpen(false)}>Cancel</button>
        <button className="gz-btn primary" disabled={!agreed || turnOn.isPending} onClick={() => turnOn.mutate()}>Turn on sharing</button></div>
    </Modal>}
  </>;
}

// ---------------------------------------------------------------------
// Editor with consent
// ---------------------------------------------------------------------
const tagsToText = (t?: string[]) => (t ?? []).join(", ");
const textToTags = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

function SectionEditor({ k, mine, onClose }: { k: VibeSectionKey; mine?: MySection; onClose: () => void }) {
  const qc = useQueryClient();
  const def = VIBE_SECTIONS[k];
  const init = useMemo(() => mine?.content ?? ({
    status: { text: "" }, pronouns: { text: "" }, bio: { text: "" }, interests: { tags: [] }, flags: { green: [], ick: [] }, sliders: { social: 50, planning: 50, drink: 50 },
    music: { song: "", artist: "" }, reading: { title: "", author: "", progress: 0, quotes: [] }, snaps: { photos: [] }, family: { text: "" },
    work: { bestTime: "", bestWhen: "", feedback: "" }, ask: { text: "" },
  } as Record<VibeSectionKey, any>)[k], [mine, k]);
  const [val, setVal] = useState<any>(init);
  const [aud, setAud] = useState<Audience>(mine && mine.audience !== "only_me" ? mine.audience : "team");
  const pc = useQuery({ queryKey: ["vibe-consent"], queryFn: () => api<VibeConsent>("/me/vibe/consent") });
  const sharingOn = pc.data?.status === "granted";
  const [agreed, setAgreed] = useState(false);
  const [tagText, setTagText] = useState(() => ({ a: tagsToText(init.tags ?? init.green), b: tagsToText(init.ick) }));
  const [busy, setBusy] = useState(false);
  const set = (patch: object) => setVal((x: object) => ({ ...x, ...patch }));
  const content = () => k === "interests" ? { tags: textToTags(tagText.a) } : k === "flags" ? { green: textToTags(tagText.a), ick: textToTags(tagText.b) } : val;
  const save = useMutation({
    mutationFn: () => api<{ consent: VibeConsent | null }>(`/me/vibe/${k}`, { method: "PUT", body: { content: content(), audience: aud, consent: aud !== "only_me" && !sharingOn ? consentBody() : undefined } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["vibe"] }); qc.invalidateQueries({ queryKey: ["vibe-me"] }); qc.invalidateQueries({ queryKey: ["privacy"] }); qc.invalidateQueries({ queryKey: ["team"] }); qc.invalidateQueries({ queryKey: ["vibe-consent"] });
      if (aud !== "only_me") playChime();
      celebrate(aud === "only_me" ? "Saved privately" : r.consent ? "Sharing is on" : "It's live", aud === "only_me" ? "Only you can see it" : r.consent ? `Consent receipt ${r.consent.receipt}` : `Visible to ${aud === "team" ? "your team" : "everyone at Complynz"}`, aud !== "only_me");
      onClose();
    },
  });
  const remove = useMutation({
    mutationFn: () => api(`/me/vibe/${k}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vibe"] }); qc.invalidateQueries({ queryKey: ["vibe-me"] }); qc.invalidateQueries({ queryKey: ["privacy"] }); onClose(); },
  });
  async function addPhotos(files: FileList | null) {
    if (!files) return; setBusy(true);
    try {
      const added: { fileId: string; caption: string }[] = [];
      for (const f of Array.from(files).slice(0, 8 - val.photos.length)) {
        const { blob, mime } = await squarePhoto(f, 1024);
        const r = await api<{ fileId: string }>("/me/vibe/photos", { body: { name: f.name, mime, dataBase64: await fileToBase64(blob) } });
        added.push({ fileId: r.fileId, caption: "" });
      }
      set({ photos: [...val.photos, ...added] });
    } catch (e) { alertErr(e); } finally { setBusy(false); }
  }
  const [err, alertErr] = useState<unknown>(null);
  const needsConsent = aud !== "only_me" && !sharingOn;
  const ready = !pc.isLoading && (!needsConsent || agreed);
  const T = (props: { label: string; value: string; onChange: (s: string) => void; area?: boolean; max?: number; placeholder?: string }) => (
    <label className="fld"><span>{props.label}</span>{props.area
      ? <textarea rows={4} maxLength={props.max} value={props.value} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} />
      : <input maxLength={props.max} value={props.value} placeholder={props.placeholder} onChange={(e) => props.onChange(e.target.value)} />}</label>);

  return (
    <Modal title={def.label} onClose={onClose}>
      <p className="k" style={{ marginTop: -6 }}>{def.hint}</p>
      {(k === "status" || k === "pronouns" || k === "ask") && T({ label: def.label, value: val.text, max: k === "status" ? 80 : k === "pronouns" ? 24 : 200, onChange: (x) => set({ text: x }), placeholder: k === "status" ? "Plotting a Ladakh road trip" : k === "pronouns" ? "she/her" : "Old film songs, momos, why forms need progress bars" })}
      {(k === "bio" || k === "family") && T({ label: def.label, area: true, value: val.text, max: k === "bio" ? 500 : 400, onChange: (x) => set({ text: x }) })}
      {k === "interests" && T({ label: "Interests, separated by commas", value: tagText.a, onChange: (x) => setTagText({ ...tagText, a: x }), placeholder: "Trekking, Filter coffee, Board games" })}
      {k === "flags" && <>{T({ label: "Green flags, separated by commas", value: tagText.a, onChange: (x) => setTagText({ ...tagText, a: x }), placeholder: "Meetings with agendas, Chai walks" })}
        {T({ label: "Gives me the ick, separated by commas", value: tagText.b, onChange: (x) => setTagText({ ...tagText, b: x }), placeholder: "Reply-all storms, Early flights" })}</>}
      {k === "sliders" && ([["Introvert", "Extrovert", "social"], ["Planner", "Spontaneous", "planning"], ["Chai", "Coffee", "drink"]] as const).map(([a, b, key]) =>
        <label key={key} className="fld"><span>{a} or {b}</span><input type="range" min={0} max={100} value={val[key]} onChange={(e) => set({ [key]: Number(e.target.value) })} style={{ padding: 0 }} /></label>)}
      {k === "music" && <>{T({ label: "Song", value: val.song, max: 120, onChange: (x) => set({ song: x }) })}{T({ label: "Artist", value: val.artist, max: 120, onChange: (x) => set({ artist: x }) })}</>}
      {k === "work" && <>{T({ label: "Best time to ping me", value: val.bestTime, max: 120, onChange: (x) => set({ bestTime: x }) })}{T({ label: "I do my best work when", value: val.bestWhen, max: 160, onChange: (x) => set({ bestWhen: x }) })}{T({ label: "Feedback style", value: val.feedback, max: 120, onChange: (x) => set({ feedback: x }) })}</>}
      {k === "reading" && <>
        {T({ label: "Book title", value: val.title, max: 160, onChange: (x) => set({ title: x }) })}{T({ label: "Author", value: val.author, max: 120, onChange: (x) => set({ author: x }) })}
        <label className="fld"><span>How far in: {val.progress}%</span><input type="range" min={0} max={100} value={val.progress} onChange={(e) => set({ progress: Number(e.target.value) })} style={{ padding: 0 }} /></label>
        <div className="fld"><span>Key quotes</span>
          {val.quotes.map((q: { id: string; text: string; note?: string }, i: number) => <div key={q.id} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <textarea rows={2} maxLength={400} value={q.text} aria-label={`Quote ${i + 1}`} onChange={(e) => set({ quotes: val.quotes.map((x: any) => x.id === q.id ? { ...x, text: e.target.value } : x) })} />
            <button className="gz-btn sm" onClick={() => set({ quotes: val.quotes.filter((x: any) => x.id !== q.id) })} aria-label={`Remove quote ${i + 1}`}>Remove</button></div>)}
          <button className="gz-btn sm" disabled={val.quotes.length >= 20} onClick={() => set({ quotes: [...val.quotes, { id: newId(), text: "" }] })}>+ Add a quote</button></div>
      </>}
      {k === "snaps" && <div className="fld"><span>Photos (up to 8)</span>
        <div className="gz-polgrid" style={{ padding: 0 }}>{val.photos.map((ph: { fileId: string; caption: string }) => <div key={ph.fileId} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div className="gz-pol" style={{ padding: 6 }}><SnapImg fileId={ph.fileId} alt={ph.caption || "Photo"} /></div>
          <input maxLength={80} placeholder="Caption" value={ph.caption} onChange={(e) => set({ photos: val.photos.map((x: any) => x.fileId === ph.fileId ? { ...x, caption: e.target.value } : x) })} />
          <button className="gz-btn sm" onClick={() => set({ photos: val.photos.filter((x: any) => x.fileId !== ph.fileId) })}>Remove</button></div>)}</div>
        {val.photos.length < 8 && <label className="gz-btn" style={{ marginTop: 10 }}>{busy ? "Uploading…" : "+ Add photos"}<input type="file" accept="image/png,image/jpeg,image/webp" multiple hidden onChange={(e) => addPhotos(e.target.files)} /></label>}
      </div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 18 }}>
        <b>Who can see it</b>
        <AudiencePicker value={aud} onChange={setAud} />
        {needsConsent ? <ConsentBox agreed={agreed} onChange={setAgreed} />
          : <span className="k">{aud === "only_me" ? "Only you will see this. You can share it later." : <>Sharing is on for your vibe page. Manage it in <Link href="/privacy">My privacy</Link>.</>}</span>}
        <ErrorNote error={save.error ?? remove.error ?? err} />
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {mine?.content && <button className="gz-btn" onClick={() => remove.mutate()} disabled={remove.isPending} style={{ color: "#b91c1c", marginRight: "auto" }}>Delete this card</button>}
          <button className="gz-btn" onClick={onClose}>Cancel</button>
          <button className="gz-btn primary" disabled={!ready || save.isPending || busy} onClick={() => save.mutate()}>{aud === "only_me" ? "Save privately" : "Publish"}</button>
        </div>
      </div>
    </Modal>
  );
}
