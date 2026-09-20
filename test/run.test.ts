import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { CliError } from "../src/errors.ts";
import { gitStamp, runAsk } from "../src/run.ts";

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

async function fixture() {
  const cwd = await mkdtemp(path.join(tmpdir(), "aj-run-"));
  await mkdir(path.join(cwd, ".questions"), { recursive: true });
  await writeFile(path.join(cwd, ".questions", "review.md"), ASK);
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await writeFile(path.join(cwd, "src", "a.ts"), "const a = 1;\n");
  await writeFile(path.join(cwd, "src", "b.ts"), "const b = 2;\n");
  return cwd;
}

function judgeStub(states: unknown[] = []): typeof fetch {
  return (async (_url: unknown, init?: { body?: string }) => {
    states.push(JSON.parse(init?.body ?? "{}").state);
    return Response.json({ model: "jev-1", answers: { severity: { score: 2 } } });
  }) as typeof fetch;
}

test("runAsk: one judge call per file, files[i]↔pairs[i], per-file state, recorded", async () => {
  const cwd = await fixture();
  const states: unknown[] = [];
  const result = await runAsk({
    name: "review",
    cwd,
    argv: ["review", "-f", "src/*.ts"],
    files: ["src/*.ts"],
    tokens: {},
    key: "k",
    fetchImpl: judgeStub(states),
  });
  assert.equal(result.pairs.length, 2);
  assert.deepEqual(result.pairs.map((p) => p.file), ["src/a.ts", "src/b.ts"]); // index invariant
  assert.ok(result.pairs[0]!.request.includes("const a = 1;"));
  assert.deepEqual(states[0], { prompt: result.pairs[0]!.request, path: "src/a.ts", language: "TypeScript" });
  assert.deepEqual(states[1], { prompt: result.pairs[1]!.request, path: "src/b.ts", language: "TypeScript" });
  assert.equal(typeof result.pairs[0]!.notes!.judge!.latencyMs, "number");
  assert.equal(result.model, "test-model"); // front matter wins over default

  const runJson = JSON.parse(
    await readFile(path.join(cwd, ".questions", "history", result.manifest.runId, "run.json"), "utf8"),
  );
  assert.equal(runJson.model, "test-model");
  assert.deepEqual(runJson.argv, ["review", "-f", "src/*.ts"]);
  assert.equal(runJson.pairs[1]!.file, "src/b.ts");
});

test("runAsk batch: single call, file 'batch', prompt-only state", async () => {
  const cwd = await fixture();
  await writeFile(
    path.join(cwd, ".questions", "review.md"),
    ASK.replace("{{filename}}:", "{{file}}:").replace("Review {{filename}}:", "Review {{file}}:"),
  );
  const states: unknown[] = [];
  const result = await runAsk({
    name: "review",
    cwd,
    argv: ["review", "--batch", "-f", "src/*.ts"],
    files: ["src/*.ts"],
    tokens: {},
    batch: true,
    key: "k",
    fetchImpl: judgeStub(states),
  });
  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0]!.file, "batch");
  assert.deepEqual(states[0], { prompt: result.pairs[0]!.request });
});

test("runAsk: unknown ask is a plain error; schema-less ask is a CliError", async () => {
  const cwd = await fixture();
  const noAsk = await runAsk({ name: "nope", cwd, argv: [], files: [], tokens: {}, key: "k" }).catch((e: unknown) => e);
  assert.ok(noAsk instanceof Error);
  assert.ok(!(noAsk instanceof CliError));
  assert.match(noAsk.message, /no ask 'nope'/);

  await writeFile(path.join(cwd, ".questions", "bare.md"), "---\nmodel: m\n---\nbody only, no schema\n");
  await assert.rejects(
    runAsk({ name: "bare", cwd, argv: [], files: [], tokens: {}, key: "k" }),
    (e: unknown) => e instanceof CliError && /no questions schema/.test(e.message),
  );
});

test("runAsk with URL input: judged like a file and recorded under the URL", async () => {
  const cwd = await fixture();
  const srv = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("const a = 1;\n");
  });
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const addr = srv.address();
  if (!addr || typeof addr === "string") throw new Error("listen failed");
  const url = `http://127.0.0.1:${addr.port}/src/a.ts`;
  try {
    const states: unknown[] = [];
    const result = await runAsk({
      name: "review",
      cwd,
      argv: ["review", "-f", url],
      files: [url],
      tokens: {},
      key: "k",
      fetchImpl: judgeStub(states),
    });
    assert.deepEqual(result.pairs.map((p) => p.file), [url]); // history stacks under the URL
    assert.ok(result.pairs[0]!.request.includes("const a = 1;")); // raw body judged
    assert.deepEqual(states[0], { prompt: result.pairs[0]!.request, path: url, language: "TypeScript" });
    const runJson = JSON.parse(
      await readFile(path.join(cwd, ".questions", "history", result.manifest.runId, "run.json"), "utf8"),
    );
    assert.deepEqual(runJson.files, [url]);
    assert.equal(runJson.pairs[0]!.file, url);
  } finally {
    srv.close();
  }
});

test("gitStamp: undefined outside a repo, HEAD sha inside", async () => {
  const bare = await mkdtemp(path.join(tmpdir(), "aj-bare-"));
  assert.equal(await gitStamp(bare), undefined);
  assert.match((await gitStamp(process.cwd()))!.sha, /^[0-9a-f]{40}$/);
});

test("runAsk stamps run.json with the analyzed tree's git HEAD sha", async () => {
  const cwd = await fixture();
  const git = promisify(execFile);
  await git("git", ["init", "-q"], { cwd });
  await git("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "--allow-empty", "-qm", "init"], { cwd });
  const result = await runAsk({
    name: "review",
    cwd,
    argv: ["review", "-f", "src/a.ts"],
    files: ["src/a.ts"],
    tokens: {},
    key: "k",
    fetchImpl: judgeStub(),
  });
  const expected = (await git("git", ["rev-parse", "HEAD"], { cwd })).stdout.trim();
  const runJson = JSON.parse(
    await readFile(path.join(cwd, ".questions", "history", result.manifest.runId, "run.json"), "utf8"),
  );
  assert.equal(runJson.git?.sha, expected);
});
