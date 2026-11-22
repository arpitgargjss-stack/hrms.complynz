import test from "node:test";
import assert from "node:assert/strict";
import { WELLBEING_INDEXES, pulseInput, careInput, isLowAnswer, toIndex } from "./buzz";

test("wellbeing: three indexes, five options each, Happy Index keeps the mood column", () => {
  assert.deepEqual(WELLBEING_INDEXES.map((x) => x.name), ["Stressometer", "Happy Index", "Motivation Index"]);
  assert.equal(WELLBEING_INDEXES.find((x) => x.name === "Happy Index")!.key, "mood");
  for (const x of WELLBEING_INDEXES) assert.equal(x.scale.length, 5);
  // 5 is the good end on every scale, Stressometer included
  assert.equal(WELLBEING_INDEXES[0].scale[4], "Calm");
});

test("wellbeing: low means 1 or 2", () => {
  assert.equal(isLowAnswer(1), true); assert.equal(isLowAnswer(2), true);
  assert.equal(isLowAnswer(3), false); assert.equal(isLowAnswer(undefined), false);
});

test("wellbeing: averages become an index out of 100", () => {
  assert.equal(toIndex(1), 0); assert.equal(toIndex(3), 50); assert.equal(toIndex(5), 100); assert.equal(toIndex(3.4), 60);
  assert.equal(toIndex(null), null);
});

test("wellbeing: all three answers are needed, nothing else is accepted", () => {
  assert.ok(pulseInput.safeParse({ stress: 2, mood: 4, motivation: 3 }).success);
  assert.ok(!pulseInput.safeParse({ mood: 4 }).success);
  assert.ok(!pulseInput.safeParse({ stress: 2, mood: 4, motivation: 3, employeeId: "x" }).success);
  assert.ok(!pulseInput.safeParse({ stress: 0, mood: 4, motivation: 6 }).success);
});

test("wellbeing: a counselling request names manager or CEO only, and carries no check-in answers", () => {
  assert.ok(careInput.safeParse({ with: "manager", mode: "call", when: "This week" }).success);
  assert.ok(!careInput.safeParse({ with: "hr", mode: "call", when: "This week" }).success);
  assert.ok(!careInput.safeParse({ with: "ceo", mode: "call", when: "This week", stress: 1 }).success);
  assert.ok(!careInput.safeParse({ with: "ceo", mode: "call", when: "This week", note: "x".repeat(501) }).success);
});
