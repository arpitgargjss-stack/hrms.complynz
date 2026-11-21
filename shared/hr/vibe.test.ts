import test from "node:test";
import assert from "node:assert/strict";
import { canSeeSection, consentProblem, consentInput, commonTags, sameTeam, widens, feedPostInput, VIBE_SECTIONS } from "./vibe";
import { startStreak, longWeekendTips, isoWeek, kudosInput } from "./buzz";
import type { CalendarSettings } from "./leave";

test("vibe: one page consent covers every card; only-me never needs it", () => {
  assert.equal(consentProblem("only_me", false), null);
  assert.match(consentProblem("team", false)!, /Turn on sharing/);
  assert.match(consentProblem("everyone", false)!, /Turn on sharing/);
  assert.equal(consentProblem("everyone", true), null);
  assert.equal(consentInput.safeParse({ agreed: true, noticeVersion: "vibe-v2" }).success, true);
  assert.equal(consentInput.safeParse({ agreed: false, noticeVersion: "vibe-v2" }).success, false);
  assert.equal(VIBE_SECTIONS.snaps.others && VIBE_SECTIONS.family.others && !VIBE_SECTIONS.bio.others, true);
});

test("vibe: visibility follows audience and the latest consent; HR gets nothing extra", () => {
  const other = { self: false, sameTeam: false }, mate = { self: false, sameTeam: true };
  assert.equal(canSeeSection("everyone", true, other), true);
  assert.equal(canSeeSection("everyone", false, other), false, "withdrawn consent hides it");
  assert.equal(canSeeSection("team", true, other), false);
  assert.equal(canSeeSection("team", true, mate), true);
  assert.equal(canSeeSection("only_me", true, mate), false);
  assert.equal(canSeeSection("only_me", false, { self: true, sameTeam: true }), true);
});

test("vibe: team, widening and shared interests", () => {
  const a = { id: "a", departmentId: "d1", managerId: "m" }, b = { id: "b", departmentId: "d1", managerId: null }, c = { id: "c", departmentId: "d2", managerId: "a" };
  assert.equal(sameTeam(a, b), true); assert.equal(sameTeam(a, c), true); assert.equal(sameTeam(b, c), false);
  assert.equal(widens("team", "everyone"), true); assert.equal(widens("everyone", "team"), false); assert.equal(widens(null, "team"), true);
  assert.deepEqual(commonTags(["Trekking", "chai"], ["Chai", "Cricket", "trekking"]), ["Chai", "trekking"]);
});

test("feed: links must be https and LinkedIn posts must be on linkedin.com", () => {
  assert.equal(feedPostInput.safeParse({ kind: "article", audience: "team", url: "http://x.com/a" }).success, false);
  assert.equal(feedPostInput.safeParse({ kind: "article", audience: "team", url: "https://x.com/a" }).success, true);
  assert.equal(feedPostInput.safeParse({ kind: "linkedin", audience: "team", url: "https://evil.com/linkedin.com" }).success, false);
  assert.equal(feedPostInput.safeParse({ kind: "linkedin", audience: "everyone", url: "https://www.linkedin.com/posts/x" }).success, true);
  assert.equal(feedPostInput.safeParse({ kind: "quote", audience: "team" }).success, false);
  assert.equal(feedPostInput.safeParse({ kind: "quote", audience: "team", quote: "Hi" }).success, true);
  assert.equal(feedPostInput.safeParse({ kind: "quote", audience: "team", quote: "Hi", consent: { agreed: true } }).success, false, "no consent field any more");
  assert.equal(kudosInput.safeParse({ toEmployeeId: "00000000-0000-4000-8000-000000000000", value: "Ownership", message: "Thanks!" }).success, true);
});

const cal: CalendarSettings = { weeklyOff: [0], saturdays: { mode: "all_off" }, workStart: "09:30", workEnd: "18:30" };
test("streak: weekends, holidays and leave pause it; a missed working day ends it; today counts once punched", () => {
  // 2026-11-16 Mon .. 2026-11-20 Fri, 2026-11-23 Mon
  const punched = new Set(["2026-11-13", "2026-11-16", "2026-11-17", "2026-11-19", "2026-11-23"]);
  const leave = (d: string) => d === "2026-11-18";
  const hol = [{ date: "2026-11-20" }];
  assert.equal(startStreak("2026-11-23", punched, leave, cal, hol), 5);
  assert.equal(startStreak("2026-11-24", punched, leave, cal, hol), 5, "not punched yet today keeps yesterday's streak");
  assert.equal(startStreak("2026-11-25", punched, leave, cal, hol), 0, "missed a working day");
});

test("long weekend: a Tuesday holiday suggests taking Monday", () => {
  const tips = longWeekendTips("2026-11-01", cal, [{ date: "2026-12-01", name: "Demo day" }]);
  assert.equal(tips[0].take.join(), "2026-11-30");
  assert.equal(tips[0].daysOff, 4);
  assert.equal(isoWeek("2026-11-21"), "2026-W47");
});
