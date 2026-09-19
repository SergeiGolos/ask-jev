import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resolveAsk, listAsks, loadAskEnv } from "../src/config.ts";

/** Fixture layout: fake HOME with a profile .ask, fake project dir with a folder .ask. */
async function makeFixture() {
  const home = await mkdtemp(path.join(tmpdir(), "aj-home-"));
  const cwd = await mkdtemp(path.join(tmpdir(), "aj-cwd-"));
  await mkdir(path.join(home, ".ask"), { recursive: true });
  await mkdir(path.join(cwd, ".ask"), { recursive: true });
  await writeFile(path.join(home, ".ask", "demo.md"), "---\nmodel: profile-model\n---\nprofile body\n");
  await writeFile(path.join(home, ".ask", "only.md"), "---\nmodel: only-model\n---\nprofile-only body\n");
  await writeFile(path.join(cwd, ".ask", "demo.md"), "---\nmodel: folder-model\n---\nfolder body\n");
  await writeFile(path.join(cwd, ".ask", ".env"), "SHADOW=folder\nFOLDERONLY=folder\n");
  await writeFile(path.join(home, ".ask", ".env"), "SHADOW=profile\nONLYPROFILE=profile\n");
  return { home, cwd };
}

/** Point homedir() at the fixture and snapshot/restore every env var the test touches. */
async function withFixture(fn: (fx: { home: string; cwd: string }) => Promise<void>) {
  const fx = await makeFixture();
  const savedHome = process.env.HOME;
  const saved = { SHADOW: process.env.SHADOW, ONLYPROFILE: process.env.ONLYPROFILE, FOLDERONLY: process.env.FOLDERONLY };
  process.env.HOME = fx.home;
  delete process.env.SHADOW;
  delete process.env.ONLYPROFILE;
  delete process.env.FOLDERONLY;
  try {
    await fn(fx);
  } finally {
    process.env.HOME = savedHome;
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("folder ask shadows profile ask of the same name", async () => {
  await withFixture(async ({ cwd }) => {
    const hit = await resolveAsk("demo", cwd);
    assert.ok(hit);
    assert.equal(hit.source, "folder");
    assert.ok(hit.file.startsWith(cwd));
  });
});

test("profile-only ask resolves from ~/.ask", async () => {
  await withFixture(async ({ cwd, home }) => {
    const hit = await resolveAsk("only", cwd);
    assert.ok(hit);
    assert.equal(hit.source, "profile");
    assert.ok(hit.file.startsWith(home));
  });
});

test("missing ask resolves to undefined", async () => {
  await withFixture(async ({ cwd }) => {
    assert.equal(await resolveAsk("nope", cwd), undefined);
  });
});

test("loadAskEnv: real env beats .env files, folder beats profile", async () => {
  await withFixture(async ({ cwd }) => {
    process.env.SHADOW = "real";
    await loadAskEnv(cwd);
    assert.equal(process.env.SHADOW, "real"); // real environment wins over both .env files
    assert.equal(process.env.FOLDERONLY, "folder"); // folder .env applied
    assert.equal(process.env.ONLYPROFILE, "profile"); // profile .env applied where folder is silent
  });
});

test("list shows both sources distinctly, folder model on clash", async () => {
  await withFixture(async ({ cwd }) => {
    const asks = await listAsks(cwd);
    assert.deepEqual(
      asks.map((a) => [a.name, a.source, a.model]),
      [
        ["demo", "folder", "folder-model"],
        ["only", "profile", "only-model"],
      ],
    );
  });
});

test("list keeps going on a corrupt ask", async () => {
  await withFixture(async ({ cwd }) => {
    await writeFile(path.join(cwd, ".ask", "broken.md"), "---\nmodel: 7\n---\n");
    const asks = await listAsks(cwd);
    assert.equal(asks.find((a) => a.name === "broken")?.model, "(invalid)");
  });
});
