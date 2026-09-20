// scoring.ts — pure answer math shared by the trend matrix and the report.
// Arrays and raw judge responses in, scored results out; no fs, no HTTP.
// Both shells used to own this logic verbatim, each testable only through
// on-disk run fixtures.

import { isRecord } from "./guards.ts";
import { parseAnswer, type Direction, type ParsedAnswer, type Tone } from "./answers.ts";

/**
 * Extract and parse the answers record from one judge response. Returns [] when
 * the response has no answers mapping; throws on a malformed entry (fail fast,
 * same as the previous inline behavior in both shells). Per-question directions
 * (lower-is-better) are honored when provided.
 */
export function parseAnswers(response: unknown, dirs?: Record<string, Direction>): ParsedAnswer[] {
  if (!isRecord(response) || !isRecord(response.answers)) return [];
  return Object.entries(response.answers).map(([qid, raw]) => parseAnswer(qid, raw, dirs?.[qid]));
}

export interface CellAggregate {
  value: number | null;
  display: string;
  tone: Tone;
  /** Answers aggregated: files judged for this question within one run. */
  count: number;
  min?: number;
  max?: number;
}

/**
 * Aggregate one question's answers within a single run into a trend-matrix cell.
 * One answer passes through; several numeric answers average (with spread);
 * answers without any numeric value display as muted. Tone thresholds mirror
 * toneOf's high direction, matching the matrix's historical display policy.
 */
export function aggregateCell(answers: ParsedAnswer[]): CellAggregate {
  if (answers.length === 1) {
    const a = answers[0]!;
    return { value: a.numeric, display: a.display, tone: a.tone, count: 1 };
  }
  const numerics = answers.map((a) => a.numeric).filter((n): n is number => n !== null);
  if (numerics.length > 0) {
    const avg = numerics.reduce((sum, v) => sum + v, 0) / numerics.length;
    const display = Number.isInteger(avg) ? String(avg) : avg.toFixed(1);
    return {
      value: avg,
      display: `${display} (n=${numerics.length})`,
      tone: avg >= 7 ? "ok" : avg >= 4 ? "warn" : "bad",
      count: numerics.length,
      min: Math.min(...numerics),
      max: Math.max(...numerics),
    };
  }
  return {
    value: null,
    display: `${answers[0]?.display || "—"} (n=${answers.length})`,
    tone: "mut",
    count: answers.length,
  };
}
