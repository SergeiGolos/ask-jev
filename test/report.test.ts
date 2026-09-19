import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { recordRun, type RunInput } from "../src/history.ts";
import { renderReportHtml, writeReport } from "../src/report.ts";
import { uuidv7 } from "../src/uuid7.ts";

function seedInput(now: number): RunInput {
  return {
    ask: "review",
    askSource: "folder",
    model: "jev-latest",
    files: ["src/a.ts"],
    argv: ["review", "-f", "src/a.ts"],
    schema: { severity: { type: "score", instructions: "i", criteria: ["low", "high"] } },
    now,
    pairs: [
      {
        file: "src/a.ts",
        request: "Review src/a.ts\n<script>alert('xss')</script>",
        response: { answers: { severity: { type: "score", score: 2.4 }, flag: { type: "noul", noul: 0.9 } } },
        notes: { tools: [{ command: "wc -l src/a.ts" }], judge: { model: "jev-1.13.0", usage: { input_tokens: 10 }, latencyMs: 42 } },
      },
    ],
  };
}

test("renderReportHtml: three levels, escaping, verbose records", () => {
  const manifest = {
    runId: uuidv7(0),
    timestamp: "2026-01-01T00:00:00.000Z",
    ask: "review",
    askSource: "folder",
    model: "jev-latest",
    files: ["src/a.ts"],
    argv: ["review"],
    pairs: [{ n: 1, file: "src/a.ts", request: "001-src-a-ts.request.md", response: "001-src-a-ts.response.json", notes: { tools: [{ command: "wc -l src/a.ts" }] } }],
  };
  const html = renderReportHtml(manifest, [
    {
      rec: manifest.pairs[0]!,
      request: "prompt with <b>html</b>",
      response: { answers: { severity: { type: "score", score: 2.4 } } },
    },
  ]);
  assert.ok(html.includes('data-view="result"')); // level 1 default
  assert.ok(html.includes("Extended") && html.includes("verbose")); // all three levels reachable
  assert.ok(!html.includes("<b>html</b>")); // request is escaped
  assert.ok(html.includes("&lt;b&gt;html&lt;/b&gt;"));
  assert.ok(html.includes("severity&nbsp;<b>2.4</b>")); // result chip
  assert.ok(html.includes("$ wc -l src/a.ts")); // console records present
  assert.ok(!/<input type="checkbox"[^>]*checked/.test(html)); // verbose checkbox unchecked by default
  assert.ok(html.includes("console output"));
});

test("writeReport: -o path honored, latest run by default, no-runs error", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "aj-rep-"));
  await recordRun(cwd, { ...seedInput(1_000), runId: uuidv7(1_000) });
  const newer = await recordRun(cwd, { ...seedInput(2_000), runId: uuidv7(2_000) });
  const out = await writeReport(cwd, undefined, "my-report.html");
  assert.ok(out.endsWith("my-report.html"));
  const html = await readFile(out, "utf8");
  assert.ok(html.includes(newer.runId)); // default = latest run
  await assert.rejects(writeReport(cwd, "ffffffff", undefined), /no run matching/);
  const empty = await mkdtemp(path.join(tmpdir(), "aj-rep2-"));
  await assert.rejects(writeReport(empty, undefined, undefined), /no runs recorded yet/);
});
