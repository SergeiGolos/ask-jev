import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertRunnable, readAsk } from "./askfile.ts";
import { resolveAsk } from "./config.ts";
import { askDirs } from "./askstore.ts";
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
  /** Ask names to execute, in invocation order; ONE run records every ask × every file. */
  names: string[];
  /** Positional argv as invoked, recorded verbatim in the manifest. */
  argv: string[];
  /** -f patterns; expanded against cwd. */
  files: string[];
  /** -t token overrides. */
  tokens: Record<string, string>;
  batch?: boolean;
  /** Progress sink ([tool]/[judge] lines); silent when omitted. */
  log?: (line: string) => void;
  /** Invoked with each judged pair as soon as it completes, in run order; drives streaming output. */
  onPair?: (pair: RunResult["pairs"][number]) => void | Promise<void>;
  /** TypeSafe API key. */
  key: string;
  /** Judge transport seam. */
  fetchImpl?: typeof fetch;
  cwd?: string;
}

export interface RunResult {
  manifest: RunManifest;
  /** One pair per judged input across all asks, in run order. */
  pairs: { ask: string; file: string; request: string; response: JudgeResult; notes: PairRecord["notes"] }[];
}

/**
 * One ask run over every named ask: validate all asks up front (no judge calls are spent on
 * an unknown name), render one prompt per file per ask (or a single batch prompt per ask),
 * judge each, and record ONE run directory. When the run covers several asks, question ids
 * are prefixed `<ask>/` so identical schema ids across asks cannot collide.
 */
export async function runAsk(o: RunOptions): Promise<RunResult> {
  const cwd = o.cwd ?? process.cwd();
  const files = await expandInputs(o.files, cwd);
  const batch = o.batch ?? false;
  const pfx = o.names.length > 1 ? (name: string) => `${name}/` : () => "";

  const prepared = [];
  for (const name of o.names) {
    const found = await resolveAsk(name, cwd);
    if (!found) {
      const { folder, profile } = askDirs(cwd);
      throw new Error(`no ask '${name}' in ${folder} or ${profile}`);
    }
    const ask = await readAsk(found.file);
    assertRunnable(ask, name);
    // assertRunnable guarantees a non-empty schema
    const schema = Object.fromEntries(Object.entries(ask.schema).map(([id, q]) => [pfx(name) + id, q]));
    const directions = Object.fromEntries(
      Object.entries(schema).filter(([, q]) => q.direction === "low").map(([id]) => [id, "low" as const]),
    );
    prepared.push({ name, found, ask, schema, directions, model: ask.meta.model ?? "jev-latest" });
  }

  const pairs: RunResult["pairs"] = [];
  for (const p of prepared) {
    const rendered = await renderPrompts({
      ask: p.ask,
      files,
      tokens: o.tokens,
      batch,
      cwd,
      onToolStart: o.log ? (cmd) => o.log!(`[tool] $ ${cmd}`) : undefined,
    });
    for (let i = 0; i < rendered.length; i++) {
      const r = rendered[i]!;
      const file = batch || files.length === 0 ? "batch" : files[i]!;
      const t0 = Date.now();
      const res = await judge({
        key: o.key,
        model: p.model,
        questions: p.schema,
        state: judgeState(file, r.prompt, !batch && files.length > 0),
        fetchImpl: o.fetchImpl,
      });
      const latencyMs = Date.now() - t0;
      o.log?.(`[judge] ${p.name}/${file} ${res.model} ${latencyMs} ms`);
      const pair: RunResult["pairs"][number] = {
        ask: p.name,
        file,
        request: r.prompt,
        response: res,
        notes: { tools: r.tools.map((command) => ({ command })), judge: { model: res.model, usage: res.usage, latencyMs } },
      };
      pairs.push(pair);
      await o.onPair?.(pair);
    }
  }

  const manifest = await recordRun(cwd, {
    asks: prepared.map((p) => ({
      ask: p.name,
      askSource: p.found.source,
      model: p.model,
      schema: p.schema,
      directions: Object.keys(p.directions).length > 0 ? p.directions : undefined,
    })),
    files,
    argv: o.argv,
    pairs,
    git: await gitStamp(cwd),
  });
  return { manifest, pairs };
}
