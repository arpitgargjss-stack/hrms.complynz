import { z } from "zod";

/** Who can see a vibe page section. "only_me" is a private draft and needs no consent. */
export const AUDIENCES = ["only_me", "team", "everyone"] as const;
export type Audience = (typeof AUDIENCES)[number];
export const AUDIENCE_LABEL: Record<Audience, string> = { only_me: "Only me", team: "My team", everyone: "Everyone at Complynz" };
const AUD_RANK: Record<Audience, number> = { only_me: 0, team: 1, everyone: 2 };

const line = (max: number) => z.string().trim().max(max);
const tags = (n: number) => z.array(z.string().trim().min(1).max(40)).max(n);
const pct = z.number().int().min(0).max(100);

/**
 * Vibe page sections. Older events used one consent purpose per card (`vibe_<key>`); those stay in
 * the history, and `vibePurpose` is kept only to label them. `others` marks sections that can show
 * or mention other people; the single page consent covers confirming those people agreed and none is a child.
 */
export const VIBE_SECTIONS = {
  status: { label: "Currently", hint: "What you're up to, in one line", others: false, schema: z.object({ text: line(80) }).strict() },
  pronouns: { label: "Pronouns", hint: "Optional, shown next to your name", others: false, schema: z.object({ text: line(24) }).strict() },
  bio: { label: "In my own words", hint: "A few lines about you", others: false, schema: z.object({ text: line(500) }).strict() },
  interests: { label: "Into", hint: "Hobbies and interests, used to find what you have in common", others: false, schema: z.object({ tags: tags(15) }).strict() },
  flags: { label: "Green flags and the ick", hint: "What you love and what you don't", others: false, schema: z.object({ green: tags(10), ick: tags(10) }).strict() },
  sliders: { label: "Vibe check", hint: "Introvert or extrovert, planner or spontaneous, chai or coffee", others: false, schema: z.object({ social: pct, planning: pct, drink: pct }).strict() },
  music: { label: "On repeat", hint: "The song you can't stop playing", others: false, schema: z.object({ song: line(120), artist: line(120) }).strict() },
  reading: {
    label: "Currently reading", hint: "Your book and the lines that stuck", others: false,
    schema: z.object({
      title: line(160), author: line(120), progress: pct,
      quotes: z.array(z.object({ id: z.string().regex(/^[a-z0-9]{6,16}$/), text: z.string().trim().min(1).max(400), note: line(120).optional() }).strict()).max(20),
    }).strict(),
  },
  snaps: {
    label: "Snaps", hint: "Trips, pets and weekends", others: true,
    schema: z.object({ photos: z.array(z.object({ fileId: z.string().uuid(), caption: line(80) }).strict()).max(8) }).strict(),
  },
  family: { label: "My people", hint: "Family, partner, pets: only what they're happy to share", others: true, schema: z.object({ text: line(400) }).strict() },
  work: { label: "How to work with me", hint: "Best time to reach you, how you like feedback", others: false, schema: z.object({ bestTime: line(120), bestWhen: line(160), feedback: line(120) }).strict() },
  ask: { label: "Ask me about", hint: "Conversation starters", others: false, schema: z.object({ text: line(200) }).strict() },
} as const;
export type VibeSectionKey = keyof typeof VIBE_SECTIONS;
export const VIBE_SECTION_KEYS = Object.keys(VIBE_SECTIONS) as VibeSectionKey[];
export const isVibeSection = (k: string): k is VibeSectionKey => Object.prototype.hasOwnProperty.call(VIBE_SECTIONS, k);
export const vibePurpose = (k: VibeSectionKey) => `vibe_${k}`;
export const FEED_PURPOSE = "feed_post";

/**
 * One consent covers the whole vibe page. Each card still has its own audience, but there is no
 * per-card consent: turning sharing on (or off) applies to every card at once.
 */
export const VIBE_PURPOSE = "vibe_page";
/** Privacy notice version the vibe page consent refers to. */
export const VIBE_NOTICE_VERSION = "vibe-v2";

/** The person's own tick for the vibe page consent, never pre-filled by the client. */
export const consentInput = z.object({
  agreed: z.literal(true, { errorMap: () => ({ message: "Tick the box to turn on sharing for your vibe page" }) }),
  noticeVersion: z.string().trim().min(1).max(40),
}).strict();

/** What a save needs before a card can be shared beyond "only me". Returns an error message, or null when fine. */
export function consentProblem(audience: Audience, pageGranted: boolean): string | null {
  if (audience === "only_me" || pageGranted) return null;
  return "Turn on sharing for your vibe page first";
}

/** Can `viewer` see a section that `owner` shared with `audience`? HR has no extra access here. */
export function canSeeSection(audience: Audience, granted: boolean, rel: { self: boolean; sameTeam: boolean }): boolean {
  if (rel.self) return true;
  if (!granted) return false;
  if (audience === "everyone") return true;
  if (audience === "team") return rel.sameTeam;
  return false;
}

/** Widening who can see something always needs a fresh consent; narrowing it does not. */
export const widens = (from: Audience | null, to: Audience) => AUD_RANK[to] > AUD_RANK[from ?? "only_me"];

/** Same team: same department, or one manages the other. */
export function sameTeam(a: { id: string; departmentId: string | null; managerId: string | null }, b: { id: string; departmentId: string | null; managerId: string | null }): boolean {
  if (a.id === b.id) return true;
  if (a.departmentId && a.departmentId === b.departmentId) return true;
  return a.managerId === b.id || b.managerId === a.id;
}

const norm = (t: string) => t.trim().toLowerCase();
/** Interests two people share, compared case-insensitively, in the first person's spelling. */
export function commonTags(mine: readonly string[], theirs: readonly string[]): string[] {
  const set = new Set(mine.map(norm));
  const out: string[] = [];
  for (const t of theirs) if (set.has(norm(t)) && !out.some((o) => norm(o) === norm(t))) out.push(t);
  return out;
}

/** Short, human receipt number for a consent event id. */
export const receiptNo = (eventId: string, at: Date | string) => `CR-${new Date(at).toISOString().slice(0, 7)}-${eventId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

// ---------- team feed ----------
export const FEED_KINDS = ["quote", "ai_news", "article", "linkedin"] as const;
export type FeedKind = (typeof FEED_KINDS)[number];
export const FEED_KIND_LABEL: Record<FeedKind, string> = { quote: "Quote", ai_news: "AI news", article: "Article", linkedin: "LinkedIn" };
export const FEED_AUDIENCES = ["team", "everyone"] as const;
export const REACTIONS = ["clap", "mind", "save"] as const;

const httpsUrl = z.string().trim().max(600).url().refine((u) => { try { return new URL(u).protocol === "https:"; } catch { return false; } }, "Links must start with https://");
export const feedPostInput = z.object({
  kind: z.enum(FEED_KINDS), audience: z.enum(FEED_AUDIENCES),
  quote: line(400).optional(), source: line(160).optional(),
  url: httpsUrl.optional(), title: line(200).optional(), note: line(280).optional(),
}).strict().superRefine((v, ctx) => {
  if (v.kind === "quote" && !v.quote) ctx.addIssue({ code: "custom", path: ["quote"], message: "Add the quote" });
  if (v.kind !== "quote" && !v.url) ctx.addIssue({ code: "custom", path: ["url"], message: "Add the link" });
  if (v.kind === "linkedin" && v.url && !/(^|\.)linkedin\.com$/i.test(new URL(v.url).hostname)) ctx.addIssue({ code: "custom", path: ["url"], message: "That isn't a linkedin.com link" });
});

/** Host name shown under a shared link; links are never fetched by the server. */
export const linkHost = (u: string | null | undefined) => { try { return u ? new URL(u).hostname.replace(/^www\./, "") : null; } catch { return null; } };
