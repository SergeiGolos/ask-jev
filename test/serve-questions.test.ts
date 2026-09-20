import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startServer } from "../src/serve.ts";

async function createFixture(): Promise<string> {
  const cwd = await mkdtemp(path.join(tmpdir(), "aj-srv-q-"));
  const qDir = path.join(cwd, ".questions");
  await mkdir(qDir, { recursive: true });
  await writeFile(
    path.join(qDir, "initial.md"),
    `---
description: "Initial ask"
model: test-model
args:
  flag: true
---
Body prompt here
---
score_q:
  type: score
  instructions: "Rate quality"
  criteria: ["bad", "good"]
`,
    "utf8",
  );
  return cwd;
}

test("questions API CRUD and organize", async () => {
  const cwd = await createFixture();
  const srv = await startServer({ cwd });

  try {
    // 1. GET /api/questions - list
    const listRes = await fetch(`${srv.url}/api/questions`);
    assert.equal(listRes.status, 200);
    const listJson = (await listRes.json()) as { questions: Array<{ name: string; description: string; isRunnable: boolean }> };
    assert.ok(Array.isArray(listJson.questions));
    assert.equal(listJson.questions.length, 1);
    assert.equal(listJson.questions[0]!.name, "initial");
    assert.equal(listJson.questions[0]!.description, "Initial ask");
    assert.equal(listJson.questions[0]!.isRunnable, true);

    // 2. GET /api/questions?name=initial - get single
    const getRes = await fetch(`${srv.url}/api/questions?name=initial`);
    assert.equal(getRes.status, 200);
    const getJson = (await getRes.json()) as { name: string; content: string; isRunnable: boolean; schema: Record<string, unknown> };
    assert.equal(getJson.name, "initial");
    assert.ok(getJson.content.includes("Initial ask"));
    assert.equal(getJson.isRunnable, true);
    assert.ok("score_q" in getJson.schema);

    // 3. POST /api/questions - create with template
    const createRes = await fetch(`${srv.url}/api/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "nested/audit" }),
    });
    assert.equal(createRes.status, 201);
    const createJson = (await createRes.json()) as { name: string; path: string; isRunnable: boolean };
    assert.equal(createJson.name, "nested/audit");
    assert.equal(createJson.path, "nested/audit.md");
    assert.equal(createJson.isRunnable, true);

    // Verify file written to disk
    const diskContent = await readFile(path.join(cwd, ".questions/nested/audit.md"), "utf8");
    assert.ok(diskContent.includes("nested/audit"));

    // 4. POST /api/questions - duplicate rejected
    const dupRes = await fetch(`${srv.url}/api/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "nested/audit" }),
    });
    assert.equal(dupRes.status, 409);

    // 5. PUT /api/questions - update content
    const updatedContent = `---
description: "Updated audit"
model: updated-model
---
Updated body
---
flag_q:
  type: noul
  instructions: "Is valid?"
  criteria:
    true: "Yes"
    false: "No"
`;
    const putRes = await fetch(`${srv.url}/api/questions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "nested/audit", content: updatedContent }),
    });
    assert.equal(putRes.status, 200);
    const putJson = (await putRes.json()) as { saved: boolean; meta: { model: string } };
    assert.equal(putJson.saved, true);
    assert.equal(putJson.meta.model, "updated-model");

    // Verify disk updated
    const diskUpdated = await readFile(path.join(cwd, ".questions/nested/audit.md"), "utf8");
    assert.equal(diskUpdated, updatedContent);

    // 6. POST /api/questions/move - rename/move
    const moveRes = await fetch(`${srv.url}/api/questions/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "nested/audit.md", to: "reviewed/audit-v2.md" }),
    });
    assert.equal(moveRes.status, 200);
    const moveJson = (await moveRes.json()) as { success: boolean; from: string; to: string };
    assert.equal(moveJson.success, true);
    assert.equal(moveJson.to, "reviewed/audit-v2.md");

    // Old path should be gone, new path should exist
    const oldCheck = await fetch(`${srv.url}/api/questions?name=nested/audit`);
    assert.equal(oldCheck.status, 404);
    const newCheck = await fetch(`${srv.url}/api/questions?name=reviewed/audit-v2`);
    assert.equal(newCheck.status, 200);

    // 7. DELETE /api/questions - delete
    const delRes = await fetch(`${srv.url}/api/questions?name=reviewed/audit-v2`, {
      method: "DELETE",
    });
    assert.equal(delRes.status, 200);
    const delCheck = await fetch(`${srv.url}/api/questions?name=reviewed/audit-v2`);
    assert.equal(delCheck.status, 404);

    // 8. Traversal rejection
    const travRes = await fetch(`${srv.url}/api/questions?name=../../etc/passwd`);
    assert.equal(travRes.status, 400);

    // 9. History directory access rejection
    const histRes = await fetch(`${srv.url}/api/questions?name=history/run`);
    assert.equal(histRes.status, 400);
  } finally {
    await srv.close();
  }
});
