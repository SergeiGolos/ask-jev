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
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await writeFile(path.join(cwd, "src", "a.ts"), "const a = 1;\n");
  return cwd;
}

test("cli main executes multiple questions positionally and with -q", async () => {
  const cwd = await setupFixture();
  const origCwd = process.cwd();
  const origFetch = globalThis.fetch;
  const recordedAsks: string[] = [];

  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    return Response.json({ model: "jev-1", answers: { severity: { score: 1 } } });
  }) as typeof fetch;

  try {
    process.chdir(cwd);

    // Run positional multiple questions
    const code1 = await main(["q1", "q2", "-f", "src/a.ts"]);
    assert.equal(code1, 0);

    const runs1 = await listRuns(cwd);
    assert.equal(runs1.length, 2);
    const asks1 = runs1.map((r) => r.ask).sort();
    assert.deepEqual(asks1, ["q1", "q2"]);

    // Run with -q flags
    const code2 = await main(["-q", "q1", "-q", "q2", "-f", "src/a.ts"]);
    assert.equal(code2, 0);

    const runs2 = await listRuns(cwd);
    assert.equal(runs2.length, 4);

    // Run with batch flag
    const code3 = await main(["q1", "q2", "--batch", "-f", "src/a.ts"]);
    assert.equal(code3, 0);

    const runs3 = await listRuns(cwd);
    assert.equal(runs3.length, 6);
  } finally {
    process.chdir(origCwd);
    globalThis.fetch = origFetch;
  }
});

test("cli main fails with error when no question is provided", async () => {
  const cwd = await setupFixture();
  const origCwd = process.cwd();
  try {
    process.chdir(cwd);
    await assert.rejects(
      main(["-f", "src/a.ts"]),
      /needs at least one question name/,
    );
  } finally {
    process.chdir(origCwd);
  }
});
