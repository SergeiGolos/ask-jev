import { isRecord } from "./guards.ts";

// The score|choice|noul contract: the question union, its validation, and the
// terminal presentation sink. A new answer type is one edit here.

export interface ScoreQuestion {
  type: "score";
  instructions: string;
  criteria: string[];
}
export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, string | null>;
}
export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: { true?: string; false?: string };
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
  switch (q.type) {
    case "score": {
      if (
        !Array.isArray(q.criteria) ||
        q.criteria.length < 2 ||
        !q.criteria.every((c) => typeof c === "string" && c.length > 0)
      )
        throw new Error(`${at}: 'criteria' must be an array of ≥2 non-empty level descriptions`);
      return { type: "score", instructions: q.instructions, criteria: q.criteria };
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
      return { type: "choice", instructions: q.instructions, criteria };
    }
    case "noul": {
      if (q.criteria === undefined) return { type: "noul", instructions: q.instructions };
      if (!isRecord(q.criteria)) throw new Error(`${at}: 'criteria' must be a mapping with 'true'/'false'`);
      const criteria: { true?: string; false?: string } = {};
      for (const key of ["true", "false"] as const) {
        const v = q.criteria[key];
        if (v === undefined) continue;
        if (typeof v !== "string") throw new Error(`${at}: criteria '${key}' must be a string`);
        criteria[key] = v;
      }
      return { type: "noul", instructions: q.instructions, criteria };
    }
    default: {
      const _exhaustive: never = q.type;
      return _exhaustive;
    }
  }
}

/** Human-readable block for one recorded pair (default terminal output). */
export function formatPair(file: string, response: unknown): string {
  const lines = [file];
  if (isRecord(response) && isRecord(response.answers)) {
    for (const [id, a] of Object.entries(response.answers)) {
      if (!isRecord(a)) continue;
      if (typeof a.score === "number") {
        const legend = isRecord(a.legend) ? a.legend : {};
        const label = legend[String(Math.round(a.score))];
        lines.push(`  ${id} ${a.score.toFixed(1)}${typeof label === "string" ? ` — ${label}` : ""}`);
      } else if (typeof a.noul === "number") {
        lines.push(`  ${id} ${a.noul >= 0.5 ? "yes" : "no"} (${Math.round(a.noul * 100)}%)`);
      } else if (typeof a.choice === "string") {
        lines.push(`  ${id} ${a.choice}`);
      } else {
        lines.push(`  ${id} ${JSON.stringify(a)}`);
      }
    }
  }
  return lines.join("\n");
}
