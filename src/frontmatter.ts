import { parse as parseYaml } from "yaml";
import { isRecord } from "./guards.ts";

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

export type Scalar = string | number | boolean;

export interface AskMeta {
  model?: string;
  args?: Record<string, Scalar>;
}

/** Validate the front-matter keys ask-jev understands; unknown keys pass through untouched. */
export function readAskMeta(data: Record<string, unknown>, source = "ask file"): AskMeta {
  const meta: AskMeta = {};
  if (data.model !== undefined) {
    if (typeof data.model !== "string")
      throw new Error(`${source}: front matter 'model' must be a string`);
    meta.model = data.model;
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
