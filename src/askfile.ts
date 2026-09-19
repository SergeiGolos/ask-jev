import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { isRecord } from "./guards.ts";
import { readAskMeta, splitFrontMatter, type AskMeta } from "./frontmatter.ts";
import { parseQuestion, type Questions } from "./answers.ts";

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
