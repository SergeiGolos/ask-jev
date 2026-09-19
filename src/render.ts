import { exec } from "node:child_process";
import { glob, readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import type { ParsedAsk } from "./askfile.ts";

const execp = promisify(exec);

const BUILTIN: Record<string, true> = { file: true, filename: true, content: true };
const TOKEN = /\$([A-Za-z_][A-Za-z0-9_]*)/g;

export interface RenderOptions {
  ask: ParsedAsk;
  /** Expanded -f inputs; may be empty for asks that reference no built-in tokens. */
  files: string[];
  /** -t values; override front-matter args, never the built-ins. */
  tokens: Record<string, string>;
  batch?: boolean;
  prompt?: (name: string) => Promise<string>;
  runTool?: (cmd: string) => Promise<string>;
  readText?: (path: string) => Promise<string>;
  onToolStart?: (cmd: string) => void;
}

/** Expand -f patterns (literal paths or globs) to files: deduped, in pattern order, sorted within a pattern. */
export async function expandInputs(patterns: string[], cwd = process.cwd()): Promise<string[]> {
  const files: string[] = [];
  const seen = new Set<string>();
  for (const pattern of patterns) {
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

export function placeholders(text: string): string[] {
  return [...text.matchAll(TOKEN)].map((m) => m[1]);
}

/**
 * Render the ask into one prompt per judge call: one per file, or a single batch prompt.
 * Token sources: $file/$filename/$content built from -f, then -t over front-matter args;
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
    if (BUILTIN[name]) {
      if (files.length === 0) throw new Error(`ask references $${name} but no -f input was given`);
      if (batch && name === "filename")
        throw new Error("$filename is ambiguous in --batch mode; use $file or $content");
      continue; // resolved per prompt below
    }
    if (!(name in ctx)) ctx[name] = await (o.prompt ?? promptFor)(name);
  }

  const read = o.readText ?? ((p: string) => readFile(p, "utf8"));
  // $content drops one trailing newline (like tool stdout) so the ask's own layout controls spacing.
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
    const cmd = substitute(span.code, ctx);
    o.onToolStart?.(cmd);
    const stdout = await (o.runTool ?? runTool)(cmd);
    tools.push(cmd);
    pieces.push("```output", `$ ${cmd}`, stdout.replace(/\n$/, ""), "```");
    cursor = span.end + 1;
  }
  pieces.push(...lines.slice(cursor));
  return { prompt: substitute(pieces.join("\n"), ctx), tools };
}

function substitute(text: string, ctx: Record<string, string>): string {
  return text.replace(TOKEN, (whole, name: string) => {
    if (!(name in ctx)) throw new Error(`missing token '$${name}'`);
    return ctx[name];
  });
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

async function promptFor(name: string): Promise<string> {
  if (!process.stdin.isTTY)
    throw new Error(
      `missing token '$${name}': pass -t ${name}=<value>, set it in front matter, or run on a TTY`,
    );
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(`? $${name} = `);
  } finally {
    rl.close();
  }
}
