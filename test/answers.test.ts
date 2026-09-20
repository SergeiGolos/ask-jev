import test from "node:test";
import assert from "node:assert/strict";
import { formatPair, parseAnswer, parseQuestion, runTable, toneOf } from "../src/answers.ts";

test("formatPair shapes scores with legend labels, noul and choice", () => {
  const out = formatPair("src/a.ts", {
    answers: {
      severity: { type: "score", score: 2.4, legend: { "0": "none", "1": "minor", "2": "serious", "3": "critical" } },
      flag: { type: "noul", noul: 0.15 },
      queue: { type: "choice", choice: "backend" },
    },
  });
  assert.equal(out, "src/a.ts\n  severity 2.4 — serious\n  flag no (15%)\n  queue backend");
});

test("formatPair renders diffs against previous answers per answer type", () => {
  const out = formatPair(
    "src/a.ts",
    { answers: { sev: { type: "score", score: 3 }, flag: { type: "noul", noul: 0.2 }, q: { type: "choice", choice: "8" }, tag: { type: "choice", choice: "core" } } },
    { sev: { score: 1 }, flag: { noul: 0.5 }, q: { choice: "6" }, tag: { choice: "ui" } },
  );
  assert.equal(out, "src/a.ts\n  sev 3.0 (+2)\n  flag no (20%) (-30%)\n  q 8 (+2)\n  tag core (was: ui)");
  assert.equal(formatPair("src/a.ts", { answers: { sev: { score: 1 } } }, { sev: { score: 1 } }), "src/a.ts\n  sev 1.0 (=)");
  // no previous answers → identical to the no-diff form
  assert.equal(formatPair("src/a.ts", { answers: { sev: { score: 2 } } }), "src/a.ts\n  sev 2.0");
});

test("parseQuestion validates per type and names the id", () => {
  assert.equal(parseQuestion("s", { type: "score", instructions: "i", criteria: ["a", "b"] }, "t").type, "score");
  assert.throws(() => parseQuestion("s", { type: "score", instructions: "i", criteria: ["a"] }, "t"), /question 's'.*≥2/);
  assert.throws(() => parseQuestion("c", { type: "choice", instructions: "i", criteria: "x" }, "t"), /question 'c'/);
  assert.throws(() => parseQuestion("n", { type: "noul", instructions: "i", criteria: { true: 7 } }, "t"), /question 'n'/);
  assert.throws(() => parseQuestion("x", { type: "nope", instructions: "i" }, "t"), /score, choice, or noul/);
});

test("runTable aligns file rows under per-question columns with deltas", () => {
  const out = runTable([
    {
      file: "src/a.ts",
      response: { answers: { severity: { score: 3 }, flag: { noul: 0.08 } } },
      previous: { severity: { score: 1 }, flag: { noul: 0.5 } },
    },
    { file: "src/longer-name.ts", response: { answers: { severity: { score: 5 }, extra: { choice: "core" } } } },
  ]);
  assert.equal(
    out,
    [
      "FILE                SEVERITY  FLAG             EXTRA",
      "src/a.ts            3 (+2)    pass 92% (-42%)  —",
      "src/longer-name.ts  5         —                core",
    ].join("\n"),
  );
});

test("runTable colors cells by tone and omits codes when color is off", () => {
  const pairs = [{ file: "a.ts", response: { answers: { sev: { score: 8 }, bad: { score: 1 } } } }];
  const plain = runTable(pairs);
  assert.ok(!plain.includes("\x1b["));
  const colored = runTable(pairs, true);
  assert.ok(colored.includes("\x1b[32m")); // ok tone → green
  assert.ok(colored.includes("\x1b[31m1\x1b[0m")); // bad tone → red (last column, unpadded)
});

test("direction: low flips tone so low scores render healthy", () => {
  assert.equal(parseQuestion("v", { type: "score", instructions: "i", criteria: ["a", "b"], direction: "low" }, "t").direction, "low");
  assert.throws(
    () => parseQuestion("v", { type: "score", instructions: "i", criteria: ["a", "b"], direction: "up" }, "t"),
    /question 'v'.*'direction' must be high or low/,
  );

  // score: low is good, high is bad; default (high) unchanged
  assert.equal(parseAnswer("v", { score: 1 }, "low").tone, "ok");
  assert.equal(parseAnswer("v", { score: 5 }, "low").tone, "warn");
  assert.equal(parseAnswer("v", { score: 8 }, "low").tone, "bad");
  assert.equal(parseAnswer("v", { score: 8 }).tone, "ok");
  assert.equal(toneOf(9, "low"), "bad");

  // noul: direction high means true is good; default (low, true is bad) unchanged
  assert.equal(parseAnswer("w", { noul: 0.9 }, "high").tone, "ok");
  assert.equal(parseAnswer("w", { noul: 0.1 }, "high").tone, "bad");
  assert.equal(parseAnswer("w", { noul: 0.9 }).tone, "bad");
});

test("runTable colors low-direction cells by inverted tone", () => {
  const colored = runTable(
    [{ file: "a.ts", response: { answers: { violations: { score: 1 } } }, directions: { violations: "low" } }],
    true,
  );
  assert.ok(colored.includes("\x1b[32m1\x1b[0m")); // 1 violation → green, not red
});
