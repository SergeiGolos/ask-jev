import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { invokeRun, MissingKeyError, type RunResult } from "../src/run.ts";

const ASK = `---
model: test-model
---
Review {{filename}}:

{{content}}

---
severity:
  type: score
  instructions: i
  criteria: [low, high]
`;

async function fixture(withKey: boolean): Promise<{ cwd: string; home: string }> {
  const cwd = await mkdtemp(path.join(tmpdir(), "aj-invoke-"));
  const home = await mkdtemp(path.join(tmpdir(), "aj-invoke-home-"));
  await mkdir(path.join(cwd, ".questions"), { recursive: true });
  await writeFile(path.join(cwd, ".questions", "review.md"), ASK);
  if (withKey) await writeFile(path.join(cwd, ".questions", ".env"), "TYPESAFE_API_KEY=test-key\n");
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await writeFile(path.join(cwd, "src", "a.ts"), "const a = 1;\n");
  return { cwd, home };
}

function judgeStub(calls: string[] = []): typeof fetch {
  return (async (_url: unknown, init?: { body?: string }) => {
    calls.push(JSON.parse(init?.body ?? "{}").state.path ?? "batch");
    return Response.json({ model: "jev-1", answers: { severity: { score: 2 } } });
  }) as typeof fetch;
}

test("invokeRun resolves the key from .questions/.env, records the run, fires onRun once", async () => {
  const { cwd, home } = await fixture(true);
  const calls: string[] = [];
  const runs: RunResult[] = [];
  const result = await invokeRun({
    names: ["review"],
    cwd,
    home,
    argv: ["review", "-f", "src/a.ts"],
    files: ["src/a.ts"],
    fetchImpl: judgeStub(calls),
    onRun: (r) => runs.push(r),
  });
  assert.deepEqual(calls, ["src/a.ts"]); // judge was reached — key resolved
  assert.equal(runs.length, 1);
  assert.equal(runs[0]!.manifest.runId, result.manifest.runId);
  assert.equal(result.pairs.length, 1);
});

test("invokeRun throws MissingKeyError with the canonical message before any judge call", async () => {
  const { cwd, home } = await fixture(false);
  const saved = process.env.TYPESAFE_API_KEY;
  delete process.env.TYPESAFE_API_KEY;
  try {
    const calls: string[] = [];
    await assert.rejects(
      invokeRun({
        names: ["review"],
        cwd,
        home,
        argv: ["review", "-f", "src/a.ts"],
        files: ["src/a.ts"],
        fetchImpl: judgeStub(calls),
      }),
      (err: unknown) => {
        assert.ok(err instanceof MissingKeyError);
        assert.equal(err.message, "TYPESAFE_API_KEY is not set — put it in .questions/.env or export it");
        return true;
      },
    );
    assert.deepEqual(calls, []); // no judge call without a key
  } finally {
    if (saved !== undefined) process.env.TYPESAFE_API_KEY = saved;
  }
});
