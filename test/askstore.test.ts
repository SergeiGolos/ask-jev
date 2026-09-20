import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { AskExistsError, AskNotFoundError, InvalidAskNameError, openAskStore } from "../src/askstore.ts";

/** Fixture: fake HOME with profile asks, fake project dir with a folder ask. */
async function makeFixture() {
  const home = await mkdtemp(path.join(tmpdir(), "aj-store-home-"));
  const cwd = await mkdtemp(path.join(tmpdir(), "aj-store-cwd-"));
  await mkdir(path.join(home, ".questions"), { recursive: true });
  await mkdir(path.join(cwd, ".questions"), { recursive: true });
  await writeFile(path.join(home, ".questions", "demo.md"), "---\nmodel: profile-model\n---\nprofile body\n");
  await writeFile(path.join(home, ".questions", "only.md"), "---\nmodel: only-model\n---\nprofile-only body\n");
  await writeFile(
    path.join(cwd, ".questions", "initial.md"),
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
  );
  return { home, cwd };
}

test("list shows both sources distinctly, folder wins on a name clash", async () => {
  const { home, cwd } = await makeFixture();
  await writeFile(path.join(cwd, ".questions", "demo.md"), "---\ndescription: Demo\nmodel: folder-model\n---\nbody\n");
  const asks = await openAskStore(cwd, home).list();
  assert.deepEqual(
    asks.map((a) => [a.name, a.source, a.model]),
    [
      ["demo", "folder", "folder-model"],
      ["initial", "folder", "test-model"],
      ["only", "profile", "only-model"],
    ],
  );
  const initial = asks.find((a) => a.name === "initial")!;
  assert.equal(initial.description, "Initial ask");
  assert.equal(initial.isRunnable, true);
  assert.deepEqual(initial.args, { flag: true });
  assert.equal(initial.path, "initial.md");
  assert.equal(typeof initial.mtime, "number");
  assert.equal(initial.parseError, null);
});

test("list keeps going on a corrupt ask and marks it invalid", async () => {
  const { home, cwd } = await makeFixture();
  await writeFile(path.join(cwd, ".questions", "broken.md"), "---\nmodel: 7\n---\n");
  const asks = await openAskStore(cwd, home).list();
  const broken = asks.find((a) => a.name === "broken")!;
  assert.equal(broken.model, "(invalid)");
  assert.equal(broken.isRunnable, false);
  assert.equal(broken.description, "");
  assert.match(broken.parseError!, /model/);
  assert.equal(asks.length, 4); // corrupt entry adds to, never hides, the others
});

test("read prefers the folder ask, falls back to profile, throws on missing", async () => {
  const { home, cwd } = await makeFixture();
  const store = openAskStore(cwd, home);
  const folder = await store.read("initial");
  assert.equal(folder.source, "folder");
  assert.ok(folder.content.includes("Initial ask"));
  assert.equal(folder.parsed!.meta.model, "test-model");
  assert.ok("score_q" in folder.parsed!.schema!);
  assert.equal(folder.isRunnable, true);
  const profile = await store.read("only");
  assert.equal(profile.source, "profile");
  await assert.rejects(store.read("nope"), AskNotFoundError);
});

test("read rejects traversal and history paths", async () => {
  const { home, cwd } = await makeFixture();
  const store = openAskStore(cwd, home);
  await assert.rejects(store.read("../../etc/passwd"), InvalidAskNameError);
  await assert.rejects(store.read("history/run"), InvalidAskNameError);
  await assert.rejects(store.read(""), InvalidAskNameError);
});

test("create writes the template by default, nests, refuses duplicates, overwrites on request", async () => {
  const { home, cwd } = await makeFixture();
  const store = openAskStore(cwd, home);
  const detail = await store.create("nested/audit");
  assert.equal(detail.name, "nested/audit");
  assert.equal(detail.path, "nested/audit.md");
  assert.equal(detail.isRunnable, true);
  const disk = await readFile(path.join(cwd, ".questions", "nested", "audit.md"), "utf8");
  assert.ok(disk.includes("nested/audit"));
  await assert.rejects(store.create("nested/audit"), AskExistsError);
  await store.create("nested/audit", { content: "custom body\n", overwrite: true });
  assert.equal(await readFile(path.join(cwd, ".questions", "nested", "audit.md"), "utf8"), "custom body\n");
  await assert.rejects(store.create("../evil"), InvalidAskNameError);
});

test("save creates-or-replaces, making parent dirs, and reparses", async () => {
  const { home, cwd } = await makeFixture();
  const store = openAskStore(cwd, home);
  const content = `---
description: "Updated"
model: updated-model
---
body
---
flag_q:
  type: noul
  instructions: "Valid?"
  criteria:
    true: "Yes"
    false: "No"
`;
  const detail = await store.save("deep/nested/review.md", content);
  assert.equal(await readFile(path.join(cwd, ".questions", "deep", "nested", "review.md"), "utf8"), content);
  assert.equal(detail.parsed!.meta.model, "updated-model");
  assert.equal(detail.isRunnable, true);
});

test("move renames within the folder dir and guards both endpoints", async () => {
  const { home, cwd } = await makeFixture();
  const store = openAskStore(cwd, home);
  await store.create("nested/audit");
  assert.deepEqual(await store.move("nested/audit.md", "reviewed/audit-v2.md"), {
    from: "nested/audit.md",
    to: "reviewed/audit-v2.md",
  });
  await assert.rejects(readFile(path.join(cwd, ".questions", "nested", "audit.md"), "utf8"));
  const moved = await readFile(path.join(cwd, ".questions", "reviewed", "audit-v2.md"), "utf8");
  assert.ok(moved.includes("nested/audit"));
  await assert.rejects(store.move("missing.md", "elsewhere.md"), AskNotFoundError);
  await assert.rejects(store.move("reviewed/audit-v2.md", "initial"), AskExistsError);
  await assert.rejects(store.move("../evil", "x"), InvalidAskNameError);
});

test("delete removes from the folder dir and throws on missing", async () => {
  const { home, cwd } = await makeFixture();
  const store = openAskStore(cwd, home);
  await store.create("temp");
  assert.deepEqual(await store.delete("temp"), { name: "temp", path: "temp.md" });
  await assert.rejects(readFile(path.join(cwd, ".questions", "temp.md"), "utf8"));
  await assert.rejects(store.delete("temp"), AskNotFoundError);
  await assert.rejects(store.delete("history/run"), InvalidAskNameError);
});
