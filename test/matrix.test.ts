import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildTreeData, buildMatrixData, loadAllManifests, parseAnswer } from "../src/matrix.ts";

test("parseAnswer parses score, choice, and noul", () => {
  const score = parseAnswer("q1", { score: 8.5 });
  assert.equal(score.numeric, 8.5);
  assert.equal(score.display, "8.5");
  assert.equal(score.tone, "ok");

  const choiceNum = parseAnswer("q2", { choice: "5" });
  assert.equal(choiceNum.numeric, 5);
  assert.equal(choiceNum.display, "5");
  assert.equal(choiceNum.tone, "warn");

  const choiceStr = parseAnswer("q3", { choice: "custom-label" });
  assert.equal(choiceStr.numeric, null);
  assert.equal(choiceStr.display, "custom-label");
  assert.equal(choiceStr.tone, "mut");

  const noulBad = parseAnswer("q4", { noul: 0.8 });
  assert.equal(noulBad.display, "rework 80%");
  assert.equal(noulBad.tone, "bad");

  const noulGood = parseAnswer("q5", { noul: 0.1 });
  assert.equal(noulGood.display, "pass 90%");
  assert.equal(noulGood.tone, "ok");
});

test("buildTreeData and buildMatrixData against project history", async () => {
  const historyDir = path.join(process.cwd(), ".questions", "history");
  const manifests = await loadAllManifests(historyDir);
  assert.ok(manifests.length >= 10);

  const tree = await buildTreeData(historyDir, manifests);
  assert.equal(tree.root.type, "directory");
  assert.ok(tree.availableAsks.includes("gut-feeling"));
  assert.ok(tree.timeRange.min.length > 0);

  // File matrix query
  const fileMatrix = await buildMatrixData(historyDir, manifests, { path: "src/uuid7.ts" });
  assert.equal(fileMatrix.isFolder, false);
  assert.ok(fileMatrix.runs.length >= 5);
  assert.ok(fileMatrix.questions.length > 0);

  // Rollup matrix query
  const folderMatrix = await buildMatrixData(historyDir, manifests, { path: "src" });
  assert.equal(folderMatrix.isFolder, true);
  assert.ok(folderMatrix.runs.length >= 5);
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
