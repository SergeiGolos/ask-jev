import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseAsk } from "../src/askfile.ts";
import { expandInputs, placeholders, renderPrompts } from "../src/render.ts";
import { parseRunArgs } from "../src/cli.ts";

const ASK = [
  "---",
  "model: m",
  "args:",
  "  focus: races",
  "---",
  "Review {{filename}} for {{focus}}.",
  "",
  "```shell",
  "echo x {{filename}}",
  "```",
  "",
  "{{content}}",
  "",
  "---",
  "severity:",
  "  type: score",
  "  instructions: i",
  "  criteria:",
  "    - low",
  "    - high",
  "",
].join("\n");

const BATCH_ASK = [
  "---",
  "model: m",
  "---",
  "List:",
  "{{file}}",
  "",
  "{{content}}",
  "",
].join("\n");

async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "aj-render-"));
  await mkdir(path.join(dir, "src"), { recursive: true });
  await writeFile(path.join(dir, "src", "a.md"), "alpha\nbeta\n");
  await writeFile(path.join(dir, "src", "b.md"), "top\n");
  return dir;
}

const echoTool = async (cmd: string) => `OUT(${cmd})`;

test("golden single-file render: tokens substituted, tool inlined, content embedded", async () => {
  const dir = await fixture();
  const prompts = await renderPrompts({
    ask: parseAsk(ASK),
    files: ["src/a.md"],
    tokens: { focus: "concurrency" }, // -t overrides front-matter args (races)
    runTool: echoTool,
    readText: (p) => readFileFrom(dir, p),
  });
  assert.deepEqual(
    prompts.map((p) => p.prompt),
    [
      [
        "Review src/a.md for concurrency.",
        "",
        "```output",
        "$ echo x src/a.md",
        "OUT(echo x src/a.md)",
        "```",
        "",
        "alpha",
        "beta",
        "",
      ].join("\n"),
    ],
  );
  assert.deepEqual(prompts[0]!.tools, ["echo x src/a.md"]);
});

test("front-matter args apply when -t is silent", async () => {
  const dir = await fixture();
  const [rendered] = await renderPrompts({
    ask: parseAsk(ASK),
    files: ["src/a.md"],
    tokens: {},
    runTool: echoTool,
    readText: (p) => readFileFrom(dir, p),
  });
  assert.ok(rendered!.prompt.startsWith("Review src/a.md for races."));
});

test("per-file mode renders one prompt per file, in order", async () => {
  const dir = await fixture();
  const prompts = await renderPrompts({
    ask: parseAsk(ASK),
    files: ["src/a.md", "src/b.md"],
    tokens: { focus: "x" },
    runTool: echoTool,
    readText: (p) => readFileFrom(dir, p),
  });
  assert.equal(prompts.length, 2);
  assert.ok(prompts[0]!.prompt.includes("Review src/a.md for x."));
  assert.ok(prompts[1]!.prompt.includes("Review src/b.md for x."));
  assert.ok(prompts[1]!.prompt.includes("top"));
});

test("batch mode: one prompt, {{file}} list, {{content}} under ## headings", async () => {
  const dir = await fixture();
  const prompts = await renderPrompts({
    ask: parseAsk(BATCH_ASK),
    files: ["src/a.md", "src/b.md"],
    tokens: {},
    batch: true,
    readText: (p) => readFileFrom(dir, p),
  });
  assert.deepEqual(
    prompts.map((p) => p.prompt),
    ["List:\nsrc/a.md\nsrc/b.md\n\n## src/a.md\nalpha\nbeta\n\n## src/b.md\ntop\n"],
  );
});

test("{{filename}} in batch mode is a run error", async () => {
  await assert.rejects(
    renderPrompts({
      ask: parseAsk("---\nmodel: m\n---\n{{filename}}\n"),
      files: ["a.md"],
      tokens: {},
      batch: true,
    }),
    /ambiguous in --batch/,
  );
});

test("missing token: prompted once per run, not per file", async () => {
  const dir = await fixture();
  let calls = 0;
  const prompts = await renderPrompts({
    ask: parseAsk("---\nmodel: m\n---\nLimit: {{limit}}\n"),
    files: ["src/a.md", "src/b.md"],
    tokens: {},
    prompt: async (name) => {
      calls++;
      return name === "limit" ? "5" : "?";
    },
    readText: (p) => readFileFrom(dir, p),
  });
  assert.equal(calls, 1);
  assert.deepEqual(
    prompts.map((p) => p.prompt),
    ["Limit: 5\n", "Limit: 5\n"],
  );
});

test("missing token with the default prompt adapter off-TTY is a hard error", async () => {
  await assert.rejects(
    renderPrompts({
    ask: parseAsk("---\nmodel: m\n---\nLimit: {{limit}}\n"),
    files: ["src/a.md"],
    tokens: {},
    isTTY: () => false,
    }),
    /missing token '\{\{limit\}\}'/,
  );
});

test("a built-in referenced with no -f is a hard error, not a prompt", async () => {
  await assert.rejects(
    renderPrompts({ ask: parseAsk("---\nmodel: m\n---\n{{file}}\n"), files: [], tokens: {} }),
    /no -f input was given/,
  );
});

test("tool failure fails the run", async () => {
  await assert.rejects(
    renderPrompts({
      ask: parseAsk("---\nmodel: m\n---\n```shell\necho x\n```\n"),
      files: ["src/a.md"],
      tokens: {},
      runTool: async () => {
        throw new Error("boom");
      },
    }),
    /boom/,
  );
});

test("expandInputs: globs expand sorted, patterns dedupe, misses and directories error", async () => {
  const dir = await fixture();
  assert.deepEqual(await expandInputs(["src/*.md"], dir), ["src/a.md", "src/b.md"]);
  assert.deepEqual(await expandInputs(["src/b.md", "src/*.md"], dir), ["src/b.md", "src/a.md"]); // dedupe keeps first position
  await assert.rejects(expandInputs(["nope.md"], dir), /matched no files/);
  await assert.rejects(expandInputs(["src"], dir), /is a directory/);
});

test("placeholders extracts {{names}}, including inside sections", () => {
  assert.deepEqual(placeholders("{{file}} and {{filename_2}} and {{snug}}"), ["file", "filename_2", "snug"]);
  assert.deepEqual(placeholders("{{#sec}}{{inner}}{{/sec}}"), ["sec", "inner"]);
  assert.deepEqual(placeholders("no tokens, {{! comment}} here"), []);
});

test("parseRunArgs: repeatable -f, -t k=v, boolean flags", () => {
  const flags = parseRunArgs([
    "-f",
    "a",
    "-f",
    "b/**",
    "-t",
    "k=v",
    "-t",
    "empty=",
    "--batch",
    "--verbose",
    "--json",
  ]);
  assert.deepEqual(flags.files, ["a", "b/**"]);
  assert.deepEqual(flags.tokens, { k: "v", empty: "" });
  assert.equal(flags.batch, true);
  assert.equal(flags.verbose, true);
  assert.equal(flags.json, true);
});

test("parseRunArgs: captures multiple questions positionally, via -q, and comma-separated", () => {
  const p1 = parseRunArgs(["q1", "q2", "-f", "a"]);
  assert.deepEqual(p1.questions, ["q1", "q2"]);
  assert.deepEqual(p1.files, ["a"]);

  const p2 = parseRunArgs(["-q", "q1", "-q", "q2", "-f", "a"]);
  assert.deepEqual(p2.questions, ["q1", "q2"]);

  const p3 = parseRunArgs(["q1,q2", "-f", "a"]);
  assert.deepEqual(p3.questions, ["q1", "q2"]);
});

test("parseRunArgs: collects multiple files after -f (shell glob expansion)", () => {
  const flags = parseRunArgs(["gut-check/boy-scout", "-f", "src/a.ts", "src/b.ts", "src/c.ts"]);
  assert.deepEqual(flags.questions, ["gut-check/boy-scout"]);
  assert.deepEqual(flags.files, ["src/a.ts", "src/b.ts", "src/c.ts"]);
});

test("parseRunArgs rejects: missing value, malformed -t, reserved token, unknown flag", () => {
  assert.throws(() => parseRunArgs(["-f"]), /'-f' needs a value/);
  assert.throws(() => parseRunArgs(["-t", "novalue"]), /-t expects name=value/);
  assert.throws(() => parseRunArgs(["-t", "file=x"]), /cannot be overridden/);
  assert.throws(() => parseRunArgs(["--wat"]), /unknown argument '--wat'/);
});

function readFileFrom(dir: string, p: string): Promise<string> {
  return readFile(path.join(dir, p), "utf8");
}

/** Local http server for URL-input tests; always close() in a finally. */
async function serve(body: string, status = 200): Promise<{ url: string; close: () => void }> {
  const srv = http.createServer((_req, res) => {
    res.writeHead(status, { "content-type": "text/plain" });
    res.end(body);
  });
  await new Promise<void>((resolve) => srv.listen(0, "127.0.0.1", resolve));
  const addr = srv.address();
  if (!addr || typeof addr === "string") throw new Error("listen failed");
  return { url: `http://127.0.0.1:${addr.port}/doc.md`, close: () => srv.close() };
}

test("expandInputs: URLs pass through verbatim, dedupe, and mix with files in order", async () => {
  const dir = await fixture();
  const a = "https://example.com/a.md";
  const b = "https://example.com/b.md";
  const files = await expandInputs([a, "src/*.md", b, a], dir);
  assert.deepEqual(files, [a, "src/a.md", "src/b.md", b]);
});

test("URL input: raw body as {{content}}, {{file}}/{{filename}} are the URL", async () => {
  const dir = await fixture();
  const srv = await serve("alpha\nbeta\n");
  try {
    const prompts = await renderPrompts({
      ask: parseAsk(ASK),
      files: [srv.url],
      tokens: { focus: "x" },
      cwd: dir,
      runTool: echoTool,
    });
    assert.ok(prompts[0]!.prompt.includes(`Review ${srv.url} for x.`));
    assert.ok(prompts[0]!.prompt.includes("alpha\nbeta"));
    assert.deepEqual(prompts[0]!.tools, [`echo x ${srv.url}`]);
  } finally {
    srv.close();
  }
});

test("URL input: HTTP error status fails the run", async () => {
  const dir = await fixture();
  const srv = await serve("nope", 404);
  try {
    await assert.rejects(
      renderPrompts({ ask: parseAsk(ASK), files: [srv.url], tokens: { focus: "x" }, cwd: dir, runTool: echoTool }),
      /HTTP 404/,
    );
  } finally {
    srv.close();
  }
});
