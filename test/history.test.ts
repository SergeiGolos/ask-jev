import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseAsk } from "../src/askfile.ts";
import { findRun, latestRun, listRuns, recordRun, readPair, type RunInput } from "../src/history.ts";
import { uuidv7 } from "../src/uuid7.ts";

const SCHEMA = parseAsk("---\nmodel: m\n---\nbody\n---\nseverity:\n  type: score\n  instructions: i\n  criteria:\n    - low\n    - high\n").schema;

function seedInput(now: number): RunInput {
  return {
    asks: [
      {
        ask: "count",
        askSource: "folder",
        model: "jev-latest",
        schema: SCHEMA,
      },
    ],
    files: ["src/a.ts", "src/b.ts"],
    argv: ["count", "-f", "src/*.ts"],
    now,
    pairs: [
      {
        ask: "count",
        file: "src/a.ts",
        request: "Review src/a.ts\n```output\n$ wc -l src/a.ts\n4\n```",
        response: { answers: { severity: { type: "score", score: 2.1 } } },
        notes: { tools: [{ command: "wc -l src/a.ts" }], judge: { model: "jev-1.13.0", latencyMs: 210 } },
      },
      {
        ask: "count",
        file: "src/b.ts",
        request: "Review src/b.ts",
        response: { answers: { severity: { type: "score", score: 1 } } },
      },
    ],
  };
}

test("uuidv7: format, version, variant, monotonic sort", () => {
  const a = uuidv7(1_700_000_000_000);
  const b = uuidv7(1_700_000_000_001);
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.ok(a < b, "uuidv7 sorts by creation time");
  const many = Array.from({ length: 200 }, () => uuidv7());
  assert.equal(new Set(many).size, 200);
});

test("recordRun writes the locked layout with schema appended to requests", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "aj-hist-"));
  const manifest = await recordRun(cwd, seedInput(1_700_000_000_000));
  assert.equal(manifest.pairs.length, 2);
  assert.equal(manifest.timestamp, "2023-11-14T22:13:20.000Z");
  const request = await readFile(path.join(cwd, ".questions", "history", manifest.runId, "001-count-src-a-ts.request.md"), "utf8");
  assert.ok(request.includes("Review src/a.ts")); // rendered prompt verbatim
  assert.ok(request.includes("type: score")); // schema appended for reference
  assert.ok(request.includes("ask schema (reference only)"));
  const response = JSON.parse(await readFile(path.join(cwd, ".questions", "history", manifest.runId, "002-count-src-b-ts.response.json"), "utf8"));
  assert.deepEqual(response, { answers: { severity: { type: "score", score: 1 } } });
  const runJson = JSON.parse(await readFile(path.join(cwd, ".questions", "history", manifest.runId, "run.json"), "utf8"));
  assert.equal(runJson.asks[0]!.ask, "count");
  assert.equal(runJson.pairs[1]!.ask, "count");
  assert.equal(runJson.pairs[1]!.file, "src/b.ts");
});

test("batch runs get a single pair with the batch slug", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "aj-hist-"));
  const manifest = await recordRun(cwd, {
    ...seedInput(0),
    files: ["src/a.ts", "src/b.ts"],
    pairs: [{ ask: "count", file: "batch", request: "all files", response: { answers: {} } }],
  });
  assert.deepEqual(manifest.pairs.map((p) => p.request), ["001-count-batch.request.md"]);
});

test("listRuns sorts chronologically and skips junk", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "aj-hist-"));
  await mkdir(path.join(cwd, ".questions", "history", "not-a-run"), { recursive: true });
  const older = await recordRun(cwd, { ...seedInput(0), runId: uuidv7(1_000), now: 1_000 });
  const newer = await recordRun(cwd, { ...seedInput(0), runId: uuidv7(2_000), now: 2_000 });
  const runs = await listRuns(cwd);
  assert.deepEqual(runs.map((r) => r.runId), [older.runId, newer.runId]);
  assert.equal(runs[0]!.pairCount, 2);
});

test("latestRun returns the newest run, errors when history is empty", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "aj-hist-"));
  await assert.rejects(latestRun(cwd), /no runs recorded yet/);
  const older = await recordRun(cwd, { ...seedInput(0), runId: uuidv7(1_000) });
  const newer = await recordRun(cwd, { ...seedInput(0), runId: uuidv7(2_000) });
  const { manifest, dir } = await latestRun(cwd);
  assert.equal(manifest.runId, newer.runId);
  assert.equal(dir, path.join(cwd, ".questions", "history", newer.runId));
  assert.ok(older.runId);
});

test("findRun: unique prefix resolves, ambiguity and misses error", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "aj-hist-"));
  const a = await recordRun(cwd, { ...seedInput(0), runId: uuidv7(1_000) }); // 0000000003e8…
  const b = await recordRun(cwd, { ...seedInput(0), runId: uuidv7(2_000) }); // 0000000007d0…
  const hit = await findRun(cwd, a.runId.slice(0, 11)); // ids first differ at hex char 10
  assert.equal(hit.manifest.runId, a.runId);
  await assert.rejects(findRun(cwd, "0"), /ambiguous run prefix/); // both ids share the leading zeros
  await assert.rejects(findRun(cwd, "ffffffff"), /no run matching/);
  assert.ok(b.runId);
});

test("readPair returns the stored md and parsed json", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "aj-hist-"));
  const m = await recordRun(cwd, seedInput(0));
  const { dir } = await findRun(cwd, m.runId);
  const pair = await readPair(dir, m.pairs[0]!);
  assert.ok(pair.request.includes("Review src/a.ts"));
  assert.deepEqual(pair.response, { answers: { severity: { type: "score", score: 2.1 } } });
});
