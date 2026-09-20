import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildTreeData, buildMatrixData, githubRepoUrl } from "../src/matrix.ts";
import { loadAllManifests } from "../src/history.ts";

test("buildTreeData and buildMatrixData against project history", async () => {
  const historyDir = path.join(process.cwd(), ".questions", "history");
  const manifests = await loadAllManifests(historyDir);
  assert.ok(manifests.length >= 1);

  const tree = await buildTreeData(historyDir, manifests);
  assert.equal(tree.root.type, "directory");
  assert.ok(tree.availableAsks.includes("gut-feeling"));
  assert.ok(tree.timeRange.min.length > 0);

  // File matrix query
  const fileMatrix = await buildMatrixData(historyDir, manifests, { path: "src/uuid7.ts" });
  assert.equal(fileMatrix.isFolder, false);
  assert.ok(fileMatrix.runs.length >= 1);
  assert.ok(fileMatrix.questions.length > 0);

  // Rollup matrix query
  const folderMatrix = await buildMatrixData(historyDir, manifests, { path: "src" });
  assert.equal(folderMatrix.isFolder, true);
  assert.ok(folderMatrix.runs.length >= 1);
  const demeterQ = folderMatrix.questions.find((q) => q.id === "demeter");
  assert.ok(demeterQ);

  // Grep filter query
  const grepMatrix = await buildMatrixData(historyDir, manifests, { path: "src", grep: "demeter" });
  assert.equal(grepMatrix.questions.length, 1);
  assert.equal(grepMatrix.questions[0]!.id, "demeter");
});

test("URL inputs group under a host directory and stack by verbatim URL", async () => {
  const historyDir = await mkdtemp(path.join(tmpdir(), "aj-urltree-"));
  const url = "https://example.com/doc.md";
  const other = "https://example.com/other.md";
  const manifest = (runId: string, timestamp: string, files: string[]) => ({
    runId,
    timestamp,
    ask: "a",
    askSource: "folder",
    model: "m",
    files,
    argv: [],
    pairs: files.map((f, i) => ({ n: i + 1, file: f, request: `${i + 1}.request.md`, response: `${i + 1}.response.json` })),
  });
  const manifests = [
    manifest("a1", "2025-01-01T00:00:00.000Z", [url]),
    manifest("a2", "2025-01-02T00:00:00.000Z", [url]),
    manifest("a3", "2025-01-03T00:00:00.000Z", [other, "src/a.ts"]),
    manifest("a4", "2025-01-04T00:00:00.000Z", ["https://example.com/"]),
  ];
  const tree = await buildTreeData(historyDir, manifests);

  const host = tree.root.children!.find((c) => c.name === "example.com");
  assert.ok(host, "host group exists");
  assert.equal(host!.type, "directory");
  assert.equal(host!.path, "https://example.com");
  const leaf = host!.children!.find((c) => c.name === "doc.md");
  assert.equal(leaf!.path, url); // verbatim URL, not path-normalized
  assert.equal(leaf!.runCount, 2);
  assert.ok(!tree.root.children!.some((c) => c.name === "https:"), "no mangled scheme directory");
  assert.ok(tree.root.children!.some((c) => c.name === "src"), "real paths unaffected");

  const fileMatrix = await buildMatrixData(historyDir, manifests, { path: url });
  assert.equal(fileMatrix.isFolder, false);
  assert.equal(fileMatrix.runs.length, 2); // same-URL runs stack
  const hostMatrix = await buildMatrixData(historyDir, manifests, { path: "https://example.com" });
  assert.equal(hostMatrix.isFolder, true);
  assert.equal(hostMatrix.runs.length, 4); // host path rolls up all its URLs
});

test("githubRepoUrl and run-column git stamp passthrough", async () => {
  assert.equal(githubRepoUrl("git@github.com:owner/repo.git"), "https://github.com/owner/repo");
  assert.equal(githubRepoUrl("https://github.com/owner/repo.git"), "https://github.com/owner/repo");
  assert.equal(githubRepoUrl("https://gitlab.com/owner/repo.git"), undefined);
  assert.equal(githubRepoUrl(undefined), undefined);

  const historyDir = await mkdtemp(path.join(tmpdir(), "aj-gitstamp-"));
  const manifest = (runId: string, git?: { sha: string; remote: string }) => ({
    runId,
    timestamp: runId === "b" ? "2025-01-02T00:00:00.000Z" : "2025-01-01T00:00:00.000Z",
    ask: "a",
    askSource: "folder",
    model: "m",
    files: ["src/a.ts"],
    argv: [],
    pairs: [{ n: 1, file: "src/a.ts", request: "1.request.md", response: "1.response.json" }],
    ...(git ? { git } : {}),
  });
  const res = await buildMatrixData(
    historyDir,
    [manifest("a"), manifest("b", { sha: "c".repeat(40), remote: "git@github.com:owner/repo.git" })],
    {},
  );
  assert.equal(res.runs.length, 2);
  assert.equal(res.runs[0]!.sha, "c".repeat(40)); // newest run is the first column
  assert.equal(res.runs[0]!.repo, "https://github.com/owner/repo");
  assert.equal(res.runs[1]!.sha, undefined); // unstamped run stays link-less
});

test("low-direction questions tone inverted in matrix cells and rollups", async () => {
  const historyDir = await mkdtemp(path.join(tmpdir(), "aj-dir-"));
  const runId = "d1";
  await mkdir(path.join(historyDir, runId), { recursive: true });
  await writeFile(
    path.join(historyDir, runId, "1.response.json"),
    JSON.stringify({ answers: { violations: { score: 1 } } }),
  );
  const manifest = {
    runId,
    timestamp: "2025-01-01T00:00:00.000Z",
    ask: "a",
    askSource: "folder",
    model: "m",
    files: ["src/a.ts"],
    argv: [],
    pairs: [{ n: 1, file: "src/a.ts", request: "1.request.md", response: "1.response.json" }],
    directions: { violations: "low" as const },
  };
  const res = await buildMatrixData(historyDir, [manifest], { path: "src" });
  assert.equal(res.questions[0]!.id, "violations");
  assert.equal(res.questions[0]!.cells[runId]!.tone, "ok"); // 1 violation → green, not red
});
