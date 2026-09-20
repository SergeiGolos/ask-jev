import test from "node:test";
import assert from "node:assert/strict";
import { parseAnswer } from "../src/answers.ts";
import { aggregateCell, parseAnswers } from "../src/scoring.ts";

test("parseAnswers returns [] for responses without an answers record", () => {
  assert.deepEqual(parseAnswers(undefined), []);
  assert.deepEqual(parseAnswers(null), []);
  assert.deepEqual(parseAnswers("nope"), []);
  assert.deepEqual(parseAnswers({}), []);
  assert.deepEqual(parseAnswers({ answers: [1, 2] }), []);
});

test("parseAnswers parses each entry and honors per-question directions", () => {
  const parsed = parseAnswers(
    { answers: { high_q: { score: 8 }, low_q: { score: 3 } } },
    { low_q: "low" },
  );
  assert.equal(parsed.length, 2);
  const high = parsed.find((a) => a.q === "high_q")!;
  const low = parsed.find((a) => a.q === "low_q")!;
  assert.equal(high.numeric, 8);
  assert.equal(high.tone, "ok"); // high direction: ≥7 ok
  assert.equal(low.numeric, 3);
  assert.equal(low.tone, "ok"); // low direction: ≤3 ok
});

test("parseAnswers throws on a malformed entry", () => {
  assert.throws(() => parseAnswers({ answers: { q: "not a record" } }), /invalid answer for 'q'/);
  assert.throws(() => parseAnswers({ answers: { q: {} } }), /missing score, choice, or noul/);
});

test("aggregateCell passes a single answer through", () => {
  const a = parseAnswer("q", { score: 8 });
  assert.deepEqual(aggregateCell([a]), { value: 8, display: "8", tone: "ok", count: 1 });
});

test("aggregateCell averages numeric answers with spread and tone thresholds", () => {
  const ok = aggregateCell([parseAnswer("q", { score: 8 }), parseAnswer("q", { score: 6 })]);
  assert.deepEqual(ok, { value: 7, display: "7 (n=2)", tone: "ok", count: 2, min: 6, max: 8 });

  const warn = aggregateCell([parseAnswer("q", { score: 7 }), parseAnswer("q", { score: 5 })]);
  assert.equal(warn.tone, "warn");

  const bad = aggregateCell([parseAnswer("q", { score: 2 }), parseAnswer("q", { score: 2 })]);
  assert.deepEqual(bad, { value: 2, display: "2 (n=2)", tone: "bad", count: 2, min: 2, max: 2 });

  const fraction = aggregateCell([parseAnswer("q", { score: 7 }), parseAnswer("q", { score: 8 })]);
  assert.equal(fraction.display, "7.5 (n=2)");
});

test("aggregateCell counts only numeric answers when mixed with non-numeric ones", () => {
  const agg = aggregateCell([parseAnswer("q", { score: 8 }), parseAnswer("q", { choice: "yes" })]);
  assert.deepEqual(agg, { value: 8, display: "8 (n=1)", tone: "ok", count: 1, min: 8, max: 8 });
});

test("aggregateCell mutes when no answer has a numeric value", () => {
  const agg = aggregateCell([parseAnswer("q", { choice: "yes" }), parseAnswer("q", { choice: "no" })]);
  assert.deepEqual(agg, { value: null, display: "yes (n=2)", tone: "mut", count: 2 });
});

test("aggregateCell keeps a single low-direction answer's tone", () => {
  const a = parseAnswer("q", { score: 3 }, "low");
  assert.equal(a.tone, "ok");
  assert.equal(aggregateCell([a]).tone, "ok");
});
