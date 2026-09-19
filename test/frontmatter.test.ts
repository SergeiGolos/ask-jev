import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { splitFrontMatter, readAskMeta } from "../src/frontmatter.ts";

test("splitFrontMatter splits a leading block and keeps the body verbatim", () => {
  const text = "---\nmodel: jev-latest\nargs:\n  focus: security\n---\nReview $filename.\n\n```\n---\n```\n";
  const { data, body } = splitFrontMatter(text);
  assert.deepEqual(data, { model: "jev-latest", args: { focus: "security" } });
  assert.equal(body, "Review $filename.\n\n```\n---\n```\n");
});

test("splitFrontMatter treats a file without front matter as all body", () => {
  const { data, body } = splitFrontMatter("Just a question.\n");
  assert.deepEqual(data, {});
  assert.equal(body, "Just a question.\n");
});

test("splitFrontMatter rejects an unterminated block", () => {
  assert.throws(() => splitFrontMatter("---\nmodel: x\n"), /unterminated front matter/);
});

test("splitFrontMatter rejects a non-mapping block", () => {
  assert.throws(() => splitFrontMatter("---\n- just\n- a list\n---\nbody\n"), /must be a YAML mapping/);
});

test("readAskMeta reads model and scalar args", () => {
  const meta = readAskMeta({ model: "m", args: { n: 3, ok: true, s: "x" } });
  assert.deepEqual(meta, { model: "m", args: { n: 3, ok: true, s: "x" } });
});

test("readAskMeta rejects non-scalar args and non-string model", () => {
  assert.throws(() => readAskMeta({ args: { bad: { a: 1 } } }), /args\.bad' must be a scalar/);
  assert.throws(() => readAskMeta({ model: 7 }), /'model' must be a string/);
});

test("readAskMeta names the source file in errors", () => {
  assert.throws(() => readAskMeta({ model: 7 }, "/tmp/x.md"), /\/tmp\/x\.md/);
});

test("temp dir helper sanity", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "aj-"));
  await mkdir(path.join(dir, ".questions"), { recursive: true });
  await writeFile(path.join(dir, ".questions", "a.md"), "x");
  assert.ok(dir.includes("aj-"));
});
