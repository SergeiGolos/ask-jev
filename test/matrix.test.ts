import assert from "node:assert/strict";
import { test } from "node:test";
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
