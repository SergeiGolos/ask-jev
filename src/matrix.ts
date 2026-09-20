import path from "node:path";
import { isRecord } from "./guards.ts";
import { loadAllManifests, readPairResponse, type RunManifest, type PairRecord } from "./history.ts";
import { parseAnswer, toneOf, type Direction, type ParsedAnswer, type Tone } from "./answers.ts";
export { loadAllManifests, parseAnswer, type ParsedAnswer, type Tone };

const URL_RE = /^https?:\/\//;

// ponytail: GitHub-only compare/commit links; extend for other forges when a run records such a remote
export function githubRepoUrl(remote?: string): string | undefined {
  if (!remote) return undefined;
  const m = remote.match(/github\.com[:/](.+?)(?:\.git)?\/?$/);
  return m ? `https://github.com/${m[1]}` : undefined;
}

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
  /** Git stamp of the analyzed tree, when the run recorded one. */
  sha?: string;
  /** GitHub repo base URL derived from the origin remote; undefined for non-GitHub remotes. */
  repo?: string;
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



export async function buildTreeData(historyDir: string, manifests: RunManifest[]): Promise<TreeData> {
  if (typeof historyDir !== "string" || !historyDir)
    throw new TypeError("buildTreeData: historyDir must be a non-empty string");
  if (!Array.isArray(manifests))
    throw new TypeError("buildTreeData: manifests must be an array");
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
      // URLs keep their verbatim form as the stacking identity; only real paths get path normalization.
      const norm = URL_RE.test(f) ? f : path.normalize(f);
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
        const resp = await readPairResponse(path.join(historyDir, m.runId), m.pairs[0]!.response);
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
    if (URL_RE.test(filePath)) {
      // URL inputs render as leaves grouped under a virtual per-host directory (path = scheme://host).
      const schemeEnd = filePath.indexOf("://") + 3;
      const rest = filePath.slice(schemeEnd);
      const slash = rest.indexOf("/");
      const hostPath = filePath.slice(0, slash === -1 ? filePath.length : schemeEnd + slash);
      let hostDir = rootDir.dirs.get(hostPath);
      if (!hostDir) {
        hostDir = { name: rest.slice(0, slash === -1 ? rest.length : slash), path: hostPath, files: new Map(), dirs: new Map() };
        rootDir.dirs.set(hostPath, hostDir);
      }
      hostDir.files.set(filePath, { path: filePath, count: info.count, asks: Array.from(info.asks) });
      continue;
    }
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
        name: path.basename(f.path) || f.path,
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
  if (typeof historyDir !== "string" || !historyDir)
    throw new TypeError("buildMatrixData: historyDir must be a non-empty string");
  if (!Array.isArray(manifests))
    throw new TypeError("buildMatrixData: manifests must be an array");
  if (!query || typeof query !== "object")
    throw new TypeError("buildMatrixData: query object is required");
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

  // Per-question direction (lower-is-better), newest manifest that records it wins.
  const directions: Record<string, Direction> = {};
  for (const m of manifests) Object.assign(directions, m.directions ?? {});

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
      sha: m.git?.sha,
      repo: githubRepoUrl(m.git?.remote),
    });

    const qAnswersMap = new Map<string, ParsedAnswer[]>();

    for (const p of matchingPairs) {
      let respObj: unknown;
      try {
        respObj = await readPairResponse(path.join(historyDir, m.runId), p.response);
      } catch {
        continue;
      }
      if (!isRecord(respObj) || !isRecord(respObj.answers)) continue;

      for (const [qid, ansRaw] of Object.entries(respObj.answers)) {
        const parsed = parseAnswer(qid, ansRaw, directions[qid]);
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
          const tone = toneOf(avg, directions[qid]);
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

  // Columns render newest-first; deltas above were computed oldest→newest and stay attached to their cells.
  matchingRuns.reverse();

  return {
    path: targetPath,
    isFolder,
    runs: matchingRuns,
    questions: questionsResult,
  };
}
