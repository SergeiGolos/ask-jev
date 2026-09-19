import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { isRecord } from "./guards.ts";
import { readAskMeta, splitFrontMatter, type AskMeta } from "./frontmatter.ts";

// Question schema per the TypeSafe contract (map ticket 01).
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

export interface ToolSpan {
  /** 0-based line indexes into `body`, inclusive. */
  start: number;
  end: number;
  code: string;
}

export interface ParsedAsk {
  file: string;
  meta: AskMeta;
  /** Prompt body: everything between front matter and the schema separator, fences left in place. */
  body: string;
  /** ```shell fence contents, in document order. */
  tools: string[];
  /** Where each tool fence sits in `body`, so renderers can replace blocks in place. */
  toolSpans: ToolSpan[];
  /** Judge questions from after the last standalone `---`; null when the ask has none. */
  schema: Questions | null;
}

/**
 * Parse an ask file: leading `---` YAML front matter, prompt body with ```shell tool
 * fences, and after the LAST standalone `---` (outside any fence) the YAML questions schema.
 * A `---` inside a fence never splits.
 */
export function parseAsk(text: string, file = "ask file"): ParsedAsk {
  const { data, body } = splitFrontMatter(text);
  const meta = readAskMeta(data, file);

  const lines = body.split("\n");
  const tools: string[] = [];
  const toolSpans: ToolSpan[] = [];
  const separators: number[] = [];
  let fence: { shell: boolean; start: number } | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (fence) {
      if (lines[i].trimStart().startsWith("```")) {
        if (fence.shell) {
          const code = lines.slice(fence.start + 1, i).join("\n");
          tools.push(code);
          toolSpans.push({ start: fence.start, end: i, code });
        }
        fence = null;
      }
      continue;
    }
    const open = /^\s*```(.*)$/.exec(lines[i]);
    if (open) {
      const info = open[1].trim().split(/\s+/)[0] ?? "";
      fence = { shell: info.toLowerCase() === "shell", start: i };
    } else if (lines[i].trim() === "---") {
      separators.push(i);
    }
  }
  if (fence) throw new Error(`${file}: unterminated code fence`);

  let bodyText = body;
  let schema: Questions | null = null;
  if (separators.length > 0) {
    const last = separators[separators.length - 1];
    bodyText = lines.slice(0, last).join("\n");
    schema = parseQuestions(lines.slice(last + 1).join("\n"), `${file} schema`);
  }
  return { file, meta, body: bodyText, tools, toolSpans, schema };
}

export async function readAsk(file: string): Promise<ParsedAsk> {
  return parseAsk(await readFile(file, "utf8"), file);
}

/** Parse + validate a YAML questions schema into the JSON shape the judge expects. */
export function parseQuestions(text: string, source = "schema"): Questions {
  const raw: unknown = parseYaml(text);
  if (raw === null || raw === undefined) throw new Error(`${source}: schema is empty`);
  if (!isRecord(raw)) throw new Error(`${source}: schema must be a mapping of question id → question`);
  const questions: Questions = {};
  for (const [id, q] of Object.entries(raw)) questions[id] = parseQuestion(id, q, source);
  return questions;
}

function parseQuestion(id: string, q: unknown, source: string): Question {
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
