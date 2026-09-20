import test from "node:test";
import assert from "node:assert/strict";
import { insert, newDir } from "../src/pathtree.ts";

test("insert nests files into directories, tracking dir paths", () => {
  const root = newDir<string>("root", "");
  insert(root, ["src", "deep", "a.ts"], "src/deep/a.ts", "A");
  insert(root, ["src", "b.ts"], "src/b.ts", "B");

  const src = root.dirs.get("src")!;
  assert.equal(src.path, "src");
  const deep = src.dirs.get("deep")!;
  assert.equal(deep.path, "src/deep");
  assert.equal(deep.files.get("a.ts"), "A");
  assert.equal(src.files.get("b.ts"), "B");
  assert.equal(root.files.size, 0);
});

test("insert keys a root-level file by its own name", () => {
  const root = newDir<string>("root", "");
  insert(root, ["top.ts"], "top.ts", "T");
  assert.equal(root.files.get("top.ts"), "T");
});
