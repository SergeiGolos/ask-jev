import assert from "node:assert/strict";
import { test } from "node:test";
import { cmdServe } from "../src/cli.ts";
import { CliError } from "../src/errors.ts";

test("cmdServe help flag returns 0", async () => {
  const originalLog = console.log;
  let logged = "";
  console.log = (msg: string) => {
    logged += msg + "\n";
  };
  try {
    const code = await cmdServe(["--help"]);
    assert.equal(code, 0);
    assert.ok(logged.includes("ask serve"));
    assert.ok(logged.includes("--port"));
  } finally {
    console.log = originalLog;
  }
});

test("cmdServe validates invalid port and unknown arguments", async () => {
  await assert.rejects(
    () => cmdServe(["--port", "abc"]),
    (err: unknown) => err instanceof CliError && err.message.includes("--port requires an integer"),
  );

  await assert.rejects(
    () => cmdServe(["--invalid-arg"]),
    (err: unknown) => err instanceof CliError && err.message.includes("unknown argument '--invalid-arg'"),
  );
});
