import test from "node:test";
import assert from "node:assert/strict";
import { layeredEnv } from "../src/env.ts";

const read = (files: Record<string, string>) => async (p: string) => {
  if (!(p in files)) throw new Error("ENOENT");
  return files[p]!;
};

test("layeredEnv: later files win, missing files are skipped", async () => {
  const vars = await layeredEnv(["profile.env", "folder.env", "absent.env"], read({
    "profile.env": "SHADOW=profile\nONLY=profile\n",
    "folder.env": "SHADOW=folder\n",
  }));
  assert.deepEqual(vars, { SHADOW: "folder", ONLY: "profile" });
});

test("layeredEnv parses values, strips quotes, ignores junk lines", async () => {
  const vars = await layeredEnv(["a.env"], read({ "a.env": "# comment\nK=v\nQ='quoted'\nD=\"dq\"\nnoequals\n" }));
  assert.deepEqual(vars, { K: "v", Q: "quoted", D: "dq" });
});
