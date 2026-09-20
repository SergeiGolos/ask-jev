import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { isRecord } from "./guards.ts";
import type { Questions } from "./answers.ts";
import { uuidv7 } from "./uuid7.ts";

export interface JudgeNote {
  model?: string;
  usage?: unknown;
  latencyMs?: number;
}

export interface PairRecord {
  n: number;
  file: string;
  /** File names inside the run directory. */
  request: string;
  response: string;
  /** Console records for the report's verbose level. */
  notes?: { tools?: { command: string }[]; judge?: JudgeNote };
}

export interface RunManifest {
  runId: string;
  timestamp: string;
  ask: string;
  askSource: string;
  model: string;
  files: string[];
  argv: string[];
  pairs: PairRecord[];
  /** Git commit the analyzed code was at when the run executed; absent outside a repo. */
  git?: GitStamp;
}

export interface GitStamp {
  /** Full HEAD sha. */
  sha: string;
  /** `origin` remote URL, when defined. */
  remote?: string;
}

export interface PairInput {
  file: string;
  /** Rendered prompt for this pair. */
  request: string;
  response: unknown;
  notes?: PairRecord["notes"];
}

export interface RunInput {
  ask: string;
  askSource: string;
  model: string;
  files: string[];
  argv: string[];
  pairs: PairInput[];
  schema: Questions | null;
  git?: GitStamp;
  /** Test seams. */
  now?: number;
  runId?: string;
}

// ponytail: default history directory; upgrade path is configurable history storage
export const historyDir = (cwd: string): string => path.join(cwd, ".questions", "history");

/** Path to report.html for a given run ID. */
export const getRunReportPath = (cwd: string, runId: string): string =>
  path.join(historyDir(cwd), runId, "report.html");

function slug(file: string): string {
  const s = file.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "file";
}

/** Request markdown with the ask's schema appended for reference. */
function withSchema(request: string, schema: Questions | null): string {
  if (!schema || Object.keys(schema).length === 0) return request;
  return `${request.replace(/\n$/, "")}\n\n---\n\n<!-- ask schema (reference only) -->\n\`\`\`schema\n${stringifyYaml(schema)}\`\`\`\n`;
}

/** Write one run directory: run.json + one request/response pair per judged file. */
export async function recordRun(cwd: string, input: RunInput): Promise<RunManifest> {
  const runId = input.runId ?? uuidv7(input.now);
  const timestamp = new Date(input.now ?? Date.now()).toISOString();
  const dir = path.join(historyDir(cwd), runId);
  await mkdir(dir, { recursive: true });
  const pairs: PairRecord[] = [];
  for (let i = 0; i < input.pairs.length; i++) {
    const p = input.pairs[i]!;
    const base = `${String(i + 1).padStart(3, "0")}-${slug(p.file)}`;
    await writeFile(path.join(dir, `${base}.request.md`), withSchema(p.request, input.schema));
    await writeFile(path.join(dir, `${base}.response.json`), JSON.stringify(p.response, null, 2) + "\n");
    pairs.push({ n: i + 1, file: p.file, request: `${base}.request.md`, response: `${base}.response.json`, notes: p.notes });
  }
  const manifest: RunManifest = {
    runId,
    timestamp,
    ask: input.ask,
    askSource: input.askSource,
    model: input.model,
    files: input.files,
    argv: input.argv,
    pairs,
    git: input.git,
  };
  await writeFile(path.join(dir, "run.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

async function readManifest(dir: string): Promise<RunManifest | undefined> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path.join(dir, "run.json"), "utf8"));
  } catch (err: unknown) {
    const exists = await stat(path.join(dir, "run.json")).then(() => true).catch(() => false);
    if (exists) console.error(`[history] corrupt run.json in ${dir}: ${(err as Error).message}`);
    return undefined;
  }
  if (!isRecord(raw) || typeof raw.runId !== "string" || !Array.isArray(raw.pairs)) {
    return undefined;
  }
  return raw as unknown as RunManifest;
}

/** All manifests in chronological order. Accepts either project cwd or history directory. */
export async function loadAllManifests(dirOrCwd: string): Promise<RunManifest[]> {
  const root = dirOrCwd.endsWith("history") ? dirOrCwd : historyDir(dirOrCwd);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const manifests: RunManifest[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const m = await readManifest(path.join(root, ent.name));
    if (m) manifests.push(m);
  }
  return manifests.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export interface RunSummary {
  runId: string;
  timestamp: string;
  ask: string;
  model: string;
  pairCount: number;
  dir: string;
}

/** All recorded runs, chronological (UUIDv7 lexical order). */
export async function listRuns(cwd: string): Promise<RunSummary[]> {
  const root = historyDir(cwd);
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return [];
  }
  const runs: RunSummary[] = [];
  for (const e of entries) {
    const dir = path.join(root, e);
    const m = await readManifest(dir);
    if (m) runs.push({ runId: m.runId, timestamp: m.timestamp, ask: m.ask, model: m.model, pairCount: m.pairs.length, dir });
  }
  return runs.sort((a, b) => (a.runId < b.runId ? -1 : 1));
}

/** Delete every recorded run by removing the history directory (recreated on the next run). Returns the run count removed. */
export async function cleanRuns(cwd: string): Promise<number> {
  const runs = await listRuns(cwd);
  await rm(historyDir(cwd), { recursive: true, force: true });
  return runs.length;
}

/** The newest recorded run; errors when nothing is recorded yet. */
export async function latestRun(cwd: string): Promise<{ manifest: RunManifest; dir: string }> {
  const runs = await listRuns(cwd);
  const latest = runs[runs.length - 1];
  if (!latest) throw new Error("no runs recorded yet — run an ask first");
  return { manifest: (await readManifest(latest.dir))!, dir: latest.dir };
}

export async function findRun(cwd: string, prefix: string): Promise<{ manifest: RunManifest; dir: string }> {
  const root = historyDir(cwd);
  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    // no history yet
  }
  const matches = entries.filter((e) => e.startsWith(prefix)).sort();
  if (matches.length === 0) throw new Error(`no run matching '${prefix}' in ${root}`);
  if (matches.length > 1) throw new Error(`ambiguous run prefix '${prefix}': ${matches.map((m) => m.slice(0, 8)).join(", ")}`);
  const dir = path.join(root, matches[0]!);
  const manifest = await readManifest(dir);
  if (!manifest) throw new Error(`run directory ${dir} has no readable run.json`);
  return { manifest, dir };
}

export async function readPair(dir: string, pair: PairRecord): Promise<{ request: string; response: unknown }> {
  return {
    request: await readFile(path.join(dir, pair.request), "utf8"),
    response: JSON.parse(await readFile(path.join(dir, pair.response), "utf8")),
  };
}

/**
 * Find the latest run (before `beforeRunId` if specified, or latest)
 * for a given ask name (or any ask if not specified) that evaluated `file`.
 */
export async function findPreviousRunForFile(
  cwd: string,
  file: string,
  options: { ask?: string; beforeRunId?: string } = {},
): Promise<{ manifest: RunManifest; pair: PairRecord; dir: string } | undefined> {
  const manifests = await loadAllManifests(cwd);
  const targetPath = path.normalize(file);
  const sorted = [...manifests].sort((a, b) => b.runId.localeCompare(a.runId));

  for (const m of sorted) {
    if (options.ask && m.ask !== options.ask) continue;
    if (options.beforeRunId && m.runId >= options.beforeRunId) continue;

    const pair = m.pairs.find((p) => path.normalize(p.file) === targetPath || p.file === file);
    if (pair) {
      const dir = path.join(historyDir(cwd), m.runId);
      return { manifest: m, pair, dir };
    }
  }
  return undefined;
}

/**
 * Read previous answers for a given file, before a specific run ID (or latest).
 */
export async function getPreviousAnswersForFile(
  cwd: string,
  file: string,
  options: { ask?: string; beforeRunId?: string } = {},
): Promise<{ runId: string; timestamp: string; answers: Record<string, unknown> } | undefined> {
  const hit = await findPreviousRunForFile(cwd, file, options);
  if (!hit) return undefined;
  try {
    const resp = await readPairResponse(hit.dir, hit.pair.response);
    if (isRecord(resp) && isRecord(resp.answers)) {
      return { runId: hit.manifest.runId, timestamp: hit.manifest.timestamp, answers: resp.answers };
    }
  } catch {
    // unreadable response
  }
  return undefined;
}

/** Read and parse a pair response JSON file from a run directory. */
export async function readPairResponse(dir: string, responseFile: string): Promise<unknown> {
  return JSON.parse(await readFile(path.join(dir, responseFile), "utf8"));
}
