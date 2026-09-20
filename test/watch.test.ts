import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadAllManifests } from "../src/history.ts";
import { startServer } from "../src/serve.ts";
import { buildTriggers, matchTriggers, startWatcher } from "../src/watch.ts";

const ASK = (grep: string) => `---
model: test-model
${grep}
---
Review {{filename}}:

{{content}}

---
severity:
  type: score
  instructions: i
  criteria: [low, high]
`;

function judgeStub(calls: string[]): typeof fetch {
  return (async (_url: unknown, init?: { body?: string }) => {
    calls.push(JSON.parse(init?.body ?? "{}").state.path ?? "batch");
    return Response.json({ model: "jev-1", answers: { severity: { score: 2 } } });
  }) as typeof fetch;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ts-no-test-timers exception: watcher integration exercises real fs.watch delivery plus the
// real debounce window; deterministic clock control cannot drive kernel inotify events.
// "Nothing fires" asserts below wait a quiet period of 4× the 50ms debounce — the only way to
// assert absence of an event. Positive asserts poll `until` on real signals instead.
const QUIET = 200;

async function until(cond: () => boolean, ms = 5000): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timed out waiting for condition");
    await sleep(25);
  }
}

test("buildTriggers compiles runnable asks' grep patterns; matchTriggers dedupes asks", () => {
  const triggers = buildTriggers([
    { name: "review", grep: ["\\.ts$"], isRunnable: true },
    { name: "second", grep: ["\\.ts$", "src/"], isRunnable: true },
    { name: "broken", grep: ["\\.ts$"], isRunnable: false },
  ]);
  assert.equal(triggers.length, 3);
  assert.deepEqual(matchTriggers(triggers, "src/a.ts"), ["review", "second"]);
  assert.deepEqual(matchTriggers(triggers, "src/a.py"), ["second"]);
  assert.deepEqual(matchTriggers(triggers, "README.md"), []);
});

test("trigger matching is case-insensitive regex with literal-substring fallback", () => {
  const [t] = buildTriggers([{ name: "q", grep: ["\\.TS$"], isRunnable: true }]);
  assert.ok(t!.test("src/a.ts"));
  const [bad] = buildTriggers([{ name: "q", grep: ["a(b"], isRunnable: true }]);
  assert.ok(bad!.test("src/a(b.ts"));
  assert.ok(!bad!.test("src/ab.ts"));
});

async function fixture(): Promise<{ cwd: string; home: string }> {
  const cwd = await mkdtemp(path.join(tmpdir(), "aj-watch-"));
  const home = await mkdtemp(path.join(tmpdir(), "aj-watch-home-"));
  await mkdir(path.join(cwd, ".questions"), { recursive: true });
  await writeFile(path.join(cwd, ".questions", "review.md"), ASK("grep: '\\.ts$'"));
  await writeFile(path.join(cwd, ".questions", "second.md"), ASK("grep:\n  - '\\.ts$'\n  - '\\.py$'"));
  await writeFile(path.join(cwd, ".questions", "plain.md"), ASK(""));
  await writeFile(path.join(cwd, ".questions", ".env"), "TYPESAFE_API_KEY=test-key\n");
  await mkdir(path.join(cwd, "src"), { recursive: true });
  return { cwd, home };
}

test("watcher runs every grep-matching ask on a changed file under ONE run id; map rebuilds on question edits", async () => {
  const { cwd, home } = await fixture();
  const calls: string[] = [];
  const runIds: string[] = [];
  const w = await startWatcher({
    cwd,
    home,
    fetchImpl: judgeStub(calls),
    debounceMs: 50,
    onRun: (r) => runIds.push(r.manifest.runId),
  });
  try {
    assert.equal(w.triggers().length, 3);

    // Matching change: both grep'd asks judge the file, recorded as a single run.
    await writeFile(path.join(cwd, "src", "a.ts"), "const a = 1;\n");
    await until(() => calls.length === 2 && runIds.length === 1);
    assert.deepEqual(calls, ["src/a.ts", "src/a.ts"]);
    const manifests = await loadAllManifests(cwd);
    assert.equal(manifests.length, 1);
    assert.equal(manifests[0]!.runId, runIds[0]);
    assert.deepEqual(manifests[0]!.files, ["src/a.ts"]);
    assert.deepEqual(manifests[0]!.asks.map((a) => a.ask), ["review", "second"]);
    assert.equal(manifests[0]!.pairs.length, 2);

    // Non-matching change: nothing fires (and the recorded run's history writes didn't retrigger).
    await writeFile(path.join(cwd, "notes.txt"), "hi\n");
    await sleep(QUIET);
    assert.equal(calls.length, 2);
    assert.equal(runIds.length, 1);

    // Question update reparses the map: review now greps .md, so b.ts only triggers second.
    await writeFile(path.join(cwd, ".questions", "review.md"), ASK("grep: '\\.md$'"));
    await until(() => w.triggers().some((t) => t.ask === "review" && t.raw === "\\.md$"));
    await writeFile(path.join(cwd, "src", "b.ts"), "const b = 2;\n");
    await until(() => runIds.length === 2);
    assert.equal(calls.length, 3);
    assert.equal(calls[2], "src/b.ts");
    const after = await loadAllManifests(cwd);
    assert.equal(after.length, 2);
    assert.deepEqual(after[1]!.asks.map((a) => a.ask), ["second"]);

    // New question is picked up; deletion removes its triggers.
    await writeFile(path.join(cwd, ".questions", "third.md"), ASK("grep: '\\.txt$'"));
    await until(() => w.triggers().some((t) => t.ask === "third"));
    await unlink(path.join(cwd, ".questions", "second.md"));
    await until(() => w.triggers().every((t) => t.ask !== "second"));
    await writeFile(path.join(cwd, "notes2.txt"), "hi\n");
    await until(() => runIds.length === 3);
    const final = await loadAllManifests(cwd);
    assert.deepEqual(final[2]!.asks.map((a) => a.ask), ["third"]);

    await writeFile(path.join(cwd, "src", "c.py"), "x = 1\n");
    await sleep(QUIET);
    assert.equal(runIds.length, 3);
  } finally {
    w.close();
  }
});

test("ask serve --watch starts and stops the watcher with the server", async () => {
  const { cwd, home } = await fixture();
  const calls: string[] = [];
  const srv = await startServer({ cwd, home, port: 0, watch: true, fetchImpl: judgeStub(calls) });
  try {
    await writeFile(path.join(cwd, "src", "a.ts"), "const a = 1;\n");
    await until(() => calls.length === 2);
  } finally {
    await srv.close();
  }
  await writeFile(path.join(cwd, "src", "late.ts"), "const x = 1;\n");
  await sleep(QUIET);
  assert.equal(calls.length, 2);
});
