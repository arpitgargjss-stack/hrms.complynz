import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Card, Chip, ErrorNote, Field, Page } from "../lib/ui";

type Me = { email: string; employeeId: string | null; roles: string[] };
type Day = { date: string; working: boolean; holiday: string | null; onLeave: boolean; firstIn: string | null; lastOut: string | null; withinOffice: boolean | null; workedMinutes: number; punches: { kind: "in" | "out"; at: string; withinOffice: boolean | null }[] };
type Month = { month: string; workStart: string; workEnd: string; days: Day[] };
type PunchRes = { kind: "in" | "out"; at: string; withinOffice: boolean | null };
type Cal = { weeklyOff: number[]; saturdays: { mode: "all_working" | "all_off" | "alternate"; offWeeks?: number[] }; workStart: string; workEnd: string };
type Holiday = { id: string; date: string; name: string; optional: boolean | null };
type TeamRow = { employeeId: string; code: string; name: string; status?: string; firstIn?: string | null; lastOut?: string | null; workedMinutes?: number; workingDays?: number; present?: number; leave?: number; absent?: number };

const istToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const hm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" }) : "-");
const dur = (m: number) => (m ? `${Math.floor(m / 60)}h ${m % 60}m` : "-");
const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function where(w: boolean | null) { return w === true ? <Chip tone="ok">Inside office</Chip> : w === false ? <Chip tone="warn">Outside office</Chip> : <Chip>Not checked</Chip>; }

function getPosition(): Promise<{ lat?: number; lng?: number }> {
  // Asked once per punch. The coordinates go to the API in this request only and are never kept here.
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }), () => resolve({}), { timeout: 10000, maximumAge: 0 });
  });
}

function Mine() {
  const qc = useQueryClient();
  const [month, setMonth] = useState(istToday().slice(0, 7));
  const data = useQuery({ queryKey: ["myAttendance", month], queryFn: () => api<Month>(`/me/attendance?month=${month}`) });
  const cur = useQuery({ queryKey: ["myAttendance", istToday().slice(0, 7)], queryFn: () => api<Month>(`/me/attendance?month=${istToday().slice(0, 7)}`) });
  const [result, setResult] = useState<PunchRes | null>(null);
  const today = cur.data?.days.find((d) => d.date === istToday());
  const last = today?.punches[today.punches.length - 1];
  const next: "in" | "out" = last?.kind === "in" ? "out" : "in";
  const punch = useMutation({
    mutationFn: async () => { const pos = await getPosition(); return api<PunchRes>("/attendance/punch", { body: { kind: next, ...pos } }); },
    onSuccess: (r) => { setResult(r); qc.invalidateQueries({ queryKey: ["myAttendance"] }); },
  });
  return (
    <>
      <Card>
        <h2>Today, {istToday()}</h2>
        <p className="k">Punching asks your browser for your location once, only to check whether you are at the office. The location is not saved.</p>
        <button className="btn p" style={{ minWidth: 180 }} disabled={punch.isPending} onClick={() => { setResult(null); punch.mutate(); }}>{punch.isPending ? "Checking location…" : `Punch ${next}`}</button>
        <ErrorNote error={punch.error} />
        {result && <div className="note ok" role="status" style={{ marginTop: 12 }}>Punched {result.kind} at {hm(result.at)}. {where(result.withinOffice)}</div>}
        {today && today.punches.length > 0 && <p className="k">Today: {today.punches.map((p) => `${p.kind} ${hm(p.at)}`).join(", ")}</p>}
      </Card>
      <Card>
        <div className="row-gap" style={{ alignItems: "end", justifyContent: "space-between" }}><h2>Month</h2>
          <Field label="Month"><input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></Field></div>
        <ErrorNote error={data.error} />
        {data.data && <div style={{ overflowX: "auto" }}><table className="t"><thead><tr><th>Date</th><th>Status</th><th>In</th><th>Out</th><th>Worked</th><th>Location</th></tr></thead><tbody>
          {data.data.days.map((d) => <tr key={d.date}><td>{d.date}</td>
            <td>{d.holiday ? <Chip tone="info">{d.holiday}</Chip> : d.onLeave ? <Chip tone="info">Leave</Chip> : !d.working ? <Chip>Off</Chip> : d.firstIn ? <Chip tone="ok">Present</Chip> : d.date < istToday() ? <Chip tone="bad">Absent</Chip> : "-"}</td>
            <td>{hm(d.firstIn)}</td><td>{hm(d.lastOut)}</td><td>{dur(d.workedMinutes)}</td><td>{d.firstIn ? where(d.withinOffice) : "-"}</td></tr>)}
        </tbody></table></div>}
      </Card>
    </>
  );
}

function Team() {
  const [mode, setMode] = useState<"date" | "month">("date");
  const [date, setDate] = useState(istToday());
  const [month, setMonth] = useState(istToday().slice(0, 7));
  const q = useQuery({ queryKey: ["teamAttendance", mode, date, month], queryFn: () => api<{ rows: TeamRow[] }>(`/attendance?${mode === "date" ? "date=" + date : "month=" + month}`) });
  return (
    <Card>
      <div className="row-gap" style={{ alignItems: "end" }}>
        <Field label="View"><select value={mode} onChange={(e) => setMode(e.target.value as "date" | "month")}><option value="date">One day</option><option value="month">Month summary</option></select></Field>
        {mode === "date" ? <Field label="Date"><input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></Field>
          : <Field label="Month"><input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></Field>}
      </div>
      <ErrorNote error={q.error} />
      {q.data && (q.data.rows.length === 0 ? <p>No people in your view.</p> : <div style={{ overflowX: "auto" }}><table className="t">
        {mode === "date" ? <><thead><tr><th>Person</th><th>Status</th><th>In</th><th>Out</th><th>Worked</th></tr></thead><tbody>
          {q.data.rows.map((r) => <tr key={r.employeeId}><td>{r.name}<br /><span className="k">{r.code}</span></td>
            <td><Chip tone={r.status === "present" ? "ok" : r.status === "absent" ? "bad" : r.status === "leave" ? "info" : "mute"}>{r.status}</Chip></td><td>{hm(r.firstIn ?? null)}</td><td>{hm(r.lastOut ?? null)}</td><td>{dur(r.workedMinutes ?? 0)}</td></tr>)}</tbody></>
          : <><thead><tr><th>Person</th><th>Working days</th><th>Present</th><th>Leave</th><th>Absent</th></tr></thead><tbody>
            {q.data.rows.map((r) => <tr key={r.employeeId}><td>{r.name}<br /><span className="k">{r.code}</span></td><td>{r.workingDays}</td><td>{r.present}</td><td>{r.leave}</td><td>{r.absent}</td></tr>)}</tbody></>}
      </table></div>)}
    </Card>
  );
}

function CalendarSettings() {
  const qc = useQueryClient();
  const cal = useQuery({ queryKey: ["calendar"], queryFn: () => api<Cal>("/calendar") });
  const [f, setF] = useState<Cal | null>(null);
  const v = f ?? cal.data;
  const save = useMutation({ mutationFn: () => api<Cal>("/calendar", { method: "PUT", body: v }), onSuccess: () => { setF(null); qc.invalidateQueries({ queryKey: ["calendar"] }); } });
  if (!v) return <Card><ErrorNote error={cal.error} />Loading…</Card>;
  const toggle = (arr: number[], n: number) => (arr.includes(n) ? arr.filter((x) => x !== n) : [...arr, n].sort());
  return (
    <Card><h2>Working hours and weekly off</h2>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid"><Field label="Work starts"><input type="time" required value={v.workStart} onChange={(e) => setF({ ...v, workStart: e.target.value })} /></Field>
          <Field label="Work ends"><input type="time" required value={v.workEnd} onChange={(e) => setF({ ...v, workEnd: e.target.value })} /></Field></div>
        <fieldset style={{ border: 0, padding: 0, margin: "12px 0 0" }}><legend className="k">Weekly off days</legend>
          {DOW.map((d, i) => <label key={d} style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 44 }}><input type="checkbox" checked={v.weeklyOff.includes(i)} onChange={() => setF({ ...v, weeklyOff: toggle(v.weeklyOff, i) })} />{d}</label>)}</fieldset>
        <Field label="Saturdays"><select value={v.saturdays.mode} onChange={(e) => setF({ ...v, saturdays: { ...v.saturdays, mode: e.target.value as Cal["saturdays"]["mode"] } })}>
          <option value="all_working">All Saturdays are working</option><option value="all_off">All Saturdays are off</option><option value="alternate">Some Saturdays are off</option></select></Field>
        {v.saturdays.mode === "alternate" && <fieldset style={{ border: 0, padding: 0, margin: "12px 0 0" }}><legend className="k">Saturdays off (week of the month)</legend>
          <div className="row-gap">{[1, 2, 3, 4, 5].map((n) => <label key={n} style={{ display: "flex", gap: 8, alignItems: "center", minHeight: 44 }}>
            <input type="checkbox" checked={(v.saturdays.offWeeks ?? []).includes(n)} onChange={() => setF({ ...v, saturdays: { ...v.saturdays, offWeeks: toggle(v.saturdays.offWeeks ?? [], n) } })} />#{n}</label>)}</div></fieldset>}
        <ErrorNote error={save.error} />{save.isSuccess && !f && <div className="note ok" role="status">Saved.</div>}
        <p><button className="btn p" disabled={save.isPending}>Save calendar</button></p>
      </form>
    </Card>
  );
}

function Holidays() {
  const qc = useQueryClient();
  const [year, setYear] = useState(Number(istToday().slice(0, 4)));
  const [f, setF] = useState({ id: "", date: "", name: "", optional: false });
  const list = useQuery({ queryKey: ["holidays", year], queryFn: () => api<Holiday[]>(`/holidays?year=${year}`) });
  const done = () => { setF({ id: "", date: "", name: "", optional: false }); qc.invalidateQueries({ queryKey: ["holidays"] }); };
  const save = useMutation({ mutationFn: () => api(f.id ? `/holidays/${f.id}` : "/holidays", { method: f.id ? "PUT" : "POST", body: { date: f.date, name: f.name, optional: f.optional } }), onSuccess: done });
  const del = useMutation({ mutationFn: (id: string) => api(`/holidays/${id}`, { method: "DELETE" }), onSuccess: done });
  return (
    <Card><div className="row-gap" style={{ alignItems: "end", justifyContent: "space-between" }}><h2>Holidays</h2>
      <Field label="Year"><input type="number" min={2000} max={2100} value={year} onChange={(e) => setYear(Number(e.target.value) || year)} /></Field></div>
      <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid"><Field label="Date"><input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Name"><input required maxLength={100} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field></div>
        <label style={{ display: "flex", gap: 10, alignItems: "center", minHeight: 44 }}><input type="checkbox" checked={f.optional} onChange={(e) => setF({ ...f, optional: e.target.checked })} />Optional holiday</label>
        <ErrorNote error={save.error || del.error} />
        <p className="row-gap"><button className="btn p" disabled={save.isPending}>{f.id ? "Update holiday" : "Add holiday"}</button>{f.id && <button type="button" className="btn" onClick={done}>Cancel edit</button>}</p>
      </form>
      <div style={{ overflowX: "auto" }}><table className="t"><thead><tr><th>Date</th><th>Name</th><th>Type</th><th></th></tr></thead><tbody>
        {(list.data ?? []).map((h) => <tr key={h.id}><td>{h.date}</td><td>{h.name}</td><td>{h.optional ? <Chip>Optional</Chip> : <Chip tone="info">Fixed</Chip>}</td>
          <td className="row-gap"><button className="btn" onClick={() => setF({ id: h.id, date: h.date, name: h.name, optional: !!h.optional })}>Edit</button>
            <button className="btn" onClick={() => window.confirm(`Delete ${h.name}?`) && del.mutate(h.id)}>Delete</button></td></tr>)}
        {list.data && !list.data.length && <tr><td colSpan={4}>No holidays for {year}.</td></tr>}
      </tbody></table></div>
    </Card>
  );
}

export default function Attendance() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  const roles = me.data?.roles ?? [];
  const hr = roles.includes("hr_admin"), mgr = roles.includes("manager");
  const tabs = [{ k: "mine", l: "My attendance" }, ...(hr || mgr ? [{ k: "team", l: hr ? "Everyone" : "My team" }] : []), ...(hr ? [{ k: "calendar", l: "Work calendar" }, { k: "holidays", l: "Holidays" }] : [])];
  const [tab, setTab] = useState("mine");
  return (
    <Page title="Attendance">
      <div className="tabs" role="tablist">{tabs.map((t) => <button key={t.k} role="tab" aria-selected={tab === t.k} className={tab === t.k ? "on" : ""} onClick={() => setTab(t.k)}>{t.l}</button>)}</div>
      {tab === "mine" && <Mine />}{tab === "team" && <Team />}{tab === "calendar" && <CalendarSettings />}{tab === "holidays" && <Holidays />}
    </Page>
  );
}
