import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CliError } from "../src/errors.ts";
import { listRuns } from "../src/history.ts";
import { cmdClean } from "../src/cli.ts";

async function fixture(runs: number): Promise<string> {
  const cwd = await mkdtemp(path.join(tmpdir(), "aj-clean-"));
  for (let i = 0; i < runs; i++) {
    const dir = path.join(cwd, ".questions", "history", `2026010${i + 1}000000-aaaa-run-${i}`);
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "run.json"),
      JSON.stringify({
        runId: `2026010${i + 1}000000-aaaa-run-${i}`,
        timestamp: `2026-01-0${i + 1}T00:00:00.000Z`,
        ask: "a",
        askSource: "folder",
        model: "m",
        files: [],
        argv: [],
        pairs: [],
      }),
    );
  }
  return cwd;
}

test("cmdClean refuses without --force and wipes history with it", async () => {
  const cwd = await fixture(2);
  await assert.rejects(
    () => cmdClean([], cwd),
    (err: unknown) =>
      err instanceof CliError && err.message.includes("refusing to delete 2 runs") && err.message.includes("--force"),
  );
  assert.equal(await stat(path.join(cwd, ".questions", "history")).then(() => true, () => false), true);
  assert.equal(await cmdClean(["--force"], cwd), 0);
  assert.equal((await listRuns(cwd)).length, 0);
  assert.equal(await stat(path.join(cwd, ".questions", "history")).then(() => true, () => false), false);
});

test("cmdClean with no history is a no-op exit 0", async () => {
  const cwd = await fixture(0);
  assert.equal(await cmdClean([], cwd), 0);
  assert.equal(await cmdClean(["--force"], cwd), 0);
});

test("cmdClean rejects unknown arguments", async () => {
  const cwd = await fixture(1);
  await assert.rejects(
    () => cmdClean(["--purge"], cwd),
    (err: unknown) => err instanceof CliError,
  );
});
