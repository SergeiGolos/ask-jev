import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { isRecord } from "./guards.ts";
import { CliError } from "./errors.ts";
import { parseQuestion, type Questions } from "./answers.ts";

export type Scalar = string | number | boolean;

export interface AskMeta {
  model?: string;
  args?: Record<string, Scalar>;
  description?: string;
}

export interface FrontMatter {
  data: Record<string, unknown>;
  body: string;
}

/** Split a leading `---` … `---` YAML front-matter block from the rest of the file. */
export function splitFrontMatter(text: string): FrontMatter {
  const stripped = text.replace(/^\uFEFF/, "");
  const lines = stripped.split("\n");
  if (lines[0]?.trim() !== "---") return { data: {}, body: stripped };
  const close = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (close === -1)
    throw new Error("unterminated front matter: opening --- with no closing ---");
  const data = parseYaml(lines.slice(1, close).join("\n"));
  if (data !== null && data !== undefined && !isRecord(data))
    throw new Error("front matter must be a YAML mapping");
  return { data: data ?? {}, body: lines.slice(close + 1).join("\n") };
}

/** Validate the front-matter keys ask-jev understands; unknown keys pass through untouched. */
export function readAskMeta(data: Record<string, unknown>, source = "ask file"): AskMeta {
  const meta: AskMeta = {};
  if (data.model !== undefined) {
    if (typeof data.model !== "string")
      throw new Error(`${source}: front matter 'model' must be a string`);
    meta.model = data.model;
  }
  if (data.description !== undefined) {
    if (typeof data.description !== "string")
      throw new Error(`${source}: front matter 'description' must be a string`);
    meta.description = data.description;
  }
  if (data.args !== undefined) {
    if (!isRecord(data.args))
      throw new Error(`${source}: front matter 'args' must be a mapping`);
    const args: Record<string, Scalar> = {};
    for (const [k, v] of Object.entries(data.args)) {
      if (typeof v !== "string" && typeof v !== "number" && typeof v !== "boolean")
        throw new Error(`${source}: front matter 'args.${k}' must be a scalar`);
      args[k] = v;
    }
    meta.args = args;
  }
  return meta;
}

/** Scaffold for `ask-jev new` — valid per the locked ask anatomy, renders without prompting. */
export function newAskTemplate(name: string): string {
  return `---
# One line naming the question this ask answers; ask-jev list shows it. Update it if you repurpose the ask.
description: "Review one file for general code quality"
# Judge model. Args are token defaults; -t name=value overrides them at run time.
model: jev-latest
args:
  focus: "general quality"
---

# Review request — ask '${name}'

(This whole body is the prompt sent to the judge; edit it freely.)

Review $filename with attention to $focus.

The complete file contents:

$content

<!-- Optional: add a tool block — a \`\`\`shell fence anywhere above runs before
     judging and its stdout is inlined right there. Built-in tokens are file,
     filename and content; your args work too. -->

---
# Judge questions. Types: score (ordered criteria, >=2 levels), choice (option: rubric), noul (true/false).
severity:
  type: score
  instructions: "How severe are the problems visible in the input?"
  criteria:
    - "No real problems"
    - "Minor problems worth noting"
    - "Serious problems that need fixing"
flag:
  type: noul
  instructions: "Should this input be reworked?"
  criteria:
    true: "Yes, rework needed"
    false: "Acceptable as is"
`;
}

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

/** Checks if an ask has a valid non-empty schema to run against a judge. */
export function isRunnable(ask: ParsedAsk): boolean {
  return ask.schema !== null && Object.keys(ask.schema).length > 0;
}

/** Fails fast if the parsed ask cannot be executed. */
export function assertRunnable(ask: ParsedAsk, name: string = ask.file): asserts ask is ParsedAsk & { schema: Questions } {
  if (!isRunnable(ask)) {
    throw new CliError(`ask '${name}' has no questions schema — add one after the final ---`);
  }
}
