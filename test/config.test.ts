import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveAsk, resolveConfig } from "../src/config.ts";

/** Fixture layout: fake HOME with a profile .questions, fake project dir with a folder .questions. */
async function makeFixture() {
  const home = await mkdtemp(path.join(tmpdir(), "aj-home-"));
  const cwd = await mkdtemp(path.join(tmpdir(), "aj-cwd-"));
  await mkdir(path.join(home, ".questions"), { recursive: true });
  await mkdir(path.join(cwd, ".questions"), { recursive: true });
  await writeFile(path.join(home, ".questions", "demo.md"), "---\nmodel: profile-model\n---\nprofile body\n");
  await writeFile(path.join(home, ".questions", "only.md"), "---\nmodel: only-model\n---\nprofile-only body\n");
  await writeFile(
    path.join(cwd, ".questions", "demo.md"),
    '---\ndescription: "Demo ask"\nmodel: folder-model\n---\nfolder body\n',
  );
  return { home, cwd };
}

test("folder ask shadows profile ask of the same name", async () => {
  const { home, cwd } = await makeFixture();
  const hit = await resolveAsk("demo", cwd, home);
  assert.ok(hit);
  assert.equal(hit.source, "folder");
  assert.ok(hit.file.startsWith(cwd));
});

test("profile-only ask resolves from the profile dir", async () => {
  const { home, cwd } = await makeFixture();
  const hit = await resolveAsk("only", cwd, home);
  assert.ok(hit);
  assert.equal(hit.source, "profile");
  assert.ok(hit.file.startsWith(home));
});

test("missing ask resolves to undefined", async () => {
  const { home, cwd } = await makeFixture();
  assert.equal(await resolveAsk("nope", cwd, home), undefined);
});

test("resolveConfig layers profile and folder env without mutating process.env", async () => {
  const { home, cwd } = await makeFixture();
  await writeFile(path.join(home, ".questions", ".env"), "TYPESAFE_API_KEY=profile-key\nPROFILE_VAR=1\n");
  await writeFile(path.join(cwd, ".questions", ".env"), "TYPESAFE_API_KEY=folder-key\nFOLDER_VAR=2\n");
  const cfg = await resolveConfig(cwd, home, {});
  assert.equal(cfg.apiKey, "folder-key");
  assert.equal(cfg.env.PROFILE_VAR, "1");
  assert.equal(cfg.env.FOLDER_VAR, "2");
});
