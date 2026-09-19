import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { isRecord } from "./guards.ts";
import type { RunManifest, PairRecord } from "./history.ts";

export interface TreeNode {
  name: string;
  path: string;
  type: "file" | "directory";
  runCount: number;
  children?: TreeNode[];
  asks?: string[];
}

export interface TreeData {
  root: TreeNode;
  availableAsks: string[];
  availableQuestions: string[];
  timeRange: { min: string; max: string };
}

export interface ParsedAnswer {
  q: string;
  numeric: number | null;
  display: string;
  tone: "ok" | "warn" | "bad" | "mut";
}

export interface MatrixCell {
  runId: string;
  timestamp: string;
  value: number | null;
  display: string;
  tone: "ok" | "warn" | "bad" | "mut";
  delta: number | null;
  changed: boolean;
  prevDisplay?: string;
  fileCount?: number;
  min?: number;
  max?: number;
}

export interface MatrixQuestionRow {
  id: string;
  ask: string;
  cells: Record<string, MatrixCell>;
}

export interface MatrixRunCol {
  runId: string;
  timestamp: string;
  ask: string;
  model: string;
}

export interface MatrixResponse {
  path: string;
  isFolder: boolean;
  runs: MatrixRunCol[];
  questions: MatrixQuestionRow[];
}

export interface MatrixQuery {
  path?: string;
  ask?: string;
  from?: string;
  to?: string;
  grep?: string;
  questions?: string[];
}

export function parseAnswer(q: string, a: unknown): ParsedAnswer {
  const ans: ParsedAnswer = { q, numeric: null, display: "—", tone: "mut" };
  if (!isRecord(a)) return ans;

  let v: number | null = null;
  if (typeof a.score === "number") v = a.score;
  else if (typeof a.choice === "string" || typeof a.choice === "number") {
    const n = Number(a.choice);
    if (!Number.isNaN(n)) v = n;
  }

  if (v !== null) {
    ans.numeric = v;
    ans.display = Number.isInteger(v) ? String(v) : v.toFixed(1);
    ans.tone = v >= 7 ? "ok" : v >= 4 ? "warn" : "bad";
    return ans;
  }

  if (typeof a.noul === "number" || typeof a.noul === "boolean") {
    const p = typeof a.noul === "boolean" ? (a.noul ? 1 : 0) : a.noul;
    const isBad = p >= 0.5;
    ans.numeric = p;
    ans.display = isBad ? `rework ${Math.round(p * 100)}%` : `pass ${Math.round((1 - p) * 100)}%`;
    ans.tone = isBad ? "bad" : "ok";
    return ans;
  }

  if (a.choice !== undefined) {
    ans.display = String(a.choice);
    ans.tone = "mut";
  }

  return ans;
}

export async function loadAllManifests(historyDir: string): Promise<RunManifest[]> {
  const entries = await readdir(historyDir, { withFileTypes: true }).catch(() => []);
  const manifests: RunManifest[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    try {
      const raw = await readFile(path.join(historyDir, ent.name, "run.json"), "utf8");
      manifests.push(JSON.parse(raw));
    } catch {
      // skip partial or corrupted run
    }
  }
  return manifests.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export async function buildTreeData(historyDir: string, manifests: RunManifest[]): Promise<TreeData> {
  const askSet = new Set<string>();
  const questionSet = new Set<string>();
  const fileRunCounts = new Map<string, { count: number; asks: Set<string> }>();
  let minTime = "";
  let maxTime = "";

  for (const m of manifests) {
    askSet.add(m.ask);
    if (!minTime || m.timestamp < minTime) minTime = m.timestamp;
    if (!maxTime || m.timestamp > maxTime) maxTime = m.timestamp;

    for (const f of m.files) {
      const norm = path.normalize(f);
      let item = fileRunCounts.get(norm);
      if (!item) {
        item = { count: 0, asks: new Set() };
        fileRunCounts.set(norm, item);
      }
      item.count++;
      item.asks.add(m.ask);
    }

    if (m.pairs.length > 0) {
      try {
        const respPath = path.join(historyDir, m.runId, m.pairs[0]!.response);
        const raw = await readFile(respPath, "utf8");
        const resp = JSON.parse(raw);
        if (isRecord(resp) && isRecord(resp.answers)) {
          for (const qid of Object.keys(resp.answers)) {
            questionSet.add(qid);
          }
        }
      } catch {
        // ignore missing response file
      }
    }
  }

  interface InternalDir {
    name: string;
    path: string;
    files: Map<string, { path: string; count: number; asks: string[] }>;
    dirs: Map<string, InternalDir>;
  }

  const rootDir: InternalDir = { name: "root", path: "", files: new Map(), dirs: new Map() };

  for (const [filePath, info] of fileRunCounts.entries()) {
    const parts = filePath.split(path.sep);
    let cur = rootDir;
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i]!;
      let next = cur.dirs.get(seg);
      if (!next) {
        const nextPath = cur.path ? `${cur.path}/${seg}` : seg;
        next = { name: seg, path: nextPath, files: new Map(), dirs: new Map() };
        cur.dirs.set(seg, next);
      }
      cur = next;
    }
    const fileName = parts[parts.length - 1]!;
    cur.files.set(fileName, { path: filePath, count: info.count, asks: Array.from(info.asks) });
  }

  function convert(dir: InternalDir): TreeNode {
    const children: TreeNode[] = [];
    let totalRuns = 0;

    for (const d of Array.from(dir.dirs.values()).sort((a, b) => a.name.localeCompare(b.name))) {
      const childNode = convert(d);
      totalRuns += childNode.runCount;
      children.push(childNode);
    }

    for (const f of Array.from(dir.files.values()).sort((a, b) => a.path.localeCompare(b.path))) {
      totalRuns += f.count;
      children.push({
        name: path.basename(f.path),
        path: f.path,
        type: "file",
        runCount: f.count,
        asks: f.asks,
      });
    }

    return {
      name: dir.name,
      path: dir.path,
      type: "directory",
      runCount: totalRuns,
      children,
    };
  }

  return {
    root: convert(rootDir),
    availableAsks: Array.from(askSet).sort(),
    availableQuestions: Array.from(questionSet).sort(),
    timeRange: { min: minTime, max: maxTime },
  };
}

export async function buildMatrixData(
  historyDir: string,
  manifests: RunManifest[],
  query: MatrixQuery
): Promise<MatrixResponse> {
  const targetPath = query.path ? path.normalize(query.path) : "";
  let grepRegex: RegExp | null = null;
  if (query.grep) {
    try {
      grepRegex = new RegExp(query.grep, "i");
    } catch {
      // fallback to literal substring
    }
  }

  const filteredRuns = manifests.filter((m) => {
    if (query.ask && m.ask !== query.ask) return false;
    if (query.from && m.timestamp < query.from) return false;
    if (query.to && m.timestamp > query.to) return false;
    return true;
  });

  const isFile = filteredRuns.some((m) => m.files.some((f) => path.normalize(f) === targetPath));
  const isFolder = !isFile;

  const matchFile = (filePath: string): boolean => {
    const norm = path.normalize(filePath);
    if (!targetPath) return true;
    if (isFolder) {
      return norm === targetPath || norm.startsWith(`${targetPath}${path.sep}`) || norm.startsWith(`${targetPath}/`);
    }
    return norm === targetPath;
  };

  const matchingRuns: MatrixRunCol[] = [];
  const questionRowsMap = new Map<string, { ask: string; cells: Record<string, MatrixCell> }>();

  for (const m of filteredRuns) {
    const matchingPairs: PairRecord[] = [];
    for (const p of m.pairs) {
      if (matchFile(p.file)) {
        matchingPairs.push(p);
      }
    }
    if (matchingPairs.length === 0) continue;

    matchingRuns.push({
      runId: m.runId,
      timestamp: m.timestamp,
      ask: m.ask,
      model: m.model,
    });

    const qAnswersMap = new Map<string, ParsedAnswer[]>();

    for (const p of matchingPairs) {
      const respPath = path.join(historyDir, m.runId, p.response);
      let respObj: unknown;
      try {
        respObj = JSON.parse(await readFile(respPath, "utf8"));
      } catch {
        continue;
      }
      if (!isRecord(respObj) || !isRecord(respObj.answers)) continue;

      for (const [qid, ansRaw] of Object.entries(respObj.answers)) {
        const parsed = parseAnswer(qid, ansRaw);
        let list = qAnswersMap.get(qid);
        if (!list) {
          list = [];
          qAnswersMap.set(qid, list);
        }
        list.push(parsed);
      }
    }

    for (const [qid, answers] of qAnswersMap.entries()) {
      let row = questionRowsMap.get(qid);
      if (!row) {
        row = { ask: m.ask, cells: {} };
        questionRowsMap.set(qid, row);
      }

      if (answers.length === 1) {
        const a = answers[0]!;
        row.cells[m.runId] = {
          runId: m.runId,
          timestamp: m.timestamp,
          value: a.numeric,
          display: a.display,
          tone: a.tone,
          delta: null,
          changed: false,
        };
      } else {
        const numerics = answers.map((a) => a.numeric).filter((n): n is number => n !== null);
        if (numerics.length > 0) {
          const avg = numerics.reduce((sum, v) => sum + v, 0) / numerics.length;
          const min = Math.min(...numerics);
          const max = Math.max(...numerics);
          const display = Number.isInteger(avg) ? String(avg) : avg.toFixed(1);
          const tone = avg >= 7 ? "ok" : avg >= 4 ? "warn" : "bad";
          row.cells[m.runId] = {
            runId: m.runId,
            timestamp: m.timestamp,
            value: avg,
            display: `${display} (n=${numerics.length})`,
            tone,
            delta: null,
            changed: false,
            fileCount: numerics.length,
            min,
            max,
          };
        } else {
          row.cells[m.runId] = {
            runId: m.runId,
            timestamp: m.timestamp,
            value: null,
            display: `${answers[0]?.display || "—"} (n=${answers.length})`,
            tone: "mut",
            delta: null,
            changed: false,
            fileCount: answers.length,
          };
        }
      }
    }
  }

  const questionsResult: MatrixQuestionRow[] = [];

  for (const [qid, row] of questionRowsMap.entries()) {
    if (query.questions && query.questions.length > 0 && !query.questions.includes(qid)) {
      continue;
    }
    if (grepRegex) {
      const matchesQid = grepRegex.test(qid);
      const matchesCell = Object.values(row.cells).some((c) => grepRegex!.test(c.display));
      if (!matchesQid && !matchesCell) continue;
    } else if (query.grep) {
      const qLower = query.grep.toLowerCase();
      const matchesQid = qid.toLowerCase().includes(qLower);
      const matchesCell = Object.values(row.cells).some((c) => c.display.toLowerCase().includes(qLower));
      if (!matchesQid && !matchesCell) continue;
    }

    let prevCell: MatrixCell | null = null;
    for (const r of matchingRuns) {
      const cell = row.cells[r.runId];
      if (!cell) continue;

      if (prevCell !== null) {
        if (cell.value !== null && prevCell.value !== null) {
          const diff = Number((cell.value - prevCell.value).toFixed(2));
          cell.delta = diff;
          cell.changed = diff !== 0;
        } else {
          cell.changed = cell.display !== prevCell.display;
        }
        cell.prevDisplay = prevCell.display;
      }
      prevCell = cell;
    }

    questionsResult.push({
      id: qid,
      ask: row.ask,
      cells: row.cells,
    });
  }

  questionsResult.sort((a, b) => a.id.localeCompare(b.id));

  return {
    path: targetPath,
    isFolder,
    runs: matchingRuns,
    questions: questionsResult,
  };
}
