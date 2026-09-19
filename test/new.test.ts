import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseAsk } from "../src/askfile.ts";
import { renderPrompts } from "../src/render.ts";
import { cmdNew, parseRunArgs } from "../src/cli.ts";
import { newAskTemplate } from "../src/template.ts";

test("the scaffold template parses into a valid ask", () => {
  const ask = parseAsk(newAskTemplate("review"), "review.md");
  assert.equal(ask.meta.model, "jev-latest");
  assert.deepEqual(ask.meta.args, { focus: "general quality" });
  assert.deepEqual(ask.tools, []); // guidance comment must not become a tool fence
  assert.deepEqual(Object.keys(ask.schema ?? {}), ["severity", "flag"]);
  assert.ok(ask.body.includes("$filename"));
  assert.ok(ask.body.includes("$content"));
});

test("the scaffold renders end-to-end without prompting", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "aj-new-"));
  await mkdir(path.join(dir, "src"), { recursive: true });
  await writeFile(path.join(dir, "src", "a.ts"), "export const x = 1;\n");
  const prompts = await renderPrompts({
    ask: parseAsk(newAskTemplate("review")),
    files: ["src/a.ts"],
    tokens: {},
    readText: (p) => readFile(path.join(dir, p), "utf8"),
  });
  assert.equal(prompts.length, 1);
  assert.ok(prompts[0]!.prompt.includes("# Review request — ask 'review'"));
  assert.ok(prompts[0]!.prompt.includes("Review src/a.ts with attention to general quality."));
  assert.ok(prompts[0]!.prompt.includes("export const x = 1;"));
});

test("cmdNew scaffolds, refuses overwrite, forces overwrite", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "aj-cmdnew-"));
  assert.equal(await cmdNew("review", [], dir), 0);
  const file = path.join(dir, ".ask", "review.md");
  const first = await readFile(file, "utf8");
  await assert.rejects(cmdNew("review", [], dir), /already exists.*--force/);
  await writeFile(file, "clobbered");
  assert.equal(await cmdNew("review", ["--force"], dir), 0);
  assert.equal(await readFile(file, "utf8"), first);
});

test("cmdNew rejects bad names and extra flags", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "aj-cmdnew-"));
  await assert.rejects(cmdNew("../evil", [], dir), /invalid ask name/);
  await assert.rejects(cmdNew(".hidden", [], dir), /invalid ask name/);
  await assert.rejects(cmdNew("ok", ["-f", "x"], dir), /new takes only --force/);
});

test("scaffolded ask round-trips through the real CLI run path", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "aj-roundtrip-"));
  await mkdir(path.join(dir, "src"), { recursive: true });
  await writeFile(path.join(dir, "src", "a.ts"), "const x = 1;\n");
  await cmdNew("review", [], dir);
  const found = await import("../src/config.ts").then((m) => m.resolveAsk("review", dir));
  assert.ok(found, "scaffolded ask is discoverable");
  assert.equal(found!.source, "folder");
  const parsed = parseAsk(await readFile(found!.file, "utf8"));
  const flags = parseRunArgs(["-f", "src/*.ts"]);
  const prompts = await renderPrompts({
    ask: parsed,
    files: await import("../src/render.ts").then((m) => m.expandInputs(flags.files, dir)),
    tokens: flags.tokens,
    readText: (p) => readFile(path.join(dir, p), "utf8"),
  });
  assert.ok(prompts[0]!.prompt.includes("const x = 1;"));
});
