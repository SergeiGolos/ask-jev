import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { main } from "../src/cli.ts";
import { listRuns } from "../src/history.ts";

const ASK_TEMPLATE = `---
model: test-model
---
Review {{file}}:

{{content}}

---
severity:
  type: score
  instructions: score
  criteria: [low, high]
`;

async function setupFixture(): Promise<string> {
  const cwd = await mkdtemp(path.join(tmpdir(), "aj-cli-multi-"));
  await mkdir(path.join(cwd, ".questions"), { recursive: true });
  await writeFile(path.join(cwd, ".questions", "q1.md"), ASK_TEMPLATE);
  await writeFile(path.join(cwd, ".questions", "q2.md"), ASK_TEMPLATE);
  await writeFile(path.join(cwd, ".questions", ".env"), "TYPESAFE_API_KEY=test-key\n");
  await mkdir(path.join(cwd, ".questions", "audit"), { recursive: true });
  await writeFile(path.join(cwd, ".questions", "audit", "rule1.md"), ASK_TEMPLATE);
  await writeFile(path.join(cwd, ".questions", "audit", "rule2.md"), ASK_TEMPLATE);
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await writeFile(path.join(cwd, "src", "a.ts"), "const a = 1;\n");
  return cwd;
}

test("cli main runs multiple questions as ONE grouped run", async () => {
  const cwd = await setupFixture();
  const origFetch = globalThis.fetch;

  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    return Response.json({ model: "jev-1", answers: { severity: { score: 1 } } });
  }) as typeof fetch;

  try {
    // Run positional multiple questions
    const code1 = await main(["q1", "q2", "-f", "src/a.ts"], cwd);
    assert.equal(code1, 0);

    // BOTH questions land in ONE run: two asks × one file = two pairs
    const runs1 = await listRuns(cwd);
    assert.equal(runs1.length, 1);
    assert.deepEqual(runs1[0]!.asks, ["q1", "q2"]);
    assert.equal(runs1[0]!.pairCount, 2);

    // Run with -q flags
    const code2 = await main(["-q", "q1", "-q", "q2", "-f", "src/a.ts"], cwd);
    assert.equal(code2, 0);

    const runs2 = await listRuns(cwd);
    assert.equal(runs2.length, 2);

    // Run with batch flag
    const code3 = await main(["q1", "q2", "--batch", "-f", "src/a.ts"], cwd);
    assert.equal(code3, 0);

    const runs3 = await listRuns(cwd);
    assert.equal(runs3.length, 3);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("cli main fails with error when no question is provided", async () => {
  const cwd = await setupFixture();
  await assert.rejects(
    main(["-f", "src/a.ts"], cwd),
    /needs at least one question name/,
  );
});

test("cli main expands directory to all questions contained in it", async () => {
  const cwd = await setupFixture();
  const origFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    return Response.json({ model: "jev-1", answers: { severity: { score: 1 } } });
  }) as typeof fetch;

  try {
    // Passing directory name 'audit' expands to audit/rule1 and audit/rule2
    const code = await main(["audit", "-f", "src/a.ts"], cwd);
    assert.equal(code, 0);

    const runs = await listRuns(cwd);
    assert.equal(runs.length, 1); // both expanded asks group into ONE run
    assert.deepEqual(runs[0]!.asks, ["audit/rule1", "audit/rule2"]);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test("cli main expands question globs like dir/* or prefix*", async () => {
  const cwd = await setupFixture();
  const origFetch = globalThis.fetch;

  globalThis.fetch = (async () => {
    return Response.json({ model: "jev-1", answers: { severity: { score: 1 } } });
  }) as typeof fetch;

  try {
    // Passing glob 'audit/*'
    const code = await main(["audit/*", "-f", "src/a.ts"], cwd);
    assert.equal(code, 0);

    const runs = await listRuns(cwd);
    assert.equal(runs.length, 1);
    assert.deepEqual(runs[0]!.asks, ["audit/rule1", "audit/rule2"]);
  } finally {
    globalThis.fetch = origFetch;
  }
});
