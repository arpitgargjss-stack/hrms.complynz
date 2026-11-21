import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Avatar, hashColor } from "./OrgAvatar";
import { ErrorNote, Page } from "../lib/ui";
import "./orgchart.css";

type N = { id: string; name: string; code: string; designation: string | null; department: string | null; photoFileId?: string | null; children: N[] };

const STACK_AT = 4; // a manager with this many reports, none of whom manage anyone, gets a compact grid
const MIN_Z = 0.2, MAX_Z = 2;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function walk(nodes: N[], f: (n: N, depth: number, parent: N | null) => void, depth = 0, parent: N | null = null) {
  for (const n of nodes) { f(n, depth, parent); walk(n.children, f, depth + 1, n); }
}
function teamSize(n: N): number { return n.children.reduce((s, c) => s + 1 + teamSize(c), 0); }

function Card({ n, mini, hit }: { n: N; mini?: boolean; hit: boolean }) {
  const dc = n.department ? hashColor(n.department) : null;
  const style = { "--dc": dc ? dc[1] : undefined } as CSSProperties;
  const sub = n.designation || n.code;
  return (
    <div className={`oc-card${mini ? " mini" : ""}${hit ? " hit" : ""}`} style={style} data-oc={n.id}>
      <div className="ph"><Avatar name={n.name} photoFileId={n.photoFileId} size={mini ? 40 : 64} /></div>
      <div className="tx">
        <Link className="nm" href={`/people/${n.id}`} title={n.name}>{n.name}</Link>
        <div className="ds" title={sub}>{sub}</div>
        {n.department && !mini && <span className="dp" style={{ background: dc![0], color: dc![1] }}>{n.department}</span>}
        {n.department && mini && <div className="k" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{n.department}</div>}
      </div>
    </div>
  );
}

function Branch({ n, open, toggle, hit }: { n: N; open: Set<string>; toggle: (id: string) => void; hit: string | null }) {
  const has = n.children.length > 0;
  const isOpen = has && open.has(n.id);
  const stack = n.children.length >= STACK_AT && n.children.every((c) => c.children.length === 0);
  const cols = Math.min(4, Math.ceil(Math.sqrt(n.children.length)));
  return (
    <li className={has ? "has-tog" : undefined}>
      <div style={{ position: "relative" }}>
        <Card n={n} hit={hit === n.id} />
        {has && (
          <button className={`oc-tog${isOpen ? "" : " closed"}`} aria-expanded={isOpen}
            aria-label={`${isOpen ? "Collapse" : "Expand"} ${n.name}'s team, ${n.children.length} direct report${n.children.length > 1 ? "s" : ""}`}
            onClick={() => toggle(n.id)} onPointerDown={(e) => e.stopPropagation()}>
            {isOpen ? "−" : `+${teamSize(n)}`}
          </button>
        )}
      </div>
      {isOpen && (stack ? (
        <>
          <div className="oc-drop" />
          <div className="oc-stackbox" role="list" aria-label={`${n.name}'s direct reports`} style={{ gridTemplateColumns: `repeat(${cols}, auto)` }}>
            {n.children.map((c) => <div role="listitem" key={c.id}><Card n={c} mini hit={hit === c.id} /></div>)}
          </div>
        </>
      ) : (
        <ul aria-label={`${n.name}'s direct reports`}>{n.children.map((c) => <Branch key={c.id} n={c} open={open} toggle={toggle} hit={hit} />)}</ul>
      ))}
    </li>
  );
}

export default function OrgChart() {
  const q = useQuery({ queryKey: ["org-chart"], queryFn: () => api<{ tree: N[] }>("/org-chart") });
  const tree = q.data?.tree;

  const index = useMemo(() => {
    const parent = new Map<string, string | null>(); const all: N[] = []; const managers: string[] = [];
    if (tree) walk(tree, (n, _d, p) => { parent.set(n.id, p?.id ?? null); all.push(n); if (n.children.length) managers.push(n.id); });
    return { parent, all, managers };
  }, [tree]);

  const [open, setOpen] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(0);
  useEffect(() => {
    if (!tree) return;
    // Small orgs open fully; larger ones open the top two levels.
    const s = new Set<string>();
    const small = index.all.length <= 40;
    walk(tree, (n, d) => { if (n.children.length && (small || d < 2)) s.add(n.id); });
    setOpen(s); setReady((r) => r + 1);
  }, [tree, index]);
  const toggle = useCallback((id: string) => setOpen((s) => { const t = new Set(s); if (t.has(id)) t.delete(id); else t.add(id); return t; }), []);

  // ---- pan & zoom ----
  const view = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ x: 0, y: 0, z: 1 });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; id: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const fit = useCallback(() => {
    const v = view.current, c = canvas.current; if (!v || !c) return;
    const vw = v.clientWidth, vh = v.clientHeight, cw = c.offsetWidth, ch = c.offsetHeight;
    const z = clamp(Math.min(1, vw / cw, vh / ch), MIN_Z, MAX_Z);
    setT({ z, x: (vw - cw * z) / 2, y: Math.max(0, (vh - ch * z) / 2) });
  }, []);
  useLayoutEffect(() => { if (ready) fit(); }, [ready, fit]); // fit once the initial expansion has rendered

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const v = view.current; if (!v) return;
    const px = cx ?? v.clientWidth / 2, py = cy ?? v.clientHeight / 2;
    setT((p) => { const z = clamp(p.z * factor, MIN_Z, MAX_Z); const k = z / p.z; return { z, x: px - (px - p.x) * k, y: py - (py - p.y) * k }; });
  }, []);

  useEffect(() => {
    const v = view.current; if (!v) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = v.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.0025), e.clientX - r.left, e.clientY - r.top);
      else setT((p) => ({ ...p, x: p.x - (e.shiftKey ? e.deltaY : e.deltaX), y: p.y - (e.shiftKey ? 0 : e.deltaY) }));
    };
    v.addEventListener("wheel", onWheel, { passive: false });
    return () => v.removeEventListener("wheel", onWheel);
  }, [zoomAt, tree]);

  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("a,button,input")) return;
    drag.current = { x: e.clientX, y: e.clientY, ox: t.x, oy: t.y, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId); setDragging(true);
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (!d || d.id !== e.pointerId) return;
    setT((p) => ({ ...p, x: d.ox + e.clientX - d.x, y: d.oy + e.clientY - d.y }));
  };
  const onUp = () => { drag.current = null; setDragging(false); };
  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const step = 60, map: Record<string, () => void> = {
      ArrowLeft: () => setT((p) => ({ ...p, x: p.x + step })), ArrowRight: () => setT((p) => ({ ...p, x: p.x - step })),
      ArrowUp: () => setT((p) => ({ ...p, y: p.y + step })), ArrowDown: () => setT((p) => ({ ...p, y: p.y - step })),
      "+": () => zoomAt(1.2), "=": () => zoomAt(1.2), "-": () => zoomAt(1 / 1.2), "0": fit,
    };
    const f = map[e.key]; if (f) { e.preventDefault(); f(); }
  };

  // ---- find a person ----
  const [qs, setQs] = useState("");
  const [hit, setHit] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const matches = useMemo(() => {
    const s = qs.trim().toLowerCase(); if (!s) return [];
    return index.all.filter((n) => [n.name, n.code, n.designation, n.department].some((x) => x?.toLowerCase().includes(s))).slice(0, 8);
  }, [qs, index]);
  const focus = (id: string) => {
    setOpen((s) => { const t2 = new Set(s); let p = index.parent.get(id); while (p) { t2.add(p); p = index.parent.get(p); } return t2; });
    setHit(id); setPending(id); setQs("");
  };
  useLayoutEffect(() => {
    if (!pending) return;
    const v = view.current, c = canvas.current, el = c?.querySelector<HTMLElement>(`[data-oc="${pending}"]`);
    if (!v || !c || !el) return;
    const cr = c.getBoundingClientRect(), er = el.getBoundingClientRect();
    setT((p) => {
      const z = Math.max(p.z, 0.8);
      const ex = (er.left - cr.left + er.width / 2) / p.z, ey = (er.top - cr.top + er.height / 2) / p.z;
      return { z, x: v.clientWidth / 2 - ex * z, y: v.clientHeight / 2 - ey * z };
    });
    el.querySelector<HTMLElement>("a")?.focus({ preventScroll: true });
    setPending(null);
  }, [pending, open]);
  useEffect(() => { if (!hit) return; const h = setTimeout(() => setHit(null), 2500); return () => clearTimeout(h); }, [hit]);

  const people = index.all.length;
  return (
    <Page title="Org chart">
      <ErrorNote error={q.error} />
      {q.isLoading && <p>Loading…</p>}
      {tree && tree.length === 0 && <div className="card"><p>No employees yet.</p></div>}
      {tree && tree.length > 0 && (
        <>
          <div className="oc-bar">
            <div style={{ position: "relative", flex: "1 1 220px", maxWidth: 320 }}>
              <input className="in" type="search" placeholder="Find a person, team or role" aria-label="Find a person in the org chart" value={qs}
                onChange={(e) => setQs(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && matches[0]) focus(matches[0].id); }} />
              {matches.length > 0 && (
                <ul role="listbox" style={{ position: "absolute", zIndex: 5, top: "100%", left: 0, right: 0, margin: "4px 0 0", padding: 4, listStyle: "none", background: "#fff", border: "1px solid #c9cfe0", borderRadius: 8, boxShadow: "0 6px 18px rgba(26,32,54,.12)" }}>
                  {matches.map((m) => (
                    <li key={m.id} role="option" aria-selected={false}>
                      <button type="button" onClick={() => focus(m.id)} style={{ display: "flex", gap: 10, alignItems: "center", width: "100%", padding: 8, border: 0, background: "none", font: "inherit", textAlign: "left", cursor: "pointer", borderRadius: 6 }}>
                        <Avatar name={m.name} photoFileId={m.photoFileId} size={28} />
                        <span style={{ minWidth: 0 }}><span style={{ display: "block", fontSize: 14 }}>{m.name}</span><span className="k">{[m.designation, m.department].filter(Boolean).join(" · ") || m.code}</span></span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <button className="btn" onClick={() => setOpen(new Set(index.managers))}>Expand all</button>
            <button className="btn" onClick={() => setOpen(new Set())}>Collapse all</button>
            <button className="btn" onClick={fit}>Fit to screen</button>
            <span className="k">{people} {people === 1 ? "person" : "people"}</span>
          </div>
          <div ref={view} className={`oc-view${dragging ? " drag" : ""}`} tabIndex={0} aria-label="Org chart. Drag or use arrow keys to move, Ctrl and scroll or plus and minus to zoom, 0 to fit."
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}>
            <div ref={canvas} className="oc-canvas" style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.z})` }}>
              <div className="oc">
                <ul aria-label="Reporting lines">{tree.map((n) => <Branch key={n.id} n={n} open={open} toggle={toggle} hit={hit} />)}</ul>
              </div>
            </div>
            <div className="oc-zoom" onPointerDown={(e) => e.stopPropagation()}>
              <button aria-label="Zoom in" onClick={() => zoomAt(1.2)}>+</button>
              <button aria-label="Zoom out" onClick={() => zoomAt(1 / 1.2)}>−</button>
              <button aria-label="Fit to screen" onClick={fit} style={{ fontSize: 14 }}>⤢</button>
            </div>
            <div className="oc-pct" aria-hidden>{Math.round(t.z * 100)}%</div>
          </div>
        </>
      )}
    </Page>
  );
}
