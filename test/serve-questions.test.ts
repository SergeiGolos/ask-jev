import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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

// Behavior lives in test/askstore.test.ts; these smokes prove the HTTP adapter's
// mapping: route → store → status code and wire shape.
test("questions API smoke: CRUD flow over the wire", async () => {
  const cwd = await createFixture();
  const srv = await startServer({ cwd });

  try {
    const listRes = await fetch(`${srv.url}/api/questions`);
    assert.equal(listRes.status, 200);
    const listJson = (await listRes.json()) as { questions: Array<{ name: string }> };
    assert.deepEqual(listJson.questions.map((q) => q.name), ["initial"]);

    const getRes = await fetch(`${srv.url}/api/questions?name=initial`);
    assert.equal(getRes.status, 200);
    const getJson = (await getRes.json()) as { name: string; schema: Record<string, unknown> };
    assert.equal(getJson.name, "initial");
    assert.ok("score_q" in getJson.schema);

    const createRes = await fetch(`${srv.url}/api/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "nested/audit" }),
    });
    assert.equal(createRes.status, 201);
    const createJson = (await createRes.json()) as { path: string };
    assert.equal(createJson.path, "nested/audit.md");

    const dupRes = await fetch(`${srv.url}/api/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "nested/audit" }),
    });
    assert.equal(dupRes.status, 409);

    const putRes = await fetch(`${srv.url}/api/questions`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "nested/audit", content: "---\nmodel: updated\n---\nbody\n" }),
    });
    assert.equal(putRes.status, 200);
    const putJson = (await putRes.json()) as { saved: boolean; meta: { model: string } };
    assert.equal(putJson.saved, true);
    assert.equal(putJson.meta.model, "updated");

    const moveRes = await fetch(`${srv.url}/api/questions/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ from: "nested/audit.md", to: "reviewed/audit-v2.md" }),
    });
    assert.equal(moveRes.status, 200);

    const oldCheck = await fetch(`${srv.url}/api/questions?name=nested/audit`);
    assert.equal(oldCheck.status, 404);
    const newCheck = await fetch(`${srv.url}/api/questions?name=reviewed/audit-v2`);
    assert.equal(newCheck.status, 200);

    const delRes = await fetch(`${srv.url}/api/questions?name=reviewed/audit-v2`, { method: "DELETE" });
    assert.equal(delRes.status, 200);
    const delCheck = await fetch(`${srv.url}/api/questions?name=reviewed/audit-v2`);
    assert.equal(delCheck.status, 404);

    const travRes = await fetch(`${srv.url}/api/questions?name=../../etc/passwd`);
    assert.equal(travRes.status, 400);
    const histRes = await fetch(`${srv.url}/api/questions?name=history/run`);
    assert.equal(histRes.status, 400);
  } finally {
    await srv.close();
  }
});
