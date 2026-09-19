import test from "node:test";
import assert from "node:assert/strict";
import { judge, judgeState, langOf, prettyPair } from "../src/judge.ts";

const QUESTIONS = { severity: { type: "score", instructions: "i", criteria: ["low", "high"] } };

function fetchStub(responses: Array<{ status: number; body?: unknown; retryAfter?: string }>, calls: string[] = []): typeof fetch {
  let i = 0;
  return (async (input: unknown) => {
    calls.push(String(input));
    const r = responses[Math.min(i, responses.length - 1)]!;
    i++;
    const headers = new Headers();
    if (r.retryAfter !== undefined) headers.set("retry-after", r.retryAfter);
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status, headers });
  }) as typeof fetch;
}

test("judge posts {state, model, questions} and returns answers verbatim", async () => {
  const calls: string[] = [];
  let captured = "";
  const fetchImpl = (async (url: unknown, init?: { body?: string }) => {
    calls.push(String(url));
    captured = init?.body ?? "";
    return Response.json({ model: "jev-1.13.0", answers: { severity: { score: 2 } }, usage: { input_tokens: 5 } });
  }) as typeof fetch;
  const res = await judge({
    key: "k",
    model: "jev-latest",
    questions: QUESTIONS,
    state: { prompt: "p", path: "a.ts", language: "TypeScript" },
    fetchImpl,
  });
  assert.equal(calls[0], "https://api.typesafe.ai/v1/systemone");
  const body = JSON.parse(captured);
  assert.deepEqual(Object.keys(body), ["state", "model", "questions"]);
  assert.equal(body.model, "jev-latest");
  assert.deepEqual(res, { model: "jev-1.13.0", answers: { severity: { score: 2 } }, usage: { input_tokens: 5 } });
});

test("judge retries 429 with backoff then succeeds", async () => {
  let attempts = 0;
  const fetchImpl = (async () => {
    attempts++;
    return attempts < 3 ? new Response("slow down", { status: 429 }) : Response.json({ model: "m", answers: { a: 1 } });
  }) as typeof fetch;
  const res = await judge({ key: "k", model: "m", questions: QUESTIONS, state: {}, retries: 3, backoffMs: 1, fetchImpl });
  assert.equal(attempts, 3);
  assert.deepEqual(res.answers, { a: 1 });
});

test("judge honors retry-after and exhausts on persistent 529", async () => {
  const calls: string[] = [];
  const fetchImpl = fetchStub([{ status: 529, retryAfter: "0.001" }], calls);
  await assert.rejects(
    judge({ key: "k", model: "m", questions: QUESTIONS, state: {}, retries: 2, backoffMs: 1, fetchImpl }),
    /TypeSafe API 529/,
  );
  assert.equal(calls.length, 3); // initial + 2 retries
});

test("judge: 401 names the key, 422 surfaces the validation body", async () => {
  await assert.rejects(
    judge({ key: "bad", model: "m", questions: QUESTIONS, state: {}, fetchImpl: fetchStub([{ status: 401 }]) }),
    /rejected the API key/,
  );
  await assert.rejects(
    judge({
      key: "k",
      model: "m",
      questions: QUESTIONS,
      state: {},
      fetchImpl: fetchStub([{ status: 422, body: { error: "score needs >=2 levels" } }]),
    }),
    /TypeSafe API 422.*score needs >=2 levels/s,
  );
});

test("judgeState: per-file carries path+language, batch is prompt-only", () => {
  assert.deepEqual(judgeState("a.ts", "p", true), { prompt: "p", path: "a.ts", language: "TypeScript" });
  assert.deepEqual(judgeState("batch", "p", false), { prompt: "p" });
  assert.equal(langOf("x.py"), "Python");
});

test("prettyPair shapes scores with legend labels, noul and choice", () => {
  const out = prettyPair("src/a.ts", {
    answers: {
      severity: { type: "score", score: 2.4, legend: { "0": "none", "1": "minor", "2": "serious", "3": "critical" } },
      flag: { type: "noul", noul: 0.15 },
      queue: { type: "choice", choice: "backend" },
    },
  });
  assert.equal(out, "src/a.ts\n  severity 2.4 — serious\n  flag no (15%)\n  queue backend");
});
