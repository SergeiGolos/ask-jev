#!/usr/bin/env node
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { readAsk } from "./askfile.ts";
import { askDirs, listAsks, loadAskEnv, resolveAsk } from "./config.ts";
import { findRun, historyDir, listRuns, readPair, recordRun, type PairInput } from "./history.ts";
import { judge, judgeState, prettyPair, type JudgeResult } from "./judge.ts";
import { expandInputs, renderPrompts } from "./render.ts";
import { writeReport } from "./report.ts";
import { newAskTemplate } from "./template.ts";

export class CliError extends Error {}

export async function main(argv: string[]): Promise<number> {
  await loadAskEnv();
  const [cmd, ...rest] = argv;
  if (cmd === undefined || cmd === "-h" || cmd === "--help") return usage(0);
  if (cmd === "list") return cmdList();
  if (cmd === "new") {
    const name = rest[0];
    if (name === undefined) throw new CliError("new needs a <name>");
    return cmdNew(name, rest.slice(1));
  }
  if (cmd === "history") return cmdHistory(rest);
  if (cmd === "show") return cmdShow(rest);
  if (cmd === "report") return cmdReport(rest);
  return cmdRun(cmd, rest);
}

function usage(code: number): number {
  console.log(`ask-jev — run hand-authored asks, judged by TypeSafe System One

Usage:
  ask-jev list                                     list discovered asks (folder ./.ask shadows profile ~/.ask)
  ask-jev new <name>                               scaffold a new ask
  ask-jev <question-name> -f <path|glob>...        run an ask, one judge call per file
        [-t name=value]... [--batch] [--verbose] [--json] [--html]
  ask-jev history [run-id]                         list runs, or one run's pairs
  ask-jev show <run-id> [pair]                     print a pair's request md + response json
  ask-jev report [run-id] [-o file]                write the HTML report (default: latest run)
`);
  return code;
}

async function cmdList(): Promise<number> {
  const asks = await listAsks();
  if (asks.length === 0) {
    const { folder, profile } = askDirs();
    console.log(`no asks found (looked in ${folder} and ${profile})`);
    return 0;
  }
  const width = (get: (a: (typeof asks)[number]) => string, label: string) =>
    Math.max(label.length, ...asks.map((a) => get(a).length));
  const nameW = width((a) => a.name, "NAME");
  const srcW = width((a) => a.source, "SOURCE");
  const modelW = width((a) => a.model, "MODEL");
  const pad = (s: string, w: number) => s + " ".repeat(w - s.length);
  console.log(`${pad("NAME", nameW)}  ${pad("SOURCE", srcW)}  ${pad("MODEL", modelW)}`);
  for (const a of asks)
    console.log(`${pad(a.name, nameW)}  ${pad(a.source, srcW)}  ${pad(a.model, modelW)}`);
  return 0;
}

export interface RunFlags {
  files: string[];
  tokens: Record<string, string>;
  batch: boolean;
  verbose: boolean;
  json: boolean;
  html: boolean;
}

export function parseRunArgs(rest: string[]): RunFlags {
  const flags: RunFlags = { files: [], tokens: {}, batch: false, verbose: false, json: false, html: false };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    const value = (): string => {
      const v = rest[i + 1];
      if (v === undefined) fail(`'${a}' needs a value`);
      i++;
      return v;
    };
    if (a === "-f") flags.files.push(value());
    else if (a === "-t") {
      const kv = value();
      const eq = kv.indexOf("=");
      if (eq <= 0) fail(`-t expects name=value, got '${kv}'`);
      flags.tokens[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else if (a === "--batch") flags.batch = true;
    else if (a === "--verbose") flags.verbose = true;
    else if (a === "--json") flags.json = true;
    else if (a === "--html") flags.html = true;
    else fail(`unknown argument '${a}'`);
  }
  for (const k of Object.keys(flags.tokens))
    if (k === "file" || k === "filename" || k === "content")
      fail(`token '${k}' is built from -f and cannot be overridden with -t`);
  return flags;
}

function fail(msg: string): never {
  throw new CliError(
    `${msg}\n(usage: ask-jev <question-name> -f <path|glob>... [-t name=value]... [--batch] [--verbose] [--json])`,
  );
}

/** Scaffold ./.ask/<name>.md from the built-in template; refuses to overwrite without --force. */
export async function cmdNew(name: string, rest: string[], cwd: string = process.cwd()): Promise<number> {
  const force = rest.includes("--force");
  const unsupported = rest.filter((a) => a !== "--force");
  if (unsupported.length > 0) fail(`new takes only --force, got '${unsupported.join(" ")}'`);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) fail(`invalid ask name '${name}': use letters, digits, '-', '_'`);
  const dir = path.join(cwd, ".ask");
  const file = path.join(dir, `${name}.md`);
  if (!force) {
    let exists = false;
    try {
      exists = (await stat(file)).isFile();
    } catch {
      // absent — the good case
    }
    if (exists) fail(`ask already exists: ${file} (use --force to overwrite)`);
  }
  await mkdir(dir, { recursive: true });
  await writeFile(file, newAskTemplate(name));
  console.log(`created ${file}
edit it, then run: ask-jev ${name} -f <file>`);
  return 0;
}

async function cmdHistory(rest: string[]): Promise<number> {
  if (rest.length === 0) {
    const runs = await listRuns(process.cwd());
    if (runs.length === 0) {
      console.log(`no runs recorded yet (looked in ${historyDir(process.cwd())})`);
      return 0;
    }
    const width = (get: (r: (typeof runs)[number]) => string, label: string) =>
      Math.max(label.length, ...runs.map((r) => get(r).length));
    const idW = width((r) => r.runId.slice(0, 8), "RUN");
    const whenW = width((r) => r.timestamp.replace("T", " ").slice(0, 19), "WHEN");
    const askW = width((r) => r.ask, "ASK");
    const pad = (s: string, w: number) => s + " ".repeat(w - s.length);
    console.log(`${pad("RUN", idW)}  ${pad("WHEN", whenW)}  ${pad("ASK", askW)}  PAIRS`);
    for (const r of runs)
      console.log(
        `${pad(r.runId.slice(0, 8), idW)}  ${pad(r.timestamp.replace("T", " ").slice(0, 19), whenW)}  ${pad(r.ask, askW)}  ${r.pairCount}`,
      );
    return 0;
  }
  if (rest.length > 1) fail("history takes at most one <run-id>");
  const { manifest } = await findRun(process.cwd(), rest[0]!);
  for (const p of manifest.pairs)
    console.log(`${String(p.n).padStart(3)}  ${p.file}  (${p.request} / ${p.response})`);
  return 0;
}

async function cmdShow(rest: string[]): Promise<number> {
  const [prefix, pairSel] = rest;
  if (prefix === undefined) fail("show needs a <run-id>");
  const { manifest, dir } = await findRun(process.cwd(), prefix);
  let pairs = manifest.pairs;
  if (pairSel !== undefined) {
    const n = Number(pairSel);
    if (!Number.isInteger(n) || n <= 0) fail(`pair selector must be a positive number, got '${pairSel}'`);
    pairs = pairs.filter((p) => p.n === n);
    if (pairs.length === 0) fail(`no pair #${pairSel} in run ${manifest.runId}`);
  }
  for (const p of pairs) {
    const { request, response } = await readPair(dir, p);
    console.log(`=== pair ${p.n}: ${p.file} (${p.request}) ===`);
    console.log(request);
    console.log(`=== response (${p.response}) ===`);
    console.log(JSON.stringify(response, null, 2));
  }
  return 0;
}

async function cmdReport(rest: string[]): Promise<number> {
  let prefix: string | undefined;
  let out: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "-o") {
      out = rest[++i];
      if (out === undefined) fail("'-o' needs a value");
    } else if (a.startsWith("-")) {
      fail(`unknown argument '${a}'`);
    } else if (prefix === undefined) {
      prefix = a;
    } else {
      fail(`unexpected argument '${a}'`);
    }
  }
  const written = await writeReport(process.cwd(), prefix, out);
  console.log(`report written: ${written}`);
  return 0;
}

async function cmdRun(name: string, rest: string[], cwd: string = process.cwd()): Promise<number> {
  const flags = parseRunArgs(rest);
  const found = await resolveAsk(name, cwd);
  if (!found) {
    const { folder, profile } = askDirs(cwd);
    console.error(`no ask '${name}' in ${folder} or ${profile}`);
    return 1;
  }
  const ask = await readAsk(found.file);
  if (!ask.schema || Object.keys(ask.schema).length === 0)
    throw new CliError(`ask '${name}' has no questions schema — add one after the final ---`);
  const files = await expandInputs(flags.files, cwd);
  const rendered = await renderPrompts({
    ask,
    files,
    tokens: flags.tokens,
    batch: flags.batch,
    onToolStart: flags.verbose ? (cmd) => console.error(`[tool] $ ${cmd}`) : undefined,
  });
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new CliError("TYPESAFE_API_KEY is not set — put it in .ask/.env or export it");
  const model = ask.meta.model ?? "jev-latest";

  const pairs: PairInput[] = [];
  for (let i = 0; i < rendered.length; i++) {
    const r = rendered[i]!;
    const file = flags.batch || files.length === 0 ? "batch" : files[i]!;
    const t0 = Date.now();
    const res = await judge({
      key,
      model,
      questions: ask.schema,
      state: judgeState(file, r.prompt, !flags.batch && files.length > 0),
    });
    const latencyMs = Date.now() - t0;
    if (flags.verbose) console.error(`[judge] ${file} ${res.model} ${latencyMs} ms`);
    pairs.push({
      file,
      request: r.prompt,
      response: res,
      notes: { tools: r.tools.map((command) => ({ command })), judge: { model: res.model, usage: res.usage, latencyMs } },
    });
  }

  const manifest = await recordRun(cwd, {
    ask: name,
    askSource: found.source,
    model,
    files,
    argv: [name, ...rest],
    pairs,
    schema: ask.schema,
  });

  if (flags.json) {
    console.log(JSON.stringify({ runId: manifest.runId, model, pairs: pairs.map((p) => ({ file: p.file, answers: (p.response as JudgeResult).answers })) }, null, 2));
  } else {
    for (const p of pairs) console.log(prettyPair(p.file, p.response));
  }
  if (flags.verbose) console.error(`run ${manifest.runId} recorded`);
  if (flags.html) {
    const report = await writeReport(cwd, manifest.runId, path.join(historyDir(cwd), manifest.runId, "report.html"));
    if (flags.verbose) console.error(`[report] ${report}`);
  }
  return 0;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = e instanceof CliError ? 2 : 1;
  }
}
