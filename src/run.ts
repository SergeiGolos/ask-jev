import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertRunnable, readAsk } from "./askfile.ts";
import { askDirs, resolveAsk } from "./config.ts";
import { CliError } from "./errors.ts";
import { recordRun, type GitStamp, type PairRecord, type RunManifest } from "./history.ts";
import { judge, type JudgeResult } from "./judge.ts";
import { expandInputs, renderPrompts } from "./render.ts";

const LANG: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", mjs: "JavaScript", cjs: "JavaScript", jsx: "JavaScript",
  py: "Python", go: "Go", rs: "Rust", java: "Java", kt: "Kotlin", swift: "Swift", rb: "Ruby", php: "PHP",
  c: "C", h: "C", cpp: "C++", cc: "C++", cs: "C#", md: "Markdown", json: "JSON",
};

export const langOf = (p: string): string => LANG[p.split(".").pop()!.toLowerCase()] ?? "Unknown";

/** Best-effort git stamp of the analyzed tree: HEAD sha + origin remote; undefined outside a repo. */
export async function gitStamp(cwd: string): Promise<GitStamp | undefined> {
  const git = (args: string[]) => promisify(execFile)("git", args, { cwd }).then((r) => r.stdout.trim()).catch(() => undefined);
  const sha = await git(["rev-parse", "HEAD"]);
  if (!sha) return undefined;
  const remote = await git(["remote", "get-url", "origin"]);
  return { sha, ...(remote ? { remote } : {}) };
}

/** The state field for one judge call: the rendered prompt is the entire state (map ticket 01). */
export function judgeState(file: string, prompt: string, single: boolean): Record<string, unknown> {
  return single ? { prompt, path: file, language: langOf(file) } : { prompt };
}

export interface RunOptions {
  name: string;
  /** Positional argv as invoked, recorded verbatim in the manifest. */
  argv: string[];
  /** -f patterns; expanded against cwd. */
  files: string[];
  /** -t token overrides. */
  tokens: Record<string, string>;
  batch?: boolean;
  /** Progress sink ([tool]/[judge] lines); silent when omitted. */
  log?: (line: string) => void;
  /** TypeSafe API key. */
  key: string;
  /** Judge transport seam. */
  fetchImpl?: typeof fetch;
  cwd?: string;
}

export interface RunResult {
  manifest: RunManifest;
  model: string;
  /** One pair per judged input, in run order; pairs[i] corresponds to files[i] unless batch. */
  pairs: { file: string; request: string; response: JudgeResult; notes: PairRecord["notes"] }[];
}

/**
 * One ask run: resolve the ask, render one prompt per file (or a single batch prompt),
 * judge each, and record the run directory. Run policy — batch naming, state mode,
 * latency, notes — lives here; the CLI only translates argv and prints.
 */
export async function runAsk(o: RunOptions): Promise<RunResult> {
  const cwd = o.cwd ?? process.cwd();
  const found = await resolveAsk(o.name, cwd);
  if (!found) {
    const { folder, profile } = askDirs(cwd);
    throw new Error(`no ask '${o.name}' in ${folder} or ${profile}`);
  }
  const ask = await readAsk(found.file);
  assertRunnable(ask, o.name);
  const files = await expandInputs(o.files, cwd);
  const batch = o.batch ?? false;
  const rendered = await renderPrompts({
    ask,
    files,
    tokens: o.tokens,
    batch,
    cwd,
    onToolStart: o.log ? (cmd) => o.log!(`[tool] $ ${cmd}`) : undefined,
  });
  const model = ask.meta.model ?? "jev-latest";
  const directions = Object.fromEntries(
    Object.entries(ask.schema ?? {})
      .filter(([, q]) => q.direction === "low")
      .map(([id]) => [id, "low" as const]),
  );

  const pairs: RunResult["pairs"] = [];
  for (let i = 0; i < rendered.length; i++) {
    const r = rendered[i]!;
    const file = batch || files.length === 0 ? "batch" : files[i]!;
    const t0 = Date.now();
    const res = await judge({
      key: o.key,
      model,
      questions: ask.schema,
      state: judgeState(file, r.prompt, !batch && files.length > 0),
      fetchImpl: o.fetchImpl,
    });
    const latencyMs = Date.now() - t0;
    o.log?.(`[judge] ${file} ${res.model} ${latencyMs} ms`);
    pairs.push({
      file,
      request: r.prompt,
      response: res,
      notes: { tools: r.tools.map((command) => ({ command })), judge: { model: res.model, usage: res.usage, latencyMs } },
    });
  }

  const manifest = await recordRun(cwd, {
    ask: o.name,
    askSource: found.source,
    model,
    files,
    argv: o.argv,
    pairs,
    schema: ask.schema,
    directions: Object.keys(directions).length > 0 ? directions : undefined,
    git: await gitStamp(cwd),
  });
  return { manifest, model, pairs };
}
