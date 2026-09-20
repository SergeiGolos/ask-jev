import test from "node:test";
import assert from "node:assert/strict";
import { assertRunnable, parseAsk, parseQuestions } from "../src/askfile.ts";

const FULL = `---
model: jev-latest
args:
  focus: security
---
Review {{filename}} for {{focus}}.

\`\`\`shell
todo --list {{filename}}
---
this --- must not split anything
\`\`\`

\`\`\`text
not a tool
\`\`\`

---

severity:
  type: score
  instructions: "How severe per \`input.report\`?"
  criteria:
    - "Low"
    - "High"
flag:
  type: noul
  instructions: "Regression?"
  criteria:
    true: "worked before"
    false: "new bug"
queue:
  type: choice
  instructions: "Which queue?"
  criteria:
    backend: server
    frontend: ui
    other: null
`;

test("full anatomy parses into meta, body, tools, schema", () => {
  const ask = parseAsk(FULL, "review.md");
  assert.equal(ask.meta.model, "jev-latest");
  assert.deepEqual(ask.meta.args, { focus: "security" });
  assert.equal(ask.tools.length, 1);
  assert.ok(ask.tools[0].includes("todo --list {{filename}}"));
  assert.ok(ask.tools[0].includes("this --- must not split anything")); // in-fence --- stays tool code
  assert.ok(ask.body.includes("Review {{filename}} for {{focus}}."));
  assert.ok(ask.body.includes("```shell")); // fences stay in the body; the renderer replaces them in place
  assert.ok(!ask.body.includes("severity")); // schema region is not body
  assert.deepEqual(Object.keys(ask.schema ?? {}), ["severity", "flag", "queue"]);
  const s = ask.schema!.severity;
  assert.equal(s.type, "score");
  assert.deepEqual(s.type === "score" && s.criteria, ["Low", "High"]);
  const f = ask.schema!.flag;
  assert.equal(f.type, "noul");
  assert.equal(f.type === "noul" && f.criteria?.true, "worked before");
  const q = ask.schema!.queue;
  assert.equal(q.type, "choice");
  assert.equal(q.type === "choice" && q.criteria.other, null);
});

test("an ask with no tools and no schema parses", () => {
  const ask = parseAsk("Just review {{file}} please.", "b.md");
  assert.deepEqual(ask.tools, []);
  assert.equal(ask.schema, null);
  assert.equal(ask.body, "Just review {{file}} please.");
});

test("a --- inside a fence does not split when there is no schema", () => {
  const text = "Look:\n\n```shell\necho one\n---\necho two\n```\n";
  const ask = parseAsk(text, "c.md");
  assert.equal(ask.schema, null);
  assert.equal(ask.tools.length, 1);
  assert.ok(ask.tools[0].includes("---"));
  assert.equal(ask.body, text); // body keeps the fence verbatim
});

test("invalid questions throw naming the id", () => {
  const bad = (q: string) => `---\nmodel: m\n---\nbody\n\n---\n${q}`;
  assert.throws(() => parseAsk(bad("x:\n  type: score\n  instructions: i\n  criteria:\n    - only"), "d.md"), /question 'x'.*criteria/);
  assert.throws(() => parseAsk(bad("x:\n  type: matrix\n  instructions: i\n"), "d.md"), /'type' must be score, choice, or noul/);
  assert.throws(() => parseAsk(bad("x:\n  type: noul\n  instructions: i\n  criteria:\n    true: 7\n"), "d.md"), /criteria 'true' must be a string/);
  assert.throws(() => parseAsk(bad("x:\n  type: choice\n  instructions: i\n  criteria: []\n"), "d.md"), /question 'x'.*criteria/);
  assert.throws(() => parseAsk(bad("x:\n  type: score\n  criteria:\n    - a\n    - b\n"), "d.md"), /'instructions' must be a non-empty string/);
});

test("a schema separator with nothing after it throws", () => {
  assert.throws(() => parseAsk("body\n\n---\n", "e.md"), /schema is empty/);
});

test("an unterminated fence throws", () => {
  assert.throws(() => parseAsk("```shell\necho hi\n", "f.md"), /unterminated code fence/);
});

test("parseQuestions converts the YAML contract shape to JSON-ready questions", () => {
  const qs = parseQuestions(
    "s:\n  type: score\n  instructions: i\n  criteria:\n    - a\n    - b\nc:\n  type: choice\n  instructions: i\n  criteria:\n    x: rubric\n    y: null\n",
  );
  assert.deepEqual(qs, {
    s: { type: "score", instructions: "i", criteria: ["a", "b"] },
    c: { type: "choice", instructions: "i", criteria: { x: "rubric", y: null } },
  });
});

test("schema in front matter parses valid YAML configuration", () => {
  const ask = parseAsk(`---
description: "Front matter schema"
model: test-model
schema:
  overall:
    type: score
    instructions: "Rate quality"
    criteria:
      - "Poor"
      - "Good"
---
Review {{filename}}:

{{content}}
`);
  assert.equal(ask.meta.model, "test-model");
  assert.ok(ask.schema);
  assert.equal(ask.schema["overall"]?.type, "score");
  assert.equal(ask.body.trim(), "Review {{filename}}:\n\n{{content}}");
});

test("schema in fenced yaml block parses as valid YAML configuration", () => {
  const ask = parseAsk(`---
model: test-model
---
Review prompt here.

\`\`\`yaml schema
overall:
  type: score
  instructions: "Rate quality"
  criteria:
    - "Low"
    - "High"
\`\`\`
`);
  assert.ok(ask.schema);
  assert.equal(ask.schema["overall"]?.type, "score");
  assert.equal(ask.body.trim(), "Review prompt here.");
});

test("front matter schema enforces valid YAML mapping and question structure", () => {
  assert.throws(
    () => parseAsk("---\nmodel: m\nschema: 'not a mapping'\n---\nbody\n"),
    /schema must be a mapping/,
  );
  assert.throws(
    () => parseAsk("---\nmodel: m\nschema:\n  q:\n    type: unknown\n---\nbody\n"),
    /'type' must be score, choice, or noul/,
  );
});

test("assertRunnable requires valid schema configuration", () => {
  const ask = parseAsk("---\nmodel: m\n---\nbody without schema\n");
  assert.throws(() => assertRunnable(ask, "my-ask"), /has no questions schema/);
});
