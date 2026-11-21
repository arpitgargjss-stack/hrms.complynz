import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

/** Notification chime ("Soft bell"), made with Web Audio: no audio files. */
const KEY = "hrms.sound";
const MASTER = 0.6;
const QUIET = ["/payroll", "/payslips", "/exits"]; // never chime on pay, PIP or exit screens

let ctx: AudioContext | null = null;
let primed = false;
function context(): AudioContext | null {
  try { ctx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)(); } catch { return null; }
  return ctx;
}
/** Browsers only start audio after a user gesture, so resume the shared context on the first one. */
function prime() {
  if (primed) return; primed = true;
  const go = () => { context()?.resume().catch(() => {}); window.removeEventListener("pointerdown", go); window.removeEventListener("keydown", go); };
  window.addEventListener("pointerdown", go); window.addEventListener("keydown", go);
}
if (typeof window !== "undefined") prime();

export function soundOn(): boolean { try { return localStorage.getItem(KEY) !== "off"; } catch { return true; } }
const listeners = new Set<(on: boolean) => void>();
export function setSound(on: boolean) { try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* private mode */ } listeners.forEach((f) => f(on)); }
export function useSound(): [boolean, (on: boolean) => void] {
  const [on, set] = useState(soundOn);
  useEffect(() => { listeners.add(set); return () => { listeners.delete(set); }; }, []);
  return [on, setSound];
}

export function playChime() {
  if (!soundOn() || document.hidden || QUIET.some((p) => location.pathname.startsWith(p))) return;
  const ac = context();
  if (!ac) return;
  if (ac.state === "running") ring(ac); else ac.resume().then(() => ring(ac)).catch(() => {});
}
function ring(ac: AudioContext) {
  const now = ac.currentTime;
  const tone = (f: number, type: OscillatorType, start: number, dur: number, gain: number) => {
    const o = ac.createOscillator(), g = ac.createGain(), t = now + start;
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain * MASTER, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.05);
  };
  tone(784, "triangle", 0, 0.7, 0.4); tone(1568, "sine", 0, 0.5, 0.06);
  tone(1175, "triangle", 0.16, 0.9, 0.38); tone(2350, "sine", 0.16, 0.6, 0.05);
}

/**
 * Chime when items from someone else arrive that are newer than anything seen since this page opened.
 * The first load only sets the baseline, so opening a page never chimes.
 */
export function useNewItemChime<T>(items: T[] | undefined, createdAt: (t: T) => string | Date, authorId: (t: T) => string) {
  const qc = useQueryClient();
  const seen = useRef<number | null>(null);
  useEffect(() => {
    if (!items) return;
    const times = items.map((i) => new Date(createdAt(i)).getTime());
    const latest = Math.max(0, ...times);
    if (seen.current === null) { seen.current = latest; return; }
    const me = qc.getQueryData<{ employeeId: string | null }>(["me"])?.employeeId;
    const fresh = items.filter((i, n) => times[n] > seen.current! && authorId(i) !== me);
    if (latest > seen.current) seen.current = latest;
    if (fresh.length) playChime();
  }, [items]); // eslint-disable-line react-hooks/exhaustive-deps
}
export const POLL_MS = 60_000;
