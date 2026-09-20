#!/usr/bin/env node
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { formatPair, runTable, type RunTablePair } from "./answers.ts";
import { askDirs, expandAskNames, listAsks, resolveConfig } from "./config.ts";
import { CliError } from "./errors.ts";
import { cleanRuns, findPreviousRunForFile, findRun, getPreviousAnswersForFile, getRunReportPath, historyDir, listRuns, readPair, type RunManifest } from "./history.ts";
import { buildTreeData, loadAllManifests } from "./matrix.ts";
import { BUILTIN } from "./render.ts";
import { writeReport } from "./report.ts";
import { runAsk, type RunResult } from "./run.ts";
import { startServer } from "./serve.ts";
import { newAskTemplate } from "./askfile.ts";

export async function main(argv: string[], cwdOverride?: string): Promise<number> {
  const config = await resolveConfig(cwdOverride);
  for (const [k, v] of Object.entries(config.env))
    if (process.env[k] === undefined) process.env[k] = v;
  const [cmd, ...rest] = argv;
  if (cmd === undefined || cmd === "-h" || cmd === "--help") return usage(0);
  if (cmd === "list") return cmdList();
  if (cmd === "new") {
    const name = rest[0];
    if (name === undefined) throw new CliError("new needs a <name>");
    return cmdNew(name, rest.slice(1));
  }
  if (cmd === "history") return cmdHistory(rest);
  if (cmd === "clean") return cmdClean(rest);
  if (cmd === "show") return cmdShow(rest);
  if (cmd === "report") return cmdReport(rest);
  if (cmd === "serve") return cmdServe(rest);
  return cmdRun(argv, config.cwd, config.apiKey);
}

function usage(code: number): number {
  console.log(`ask — run hand-authored asks, judged by TypeSafe System One

Usage:
  ask list                                         list discovered asks with descriptions (folder ./.questions shadows profile ~/.questions)
  ask new <name>                                   scaffold a new ask
  ask <question-name>... -f <path|glob>...         run asks, one judge call per file
        [-t name=value]... [--batch] [--verbose] [--json] [--html]
  ask history [run-id]                             list runs, or one run's pairs
  ask history [run-id] -f <file>                   diff a file's answers vs the prior run
  ask clean [--force]                              delete all recorded runs (.questions/history)
  ask show <run-id> [pair]                         print a pair's request md + response json
  ask report [run-id] [-o file]                    write the HTML report (default: latest run)
  ask serve [path] [--port 3000]                   serve trend matrix web dashboard over history
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
  const descW = width((a) => a.description, "DESCRIPTION");
  const pad = (s: string, w: number) => s + " ".repeat(w - s.length);
  console.log(`${pad("NAME", nameW)}  ${pad("SOURCE", srcW)}  ${pad("MODEL", modelW)}  DESCRIPTION`);
  for (const a of asks)
    console.log(`${pad(a.name, nameW)}  ${pad(a.source, srcW)}  ${pad(a.model, modelW)}  ${a.description}`);
  return 0;
}

export interface RunFlags {
  questions: string[];
  files: string[];
  tokens: Record<string, string>;
  batch: boolean;
  verbose: boolean;
  json: boolean;
  html: boolean;
}

export function parseRunArgs(rest: string[]): RunFlags {
  const flags: RunFlags = { questions: [], files: [], tokens: {}, batch: false, verbose: false, json: false, html: false };
  let inFiles = false;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    const value = (): string => {
      const v = rest[i + 1];
      if (v === undefined) fail(`'${a}' needs a value`);
      i++;
      return v;
    };
    if (a === "-q" || a === "--question") {
      inFiles = false;
      const val = value();
      for (const q of val.split(",")) if (q.trim()) flags.questions.push(q.trim());
    } else if (a === "-f") {
      inFiles = true;
      flags.files.push(value());
    } else if (a === "-t") {
      inFiles = false;
      const kv = value();
      const eq = kv.indexOf("=");
      if (eq <= 0) fail(`-t expects name=value, got '${kv}'`);
      flags.tokens[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else if (a === "--batch") {
      inFiles = false;
      flags.batch = true;
    } else if (a === "--verbose") {
      inFiles = false;
      flags.verbose = true;
    } else if (a === "--json") {
      inFiles = false;
      flags.json = true;
    } else if (a === "--html") {
      inFiles = false;
      flags.html = true;
    } else if (a.startsWith("-")) {
      fail(`unknown argument '${a}'`);
    } else if (inFiles) {
      flags.files.push(a);
    } else {
      for (const q of a.split(",")) if (q.trim()) flags.questions.push(q.trim());
    }
  }
  for (const k of Object.keys(flags.tokens))
    if (k in BUILTIN)
      fail(`token '{{${k}}}' is built from -f and cannot be overridden with -t`);
  return flags;
}

function fail(msg: string): never {
  throw new CliError(
    `${msg}\n(usage: ask <question-name>... -f <path|glob>... [-t name=value]... [--batch] [--verbose] [--json])`,
  );
}

/** Scaffold ./.questions/<name>.md from the built-in template; refuses to overwrite without --force. */
export async function cmdNew(name: string, rest: string[], cwd: string = process.cwd()): Promise<number> {
  const force = rest.includes("--force");
  const unsupported = rest.filter((a) => a !== "--force");
  if (unsupported.length > 0) fail(`new takes only --force, got '${unsupported.join(" ")}'`);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) fail(`invalid ask name '${name}': use letters, digits, '-', '_'`);
  const dir = path.join(cwd, ".questions");
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
edit it, then run: ask ${name} -f <file>`);
  return 0;
}

async function cmdHistory(rest: string[]): Promise<number> {
  let prefix: string | undefined;
  let fileArg: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "-f") {
      fileArg = rest[++i];
      if (fileArg === undefined) fail("'-f' needs a value");
    } else if (a.startsWith("-")) {
      fail(`unknown argument '${a}'`);
    } else if (prefix === undefined) {
      prefix = a;
    } else {
      fail(`unexpected argument '${a}'`);
    }
  }
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
  if (fileArg !== undefined) return cmdHistoryDiff(process.cwd(), prefix, fileArg);
  if (prefix !== undefined) {
    const { manifest } = await findRun(process.cwd(), prefix);
    for (const p of manifest.pairs)
      console.log(`${String(p.n).padStart(3)}  ${p.file}  (${p.request} / ${p.response})`);
    return 0;
  }
  return 0;
}

/** Diff one file's answers between a run (or the latest run covering it) and the prior run for the same ask. */
async function cmdHistoryDiff(cwd: string, prefix: string | undefined, file: string): Promise<number> {
  const target = prefix ? await findRun(cwd, prefix) : undefined;
  if (target && !target.manifest.pairs.some((p) => p.file === file))
    throw new CliError(`run ${target.manifest.runId.slice(0, 8)} did not evaluate '${file}'`);
  const hit = target ?? (await findPreviousRunForFile(cwd, file));
  if (!hit) throw new CliError(`no run recorded for '${file}'`);
  const pair = hit.manifest.pairs.find((p) => p.file === file)!;
  const { response } = await readPair(hit.dir, pair);
  const prev = await getPreviousAnswersForFile(cwd, file, { ask: hit.manifest.ask, beforeRunId: hit.manifest.runId });
  console.log(`${file}  (run ${hit.manifest.runId.slice(0, 8)}${prev ? ` vs ${prev.runId.slice(0, 8)}` : ", no prior run"})`);
  console.log(formatPair(file, response, prev?.answers).split("\n").slice(1).join("\n"));
  return 0;
}

/** Delete every recorded run; destructive, so requires --force. */
export async function cmdClean(rest: string[], cwd: string = process.cwd()): Promise<number> {
  if (rest.some((a) => a !== "--force")) fail("clean takes only --force");
  const dir = historyDir(cwd);
  const runs = await listRuns(cwd);
  if (runs.length === 0) {
    console.log(`no runs recorded yet (looked in ${dir})`);
    return 0;
  }
  if (!rest.includes("--force"))
    throw new CliError(`refusing to delete ${runs.length} run${runs.length === 1 ? "" : "s"} under ${dir} — pass --force`);
  await cleanRuns(cwd);
  console.log(`deleted ${runs.length} run${runs.length === 1 ? "" : "s"} from ${dir}`);
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

/** Grouped run-results block for the terminal: summary header + aligned question table. Shared by CLI runs and dashboard-triggered runs. */
export async function printRunResult(cwd: string, result: RunResult): Promise<void> {
  const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
  const rows: RunTablePair[] = [];
  for (const p of result.pairs) {
    const prev = await getPreviousAnswersForFile(cwd, p.file, { ask: result.manifest.ask, beforeRunId: result.manifest.runId });
    rows.push({ file: p.file, response: p.response, previous: prev?.answers, directions: result.manifest.directions });
  }
  const n = result.pairs.length;
  console.log(`${result.manifest.ask} · ${result.model} · run ${result.manifest.runId.slice(0, 8)} · ${n} file${n === 1 ? "" : "s"}`);
  const table = runTable(rows, color);
  if (table) console.log(table);
}

async function cmdRun(argv: string[], cwd: string = process.cwd(), apiKey?: string): Promise<number> {
  const flags = parseRunArgs(argv);
  if (flags.questions.length === 0) fail("needs at least one question name");
  const questions = await expandAskNames(flags.questions, cwd);
  if (questions.length === 0) fail("needs at least one question name");
  const key = apiKey ?? process.env.TYPESAFE_API_KEY;
  if (!key) throw new CliError("TYPESAFE_API_KEY is not set — put it in .questions/.env or export it");
  const results: RunResult[] = [];
  for (const name of questions) {
    const result = await runAsk({
      name,
      cwd,
      argv,
      files: flags.files,
      tokens: flags.tokens,
      batch: flags.batch,
      key,
      log: flags.verbose ? (line) => console.error(line) : undefined,
    });
    results.push(result);
  }
  if (flags.json) {
    if (results.length === 1) {
      const r = results[0]!;
      console.log(
        JSON.stringify(
          { runId: r.manifest.runId, model: r.model, pairs: r.pairs.map((p) => ({ file: p.file, answers: p.response.answers })) },
          null,
          2,
        ),
      );
    } else {
      console.log(
        JSON.stringify(
          results.map((r) => ({
            runId: r.manifest.runId,
            ask: r.manifest.ask,
            model: r.model,
            pairs: r.pairs.map((p) => ({ file: p.file, answers: p.response.answers })),
          })),
          null,
          2,
        ),
      );
    }
  } else {
    for (let i = 0; i < results.length; i++) {
      if (i > 0) console.log();
      await printRunResult(cwd, results[i]!);
    }
  }
  if (flags.verbose) {
    for (const r of results) console.error(`run ${r.manifest.runId} recorded`);
  }
  if (flags.html) {
    for (const r of results) {
      const report = await writeReport(cwd, r.manifest.runId, getRunReportPath(cwd, r.manifest.runId));
      if (flags.verbose) console.error(`[report] ${report}`);
    }
  }
  return 0;
}

export async function cmdServe(rest: string[], cwd: string = process.cwd()): Promise<number> {
  let targetPath = cwd;
  let port: number | undefined = undefined;

  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "-h" || a === "--help") {
      console.log(`ask serve — serve trend matrix web dashboard over history

Usage:
  ask serve [path] [--port <n>]

Options:
  path          project directory containing .questions/history (default: current directory)
  --port <n>    port to listen on (default: 3000, auto-increments if in use)
`);
      return 0;
    }
    if (a === "--port") {
      const p = rest[++i];
      if (!p || !/^\d+$/.test(p)) throw new CliError("--port requires an integer value");
      port = Number.parseInt(p, 10);
    } else if (a.startsWith("-")) {
      throw new CliError(`unknown argument '${a}'`);
    } else {
      targetPath = path.resolve(cwd, a);
    }
  }

  const histDir = historyDir(targetPath);
  console.log(`Indexing ${histDir}...`);
  const manifests = await loadAllManifests(histDir);
  await buildTreeData(histDir, manifests);
  const fileSet = new Set<string>();
  for (const m of manifests) {
    for (const f of m.files) fileSet.add(path.normalize(f));
  }

  console.log(`Indexed ${manifests.length} runs across ${fileSet.size} files.`);

  const running = await startServer({
    cwd: targetPath,
    port,
    initialManifests: manifests,
    onRun: (result) => {
      console.log(`\n[dashboard run] ${result.manifest.ask} on ${result.manifest.files.join(", ") || "batch"}`);
      void printRunResult(targetPath, result);
    },
  });

  console.log(`Serving trend matrix dashboard:
  URL:     ${running.url}
  History: ${histDir}
Press Ctrl+C to stop.`);

  const { promise, resolve } = Promise.withResolvers<number>();
  const cleanup = async () => {
    console.log("\nStopping server...");
    await running.close();
    resolve(0);
  };

  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);

  return promise;
}

if (import.meta.main) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = e instanceof CliError ? 2 : 1;
  }
}
