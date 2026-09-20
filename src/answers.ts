import { isRecord } from "./guards.ts";

// The score|choice|noul contract: the question union, its validation, and the
// terminal presentation sink. A new answer type is one edit here.

/** Which end of a question's value range is good; drives tone. Default: high. */
export type Direction = "high" | "low";

export interface ScoreQuestion {
  type: "score";
  instructions: string;
  criteria: string[];
  direction?: Direction;
}
export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string | null>;
  direction?: Direction;
}
export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: { true?: string; false?: string };
  /** Default "low": `true` (p ≥ 0.5) is bad. "high" inverts — `true` is good. */
  direction?: Direction;
}
export type Question = ScoreQuestion | ChoiceQuestion | NoulQuestion;
export type Questions = Record<string, Question>;

/** Validate + normalize one question from a schema mapping, naming the id on error. */
export function parseQuestion(id: string, q: unknown, source: string): Question {
  const at = `${source}: question '${id}'`;
  if (!isRecord(q)) throw new Error(`${at} must be a mapping`);
  if (q.type !== "score" && q.type !== "choice" && q.type !== "noul")
    throw new Error(`${at}: 'type' must be score, choice, or noul`);
  if (typeof q.instructions !== "string" || q.instructions.length === 0)
    throw new Error(`${at}: 'instructions' must be a non-empty string`);
  let direction: Direction | undefined;
  if (q.direction !== undefined) {
    if (q.direction !== "high" && q.direction !== "low")
      throw new Error(`${at}: 'direction' must be high or low`);
    direction = q.direction;
  }
  switch (q.type) {
    case "score": {
      if (
        !Array.isArray(q.criteria) ||
        q.criteria.length < 2 ||
        !q.criteria.every((c) => typeof c === "string" && c.length > 0)
      )
        throw new Error(`${at}: 'criteria' must be an array of ≥2 non-empty level descriptions`);
      return { type: "score", instructions: q.instructions, criteria: q.criteria, ...(direction && { direction }) };
    }
    case "choice": {
      if (!isRecord(q.criteria))
        throw new Error(`${at}: 'criteria' must be a mapping of option → rubric (or null)`);
      const criteria: Record<string, string | null> = {};
      for (const [opt, rubric] of Object.entries(q.criteria)) {
        if (rubric !== null && typeof rubric !== "string")
          throw new Error(`${at}: criteria option '${opt}' must be a string or null`);
        criteria[opt] = rubric;
      }
      return { type: "choice", instructions: q.instructions, criteria, ...(direction && { direction }) };
    }
    case "noul": {
      if (q.criteria === undefined) return { type: "noul", instructions: q.instructions, ...(direction && { direction }) };
      if (!isRecord(q.criteria)) throw new Error(`${at}: 'criteria' must be a mapping with 'true'/'false'`);
      const criteria: { true?: string; false?: string } = {};
      for (const key of ["true", "false"] as const) {
        const v = q.criteria[key];
        if (v === undefined) continue;
        if (typeof v !== "string") throw new Error(`${at}: criteria '${key}' must be a string`);
        criteria[key] = v;
      }
      return { type: "noul", instructions: q.instructions, criteria, ...(direction && { direction }) };
    }
    default: {
      const _exhaustive: never = q.type;
      return _exhaustive;
    }
  }
}
export type Tone = "ok" | "warn" | "bad" | "mut";

/** ANSI SGR codes per answer tone; applied only when the caller asks for color. */
const TONE_SGR: Record<Tone, string> = { ok: "32", warn: "33", bad: "31", mut: "2" };

function paint(text: string, tone: Tone, color: boolean): string {
  return color ? `\x1b[${TONE_SGR[tone]}m${text}\x1b[0m` : text;
}

export interface ParsedAnswer {
  q: string;
  numeric: number | null;
  display: string;
  tone: Tone;
  confidence: number | null;
  probabilities: [number, number][] | null;
  /** Direct aliases for report and view callers */
  v: number | null;
  label: string;
  conf: number | null;
  probs: [number, number][] | null;
}

export function toneOf(v: number | null, dir: Direction = "high"): Tone {
  if (v === null) return "mut";
  if (dir === "low") return v <= 3 ? "ok" : v <= 6 ? "warn" : "bad";
  return v >= 7 ? "ok" : v >= 4 ? "warn" : "bad";
}

export function gradeOf(avg: number | null): string {
  if (avg === null) return "—";
  if (avg >= 9) return "S";
  if (avg >= 8) return "A";
  if (avg >= 6.5) return "B";
  if (avg >= 5) return "C";
  if (avg >= 3.5) return "D";
  return "F";
}

/** Interpret one raw answer record into a typed ParsedAnswer; fail fast on invalid shapes.
 *  `dir` undefined = per-type legacy: score → high (high is good), noul → low (true is bad). */
export function parseAnswer(q: string, a: unknown, dir?: Direction): ParsedAnswer {
  if (!isRecord(a)) throw new Error(`invalid answer for '${q}': expected record, got ${typeof a}`);

  let conf: number | null = null;
  if (typeof a.confidence === "number") conf = Math.round(a.confidence * 100);

  let probs: [number, number][] | null = null;
  if (isRecord(a.probabilities)) {
    const ps = Object.entries(a.probabilities)
      .filter(([k, p]) => /^-?\d+$/.test(k) && typeof p === "number")
      .sort((x, y) => Number(x[0]) - Number(y[0]));
    if (ps.length > 1) probs = ps.map(([k, p]) => [Number(k), p as number]);
  }

  let numeric: number | null = null;
  if (typeof a.score === "number") {
    numeric = a.score;
  } else if (typeof a.choice === "string" || typeof a.choice === "number") {
    const n = Number(a.choice);
    if (!Number.isNaN(n)) numeric = n;
  }

  if (numeric !== null) {
    const display = Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1);
    const tone = toneOf(numeric, dir);
    return { q, numeric, display, tone, confidence: conf, probabilities: probs, v: numeric, label: display, conf, probs };
  }

  if (typeof a.noul === "number" || typeof a.noul === "boolean") {
    const p = typeof a.noul === "boolean" ? (a.noul ? 1 : 0) : a.noul;
    const isBad = dir === "high" ? p < 0.5 : p >= 0.5;
    const display = isBad ? `rework ${Math.round(p * 100)}%` : `pass ${Math.round((1 - p) * 100)}%`;
    const tone: Tone = isBad ? "bad" : "ok";
    return { q, numeric: p, display, tone, confidence: conf, probabilities: probs, v: p, label: display, conf, probs };
  }

  if (a.choice !== undefined) {
    const display = String(a.choice);
    return { q, numeric: null, display, tone: "mut", confidence: conf, probabilities: probs, v: null, label: display, conf, probs };
  }

  throw new Error(`invalid answer for '${q}': missing score, choice, or noul`);
}

/** One row of a run table: the judged file, its raw response, and optional prior answers for deltas. */
export interface RunTablePair {
  file: string;
  response: unknown;
  previous?: Record<string, unknown>;
  /** Per-question direction override (from the run manifest); absent = default high. */
  directions?: Record<string, Direction>;
}

/** Delta suffix for one answer vs its prior run, mirroring formatPair's diff notation. */
function deltaSuffix(a: Record<string, unknown>, prev: Record<string, unknown> | undefined): string {
  if (!isRecord(prev)) return "";
  if (typeof a.score === "number" && typeof prev.score === "number") {
    const d = Number((a.score - prev.score).toFixed(1));
    return d > 0 ? ` (+${d})` : d < 0 ? ` (${d})` : "";
  }
  if (typeof a.noul === "number" && typeof prev.noul === "number") {
    const d = Math.round((a.noul - prev.noul) * 100);
    return d > 0 ? ` (+${d}%)` : d < 0 ? ` (${d}%)` : "";
  }
  if (typeof a.choice === "string" && prev.choice !== undefined) {
    const pc = String(prev.choice);
    const [cn, pn] = [Number(a.choice), Number(pc)];
    return pc === a.choice ? " (=)"
      : !Number.isNaN(cn) && !Number.isNaN(pn) ? ` (${cn - pn > 0 ? "+" : ""}${cn - pn})`
      : ` (was: ${pc})`;
  }
  return "";
}

/**
 * Aligned CLI table for a run's results: one row per file, one column per question,
 * cells tone-colored and suffixed with the delta vs the prior run when provided.
 */
export function runTable(pairs: RunTablePair[], color = false): string {
  const parsed = pairs.map(({ file, response, previous, directions }) => {
    const cells: { id: string; text: string; tone: Tone }[] = [];
    if (isRecord(response) && isRecord(response.answers)) {
      for (const [id, a] of Object.entries(response.answers)) {
        if (!isRecord(a)) continue;
        try {
          const p = parseAnswer(id, a, directions?.[id]);
          const prev = isRecord(previous) && isRecord(previous[id]) ? previous[id] : undefined;
          cells.push({ id, text: p.display + deltaSuffix(a, prev), tone: p.tone });
        } catch {
          cells.push({ id, text: JSON.stringify(a), tone: "mut" });
        }
      }
    }
    return { file, cells };
  });

  const ids: string[] = [];
  for (const row of parsed) for (const c of row.cells) if (!ids.includes(c.id)) ids.push(c.id);
  if (parsed.length === 0 || ids.length === 0) return "";

  const grid = parsed.map((r) =>
    ids.map((id) => r.cells.find((c) => c.id === id) ?? { text: "—", tone: "mut" as Tone }),
  );
  const fileW = Math.max("FILE".length, ...parsed.map((r) => r.file.length));
  const colW = ids.map((id, j) =>
    Math.max(id.length, ...grid.map((row) => row[j]!.text.length)),
  );

  const lines = [
    "FILE".padEnd(fileW) + "  " + ids.map((id, j) => id.toUpperCase().padEnd(colW[j]!)).join("  ").trimEnd(),
  ];
  for (let i = 0; i < parsed.length; i++) {
    const row = parsed[i]!;
    let line = row.file.padEnd(fileW) + "  ";
    grid[i]!.forEach((cell, j) => {
      const isLast = j === ids.length - 1;
      line += paint(isLast ? cell.text : cell.text.padEnd(colW[j]!), cell.tone, color) + (isLast ? "" : "  ");
    });
    lines.push(line.trimEnd());
  }
  return lines.join("\n");
}

/** Human-readable block for one recorded pair, showing diff if previous answers are provided. */
export function formatPair(file: string, response: unknown, previousAnswers?: Record<string, unknown>): string {
  const lines = [file];
  if (isRecord(response) && isRecord(response.answers)) {
    for (const [id, a] of Object.entries(response.answers)) {
      if (!isRecord(a)) continue;
      const prev = isRecord(previousAnswers) && isRecord(previousAnswers[id]) ? previousAnswers[id] : undefined;

      if (typeof a.score === "number") {
        let diffStr = "";
        if (prev && typeof prev.score === "number") {
          const diff = Number((a.score - prev.score).toFixed(1));
          diffStr = diff > 0 ? ` (+${diff})` : diff < 0 ? ` (${diff})` : " (=)";
        }
        const legend = isRecord(a.legend) ? a.legend : {};
        const label = legend[String(Math.round(a.score))];
        lines.push(`  ${id} ${a.score.toFixed(1)}${diffStr}${typeof label === "string" ? ` — ${label}` : ""}`);
      } else if (typeof a.noul === "number") {
        let diffStr = "";
        if (prev && typeof prev.noul === "number") {
          const diff = Math.round((a.noul - prev.noul) * 100);
          diffStr = diff > 0 ? ` (+${diff}%)` : diff < 0 ? ` (${diff}%)` : " (=)";
        }
        lines.push(`  ${id} ${a.noul >= 0.5 ? "yes" : "no"} (${Math.round(a.noul * 100)}%)${diffStr}`);
      } else if (typeof a.choice === "string") {
        let diffStr = "";
        if (prev && prev.choice !== undefined) {
          const pc = String(prev.choice);
          const [cn, pn] = [Number(a.choice), Number(pc)];
          diffStr =
            pc === a.choice ? " (=)"
            : !Number.isNaN(cn) && !Number.isNaN(pn) ? ` (${cn - pn > 0 ? "+" : ""}${cn - pn})`
            : ` (was: ${pc})`;
        }
        lines.push(`  ${id} ${a.choice}${diffStr}`);
      } else {
        lines.push(`  ${id} ${JSON.stringify(a)}`);
      }
    }
  }
  return lines.join("\n");
}
