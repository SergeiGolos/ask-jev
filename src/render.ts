import { exec } from "node:child_process";
import { glob, readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import Mustache from "mustache";
import type { ParsedAsk } from "./askfile.ts";

const execp = promisify(exec);

const URL_RE = /^https?:\/\//;
const URL_TIMEOUT_MS = 30_000;

/** Fetch a -f URL input: redirects followed, hard timeout, non-2xx is a run error. */
async function readUrl(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(URL_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status} ${res.statusText}`);
  return res.text();
}

/** Built-in tokens derived from -f; -t may not shadow them. */
export const BUILTIN: Record<string, true> = { file: true, filename: true, content: true };

// Prompts are plain text, not HTML: mustache's default escaping would corrupt source code in {{content}}.
Mustache.escape = (value: unknown) => String(value);

export interface RenderOptions {
  ask: ParsedAsk;
  /** Expanded -f inputs; may be empty for asks that reference no built-in tokens. */
  files: string[];
  /** -t values; override front-matter args, never the built-ins. */
  tokens: Record<string, string>;
  batch?: boolean;
  /** Base for resolving relative file paths in the default reader. */
  cwd?: string;
  /** TTY probe for the default prompt adapter; defaults to stdin. */
  isTTY?: () => boolean;
  prompt?: (name: string) => Promise<string>;
  runTool?: (cmd: string) => Promise<string>;
  readText?: (path: string) => Promise<string>;
  onToolStart?: (cmd: string) => void;
}

/**
 * Expand -f patterns to files: literal paths or globs, deduped, in pattern order, sorted within a pattern.
 * http(s) URLs pass through verbatim (deduped on the string) and are fetched at render time.
 */
export async function expandInputs(patterns: string[], cwd = process.cwd()): Promise<string[]> {
  const files: string[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
    if (URL_RE.test(pattern)) {
      if (seen.has(pattern)) continue;
      seen.add(pattern);
      files.push(pattern);
      continue;
    }
    const matches: string[] = [];
    for await (const entry of glob(pattern, { cwd })) matches.push(entry);
    matches.sort();
    if (matches.length === 0) throw new Error(`-f '${pattern}' matched no files`);
    for (const m of matches) {
      const abs = resolve(cwd, m);
      if (seen.has(abs)) continue;
      seen.add(abs);
      if ((await stat(abs)).isDirectory())
        throw new Error(`-f '${m}' is a directory; list files instead (e.g. '${m.replace(/\/$/, "")}/**/*')`);
      files.push(m);
    }
  }
  return files;
}

/** Names referenced by {{name}} placeholders in a template, including inside sections. */
export function placeholders(text: string): string[] {
  const names: string[] = [];
  const walk = (tokens: unknown[]): void => {
    for (const token of tokens as [string, string, number, number, unknown[]?][]) {
      if (token[0] === "name" || token[0] === "&") names.push(token[1]);
      else if ((token[0] === "#" || token[0] === "^") && Array.isArray(token[4])) {
        names.push(token[1]);
        walk(token[4]);
      }
    }
  };
  walk(Mustache.parse(text));
  return names;
}

/**
 * Render the ask into one prompt per judge call: one per file, or a single batch prompt.
 * Token sources: {{file}}/{{filename}}/{{content}} built from -f, then -t over front-matter args;
 * anything else is prompted for once per run (interactive on a TTY, hard error otherwise).
 */
export async function renderPrompts(o: RenderOptions): Promise<{ prompt: string; tools: string[] }[]> {
  const { ask, files, batch = false } = o;
  if (batch && files.length === 0) throw new Error("--batch needs at least one -f input");

  const ctx: Record<string, string> = {};
  for (const [k, v] of Object.entries(ask.meta.args ?? {})) ctx[k] = String(v);
  for (const [k, v] of Object.entries(o.tokens)) ctx[k] = v;

  const referenced = new Set([...placeholders(ask.body), ...ask.tools.flatMap(placeholders)]);
  for (const name of referenced) {
    if (name in BUILTIN) {
      if (files.length === 0) throw new Error(`ask references {{${name}}} but no -f input was given`);
      if (batch && name === "filename")
        throw new Error("{{filename}} is ambiguous in --batch mode; use {{file}} or {{content}}");
      continue; // resolved per prompt below
    }
    if (!(name in ctx)) ctx[name] = o.prompt ? await o.prompt(name) : await promptFor(name, o.isTTY);
  }

  const base = o.cwd ?? process.cwd();
  const read = o.readText ?? ((p: string) => (URL_RE.test(p) ? readUrl(p) : readFile(resolve(base, p), "utf8")));
  // {{content}} drops one trailing newline (like tool stdout) so the ask's own layout controls spacing.
  const readTrimmed = async (p: string) => (await read(p)).replace(/\n$/, "");
  const needsContent = referenced.has("content");
  if (batch) {
    ctx.file = files.join("\n");
    if (needsContent) {
      const texts = await Promise.all(files.map(readTrimmed));
      ctx.content = files.map((f, i) => `## ${f}\n${texts[i]}`).join("\n\n");
    }
    return [await renderBody(ask, ctx, o)];
  }
  const prompts: { prompt: string; tools: string[] }[] = [];
  for (const file of files) {
    ctx.file = file;
    ctx.filename = file;
    if (needsContent) ctx.content = await readTrimmed(file);
    prompts.push(await renderBody(ask, ctx, o));
  }
  return prompts;
}

/** Substitute tokens in the body and execute + inline tool blocks, top to bottom. */
async function renderBody(
  ask: ParsedAsk,
  ctx: Record<string, string>,
  o: RenderOptions,
): Promise<{ prompt: string; tools: string[] }> {
  const lines = ask.body.split("\n");
  const pieces: string[] = [];
  const tools: string[] = [];
  let cursor = 0;
  for (const span of ask.toolSpans) {
    pieces.push(...lines.slice(cursor, span.start));
    const cmd = Mustache.render(span.code, ctx); // names pre-validated against ctx in renderPrompts
    o.onToolStart?.(cmd);
    const stdout = await (o.runTool ?? runTool)(cmd);
    tools.push(cmd);
    pieces.push("```output", `$ ${cmd}`, stdout.replace(/\n$/, ""), "```");
    cursor = span.end + 1;
  }
  pieces.push(...lines.slice(cursor));
  return { prompt: Mustache.render(pieces.join("\n"), ctx), tools };
}

async function runTool(cmd: string): Promise<string> {
  try {
    const { stdout } = await execp(cmd, { maxBuffer: 16 * 1024 * 1024 });
    return stdout;
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new Error(`tool failed: $ ${cmd}\n${(err.stderr || err.message).trimEnd()}`);
  }
}

async function promptFor(name: string, isTTY: () => boolean = () => process.stdin.isTTY): Promise<string> {
  if (!isTTY())
    throw new Error(
      `missing token '{{${name}}}': pass -t ${name}=<value>, set it in front matter, or run on a TTY`,
    );
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(`? {{${name}}} = `);
  } finally {
    rl.close();
  }
}
