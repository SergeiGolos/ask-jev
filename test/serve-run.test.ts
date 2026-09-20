import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startServer, type RunningServer } from "../src/serve.ts";

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

async function fixture(): Promise<string> {
  const cwd = await mkdtemp(path.join(tmpdir(), "aj-serve-run-"));
  await mkdir(path.join(cwd, ".questions"), { recursive: true });
  await writeFile(path.join(cwd, ".questions", "review.md"), ASK);
  await writeFile(path.join(cwd, ".questions", "second.md"), ASK);
  await writeFile(path.join(cwd, ".questions", ".env"), "TYPESAFE_API_KEY=test-key\n");
  await mkdir(path.join(cwd, "src"), { recursive: true });
  await writeFile(path.join(cwd, "src", "a.ts"), "const a = 1;\n");
  await writeFile(path.join(cwd, "src", "b.ts"), "const b = 2;\n");
  return cwd;
}

function judgeStub(calls: string[] = []): typeof fetch {
  return (async (_url: unknown, init?: { body?: string }) => {
    const state = JSON.parse(init?.body ?? "{}").state;
    calls.push(state.path ?? "batch");
    return Response.json({ model: "jev-1", answers: { severity: { score: 2 } } });
  }) as typeof fetch;
}

/** Narrow an untyped JSON field to a string or fail the test. */
function str(v: unknown): string {
  if (typeof v !== "string") throw new Error(`expected string, got ${typeof v}`);
  return v;
}

async function post(url: string, body: string): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${url}/api/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  return { status: res.status, json: await res.json() };
}

async function withServer(cwd: string, fn: (srv: RunningServer, calls: string[]) => Promise<void>, onRun?: (result: unknown) => void): Promise<void> {
  const calls: string[] = [];
  const srv = await startServer({ cwd, port: 0, fetchImpl: judgeStub(calls), onRun });
  try {
    await fn(srv, calls);
  } finally {
    await srv.close();
  }
}

test("POST /api/run judges a file, records the run, and the matrix sees it", async () => {
  const cwd = await fixture();
  await withServer(cwd, async (srv, calls) => {
    const out = await post(srv.url, JSON.stringify({ ask: "review", path: "src/a.ts" }));
    assert.equal(out.status, 200);
    assert.ok(typeof out.json === "object" && out.json !== null && "runId" in out.json && "pairs" in out.json);
    const runId = str(out.json.runId);
    assert.match(runId, /^[0-9a-f-]{36}$/);
    assert.ok(Array.isArray(out.json.pairs));
    assert.deepEqual(out.json.pairs.map((p) => (p as { file: unknown }).file), ["src/a.ts"]);
    assert.deepEqual(calls, ["src/a.ts"]); // judge got exactly the targeted file

    const manifest = JSON.parse(
      await readFile(path.join(cwd, ".questions", "history", runId, "run.json"), "utf8"),
    );
    assert.equal(manifest.ask, "review");
    assert.deepEqual(manifest.files, ["src/a.ts"]);

    // cache was invalidated: the next matrix read covers the fresh run without a restart
    // cast: server returns MatrixResponse
    const matrix = await (await fetch(`${srv.url}/api/matrix?path=src/a.ts`)).json() as { runs: unknown[] };
    assert.equal(matrix.runs.length, 1);
  });
});

test("POST /api/run folder target expands to all files under it", async () => {
  const cwd = await fixture();
  await withServer(cwd, async (srv, calls) => {
    const out = await post(srv.url, JSON.stringify({ ask: "review", path: "src" }));
    assert.equal(out.status, 200);
    assert.deepEqual([...calls].sort(), ["src/a.ts", "src/b.ts"]);
  });
});

test("POST /api/run root target judges the whole tree", async () => {
  const cwd = await fixture();
  await withServer(cwd, async (srv, calls) => {
    const out = await post(srv.url, JSON.stringify({ ask: "review", path: "" }));
    assert.equal(out.status, 200);
    assert.equal(calls.length, 2);
  });
});

test("POST /api/run validates input and errors clearly", async () => {
  const cwd = await fixture();
  await withServer(cwd, async (srv) => {
    const missingAsk = await post(srv.url, JSON.stringify({ path: "src/a.ts" }));
    assert.equal(missingAsk.status, 400);

    const badPath = await post(srv.url, JSON.stringify({ ask: "review", path: "nope/missing.ts" }));
    assert.equal(badPath.status, 400);
    assert.ok(typeof badPath.json === "object" && badPath.json !== null && "error" in badPath.json);
    assert.match(str(badPath.json.error), /no such path/);

    const noEnv = await post(srv.url, JSON.stringify({ ask: "nope" }));
    assert.equal(noEnv.status, 500); // unknown ask throws inside runAsk; surfaced by the server's error handler
    assert.match(str((noEnv.json as { error: unknown }).error), /no ask 'nope'/);
  });
});

test("POST /api/run notifies the onRun hook with the finished result", async () => {
  const cwd = await fixture();
  const seen: { runId: unknown; files: unknown }[] = [];
  await withServer(
    cwd,
    async (srv) => {
      const out = await post(srv.url, JSON.stringify({ ask: "review", path: "src/a.ts" }));
      assert.equal(out.status, 200);
      assert.equal(seen.length, 1);
      assert.ok(typeof out.json === "object" && out.json !== null && "runId" in out.json);
      assert.equal(seen[0]!.runId, out.json.runId); // same run surfaced to the terminal
      assert.deepEqual(seen[0]!.files, ["src/a.ts"]);
    },
    (result) => {
      const r = result as { manifest: { runId: unknown; files: unknown } };
      seen.push({ runId: r.manifest.runId, files: r.manifest.files });
    },
  );
});

test("GET /api/run is method-not-allowed", async () => {
  const cwd = await fixture();
  await withServer(cwd, async (srv) => {
    const res = await fetch(`${srv.url}/api/run`);
    assert.equal(res.status, 405);
  });
});

test("GET /api/runs lists recorded runs and /report renders the run HTML", async () => {
  const cwd = await fixture();
  await withServer(cwd, async (srv) => {
    const run = await post(srv.url, JSON.stringify({ ask: "review", path: "src/a.ts" }));
    assert.equal(run.status, 200);
    assert.ok(typeof run.json === "object" && run.json !== null && "runId" in run.json);
    const runId = str(run.json.runId);

    const listRes = await fetch(`${srv.url}/api/runs`);
    assert.equal(listRes.status, 200);
    const list = await listRes.json() as { runs: { runId: string; ask: string; pairCount: number }[] };
    assert.deepEqual(list.runs.map((r) => r.runId), [runId]);
    assert.equal(list.runs[0]!.ask, "review");
    assert.equal(list.runs[0]!.pairCount, 1);

    const reportRes = await fetch(`${srv.url}/api/runs/${runId}/report`);
    assert.equal(reportRes.status, 200);
    assert.match(reportRes.headers.get("content-type") ?? "", /text\/html/);
    const html = await reportRes.text();
    assert.match(html, /ask report/);
    assert.match(html, new RegExp(runId.slice(0, 8)));

    const missing = await fetch(`${srv.url}/api/runs/00000000-0000-0000-0000-000000000000/report`);
    assert.equal(missing.status, 404);

    const traversal = await fetch(`${srv.url}/api/runs/..%2F..%2Fetc/report`);
    assert.equal(traversal.status, 404); // regex rejects path separators
  });
});

test("GET /api/files lists workspace files", async () => {
  const cwd = await fixture();
  await withServer(cwd, async (srv) => {
    const res = await fetch(`${srv.url}/api/files`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { files: string[] };
    assert.ok(Array.isArray(body.files));
    assert.deepEqual(body.files, ["src/a.ts", "src/b.ts"]);
  });
});

test("POST /api/run with multiple asks and batch flag", async () => {
  const cwd = await fixture();
  const batchAsk = ASK.replace("Review {{filename}}:", "Review {{file}}:");
  await writeFile(path.join(cwd, ".questions", "review.md"), batchAsk);
  await writeFile(path.join(cwd, ".questions", "second.md"), batchAsk);
  await withServer(cwd, async (srv, calls) => {
    const out = await post(
      srv.url,
      JSON.stringify({ asks: ["review", "second"], files: ["src/a.ts", "src/b.ts"], batch: true }),
    );
    assert.equal(out.status, 200);
    const json = out.json as { runId: string; runs: { ask: string }[]; pairs: unknown[] };
    assert.ok(json.runId);
    assert.equal(json.runs.length, 2);
    assert.deepEqual(json.runs.map((r) => r.ask), ["review", "second"]);
    // batch mode: one call per ask with file = "batch"
    assert.deepEqual(calls, ["batch", "batch"]);
  });
});
