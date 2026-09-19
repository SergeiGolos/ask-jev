import test from "node:test";
import assert from "node:assert/strict";
import { formatPair, parseQuestion } from "../src/answers.ts";

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

test("parseQuestion validates per type and names the id", () => {
  assert.equal(parseQuestion("s", { type: "score", instructions: "i", criteria: ["a", "b"] }, "t").type, "score");
  assert.throws(() => parseQuestion("s", { type: "score", instructions: "i", criteria: ["a"] }, "t"), /question 's'.*≥2/);
  assert.throws(() => parseQuestion("c", { type: "choice", instructions: "i", criteria: "x" }, "t"), /question 'c'/);
  assert.throws(() => parseQuestion("n", { type: "noul", instructions: "i", criteria: { true: 7 } }, "t"), /question 'n'/);
  assert.throws(() => parseQuestion("x", { type: "nope", instructions: "i" }, "t"), /score, choice, or noul/);
});
