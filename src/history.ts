import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { stringify as stringifyYaml } from "yaml";
import { isRecord } from "./guards.ts";
import type { Questions } from "./askfile.ts";
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
  /** Test seams. */
  now?: number;
  runId?: string;
}

export const historyDir = (cwd: string): string => path.join(cwd, ".ask", "history");

function slug(file: string): string {
  const s = file.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return s || "file";
}

/** Request markdown with the ask's schema appended for reference. */
function withSchema(request: string, schema: Questions | null): string {
  if (!schema || Object.keys(schema).length === 0) return request;
  return `${request.replace(/\n$/, "")}\n\n---\n\n<!-- ask schema (reference only) -->\n\`\`\`yaml\n${stringifyYaml(schema)}\`\`\`\n`;
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
  };
  await writeFile(path.join(dir, "run.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

async function readManifest(dir: string): Promise<RunManifest | undefined> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path.join(dir, "run.json"), "utf8"));
  } catch {
    return undefined;
  }
  if (!isRecord(raw)) return undefined;
  return raw as unknown as RunManifest; // shape guaranteed by recordRun; manifest is our own artifact
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
