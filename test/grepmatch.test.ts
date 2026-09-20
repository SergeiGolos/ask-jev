import test from "node:test";
import assert from "node:assert/strict";
import { grepMatcher } from "../src/grepmatch.ts";

test("grepMatcher: case-insensitive regex, anchored or plain", () => {
  const ts = grepMatcher("\\.ts$");
  assert.ok(ts("src/a.ts"));
  assert.ok(ts("src/A.TS"));
  assert.ok(!ts("src/a.tsx"));
  const plain = grepMatcher("Solid");
  assert.ok(plain("src/solid-review.md"));
});

test("grepMatcher: invalid regex falls back to literal case-insensitive substring", () => {
  const m = grepMatcher("a(b");
  assert.ok(m("src/a(b.ts"));
  assert.ok(m("SRC/A(B.TS"));
  assert.ok(!m("src/ab.ts"));
});
