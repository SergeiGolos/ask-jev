#!/usr/bin/env node
import path from "node:path";
import { formatPair, runTable, type RunTablePair } from "./answers.ts";
import { expandAskNames, resolveConfig } from "./config.ts";
import { askDirs, AskExistsError, openAskStore } from "./askstore.ts";
import { CliError } from "./errors.ts";
import { cleanRuns, findPreviousRunForFile, findRun, getPreviousAnswersForFile, getRunReportPath, historyDir, listRuns, loadAllManifests, readPair, type RunManifest } from "./history.ts";
import { buildTreeData } from "./matrix.ts";
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
  ask <question-name>... -f <path|glob>...         run asks; ONE run records every question × every file
        [-t name=value]... [--batch] [--verbose] [--json] [--html]
  ask history [run-id]                             list runs, or one run's pairs
  ask history [run-id] -f <file>                   diff a file's answers vs the prior run
  ask clean [--force]                              delete all recorded runs (.questions/history)
  ask show <run-id> [pair]                         print a pair's request md + response json
  ask report [run-id] [-o file]                    write the HTML report (default: latest run)
  ask serve [path] [--port 3000] [--watch]         serve trend matrix web dashboard over history
                                                 (--watch runs grep-triggered questions on file changes)
`);
  return code;
}

async function cmdList(): Promise<number> {
  const asks = await openAskStore().list();
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
  const file = path.join(cwd, ".questions", `${name}.md`);
  try {
    await openAskStore(cwd).create(name, { content: newAskTemplate(name), overwrite: force });
  } catch (err) {
    if (err instanceof AskExistsError) fail(`ask already exists: ${file} (use --force to overwrite)`);
    throw err;
  }
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
    const askW = width((r) => r.asks.join(", "), "ASK");
    const pad = (s: string, w: number) => s + " ".repeat(w - s.length);
    console.log(`${pad("RUN", idW)}  ${pad("WHEN", whenW)}  ${pad("ASK", askW)}  PAIRS`);
    for (const r of runs)
      console.log(
        `${pad(r.runId.slice(0, 8), idW)}  ${pad(r.timestamp.replace("T", " ").slice(0, 19), whenW)}  ${pad(r.asks.join(", "), askW)}  ${r.pairCount}`,
      );
    return 0;
  }
  if (fileArg !== undefined) return cmdHistoryDiff(process.cwd(), prefix, fileArg);
  if (prefix !== undefined) {
    const { manifest } = await findRun(process.cwd(), prefix);
    for (const p of manifest.pairs)
      console.log(`${String(p.n).padStart(3)}  ${p.ask}: ${p.file}  (${p.request} / ${p.response})`);
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
  const prev = await getPreviousAnswersForFile(cwd, file, { ask: pair.ask, beforeRunId: hit.manifest.runId });
  console.log(`${pair.ask}: ${file}  (run ${hit.manifest.runId.slice(0, 8)}${prev ? ` vs ${prev.runId.slice(0, 8)}` : ", no prior run"})`);
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
    console.log(`=== pair ${p.n}: ${p.ask}: ${p.file} (${p.request}) ===`);
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

/** One-line run summary: asks · models · run id · pair count. */
function runSummaryLine(result: RunResult): string {
  const n = result.pairs.length;
  const models = [...new Set(result.manifest.asks.map((a) => a.model))].join("/");
  return `${result.manifest.asks.map((a) => a.ask).join(" + ")} · ${models} · run ${result.manifest.runId.slice(0, 8)} · ${n} pair${n === 1 ? "" : "s"}`;
}

/** Grouped run-results block for the terminal: summary header + aligned question table. Shared by CLI runs and dashboard-triggered runs. */
export async function printRunResult(cwd: string, result: RunResult): Promise<void> {
  const color = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
  const directions: Record<string, "low"> = {};
  for (const a of result.manifest.asks) Object.assign(directions, a.directions ?? {});
  const rows: RunTablePair[] = [];
  for (const p of result.pairs) {
    const prev = await getPreviousAnswersForFile(cwd, p.file, { ask: p.ask, beforeRunId: result.manifest.runId });
    rows.push({ file: p.file, response: p.response, previous: prev?.answers, directions });
  }
  console.log(runSummaryLine(result));
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
  const multiAsk = questions.length > 1;
  const result = await runAsk({
    names: questions,
    cwd,
    argv,
    files: flags.files,
    tokens: flags.tokens,
    batch: flags.batch,
    key,
    log: flags.verbose ? (line) => console.error(line) : undefined,
    // Stream each file's answers to the console as soon as its judge call completes;
    // the current run is not recorded yet, so "no beforeRunId" already means "prior runs".
    onPair: flags.json
      ? undefined
      : async (p) => {
          const prev = await getPreviousAnswersForFile(cwd, p.file, { ask: p.ask });
          console.log(formatPair(multiAsk ? `${p.ask}: ${p.file}` : p.file, p.response, prev?.answers));
        },
  });
  if (flags.json) {
    console.log(
      JSON.stringify(
        {
          runId: result.manifest.runId,
          asks: result.manifest.asks.map((a) => ({ ask: a.ask, model: a.model })),
          pairs: result.pairs.map((p) => ({ ask: p.ask, file: p.file, answers: p.response.answers })),
        },
        null,
        2,
      ),
    );
  } else {
    console.log(runSummaryLine(result));
  }
  if (flags.verbose) console.error(`run ${result.manifest.runId} recorded`);
  if (flags.html) {
    const report = await writeReport(cwd, result.manifest.runId, getRunReportPath(cwd, result.manifest.runId));
    if (flags.verbose) console.error(`[report] ${report}`);
  }
  return 0;
}

export async function cmdServe(rest: string[], cwd: string = process.cwd()): Promise<number> {
  let targetPath = cwd;
  let port: number | undefined = undefined;
  let watch = false;

  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === "-h" || a === "--help") {
      console.log(`ask serve — serve trend matrix web dashboard over history

Usage:
  ask serve [path] [--port <n>] [--watch]

Options:
  path          project directory containing .questions/history (default: current directory)
  --port <n>    port to listen on (default: 3000, auto-increments if in use)
  --watch       watch the project for file changes; a change matching a question's
                front-matter 'grep' pattern runs every matching question on that file
                (one run id per file)
`);
      return 0;
    }
    if (a === "--port") {
      const p = rest[++i];
      if (!p || !/^\d+$/.test(p)) throw new CliError("--port requires an integer value");
      port = Number.parseInt(p, 10);
    } else if (a === "--watch") {
      watch = true;
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
    watch,
    log: watch ? (line) => console.log(line) : undefined,
    onRun: (result) => {
      console.log(`\n[run] ${result.manifest.asks.map((a) => a.ask).join(", ")} on ${result.manifest.files.join(", ") || "batch"}`);
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
