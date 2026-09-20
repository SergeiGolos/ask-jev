// The ask store: the module owning the .questions directories — discovery plus
// CRUD over ask files. Ask content/parsing lives in askfile; path safety, the
// folder-shadows-profile rule, and the parse-error policy live here, chosen once
// for every surface (CLI, trend server).

import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { isRunnable, newAskTemplate, parseAsk, type ParsedAsk } from "./askfile.ts";

export type AskSource = "folder" | "profile";

export interface AskDirs {
  folder: string;
  profile: string;
}

/** ponytail: hardcoded to .questions; add custom path config or env var if requested */
export function askDirs(cwd: string = process.cwd(), home: string = homedir()): AskDirs {
  return { folder: path.join(cwd, ".questions"), profile: path.join(home, ".questions") };
}

export class InvalidAskNameError extends Error {}
export class AskNotFoundError extends Error {}
export class AskExistsError extends Error {}

export interface AskEntry {
  /** Relative ask name without extension ("gut-feeling/kiss"). */
  name: string;
  /** Relative path with .md, as recorded in dashboard responses. */
  path: string;
  description: string;
  /** "(invalid)" when the ask fails to parse; the message is in parseError. */
  model: string;
  args: Record<string, unknown>;
  /** Grep patterns from front matter driving `ask serve --watch` triggers. */
  grep: string[];
  isRunnable: boolean;
  source: AskSource;
  mtime: number;
  parseError: string | null;
}

export interface AskDetail extends AskEntry {
  content: string;
  /** null exactly when parseError is set. */
  parsed: ParsedAsk | null;
}

export interface AskStore {
  /**
   * Every discovered ask; on a name clash the folder ask wins. A corrupt ask
   * becomes an "(invalid)" entry instead of failing the list.
   */
  list(): Promise<AskEntry[]>;
  /** Folder first, profile second. Throws AskNotFoundError when neither has it. */
  read(name: string): Promise<AskDetail>;
  /** Writes to the folder dir only; throws AskExistsError without overwrite. */
  create(name: string, opts?: { content?: string; overwrite?: boolean }): Promise<AskDetail>;
  /** Create-or-replace in the folder dir. */
  save(name: string, content: string): Promise<AskDetail>;
  /** Rename within the folder dir. */
  move(from: string, to: string): Promise<{ from: string; to: string }>;
  /** Remove from the folder dir. */
  delete(name: string): Promise<{ name: string; path: string }>;
}

/** Normalize and validate a path inside a .questions directory to prevent traversal. */
function safeAskPath(dir: string, input: string): { fullPath: string; relPath: string } {
  if (!input || typeof input !== "string") throw new InvalidAskNameError(`invalid ask name: '${input}'`);
  let clean = input.trim().split(path.sep).join("/");
  if (!clean.toLowerCase().endsWith(".md")) clean += ".md";
  clean = clean.replace(/^\/+/, "");
  const parts = clean.split("/");
  if (parts.some((p) => p === ".." || p === "." || p === "")) throw new InvalidAskNameError(`invalid ask name: '${input}'`);
  if (parts[0] === "history") throw new InvalidAskNameError(`invalid ask name: '${input}' (history is off-limits)`);
  const fullPath = path.resolve(dir, clean);
  const rel = path.relative(dir, fullPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new InvalidAskNameError(`invalid ask name: '${input}'`);
  return { fullPath, relPath: clean };
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isENOENT(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT";
}

async function parseDetail(fullPath: string, relPath: string, source: AskSource, content: string, mtime: number): Promise<AskDetail> {
  const base = { name: relPath.replace(/\.md$/i, ""), path: relPath, source, mtime };
  try {
    const parsed = parseAsk(content, relPath);
    return {
      ...base,
      content,
      parsed,
      description: parsed.meta.description ?? "",
      model: parsed.meta.model ?? "-",
      args: (parsed.meta.args ?? {}) as Record<string, unknown>,
      grep: parsed.meta.grep ?? [],
      isRunnable: isRunnable(parsed),
      parseError: null,
    };
  } catch (err) {
    return { ...base, content, parsed: null, description: "", model: "(invalid)", args: {}, grep: [], isRunnable: false, parseError: errMessage(err) };
  }
}

export function openAskStore(cwd: string = process.cwd(), home: string = homedir()): AskStore {
  const { folder, profile } = askDirs(cwd, home);

  return {
    async list() {
      const byName = new Map<string, AskEntry>();
      for (const [dir, source] of [
        [profile, "profile"],
        [folder, "folder"],
      ] as const) {
        let files: string[];
        try {
          files = (await readdir(dir, { recursive: true }))
            .map((f) => f.split(path.sep).join("/"))
            .filter((f) => f.toLowerCase().endsWith(".md") && !f.startsWith("history/") && !/(^|\/)\.[^/]+/.test(f));
        } catch {
          continue; // no .questions dir at this level
        }
        for (const f of files) {
          try {
            const fullPath = path.join(dir, f);
            const [content, st] = [await readFile(fullPath, "utf8"), await stat(fullPath)];
            const detail = await parseDetail(fullPath, f, source, content, st.mtimeMs);
            const { content: _content, parsed: _parsed, ...entry } = detail;
            byName.set(detail.name, entry);
          } catch {
            continue; // vanished mid-list
          }
        }
      }
      return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
    },

    async read(name) {
      const target = safeAskPath(folder, name);
      for (const [dir, source] of [
        [folder, "folder"],
        [profile, "profile"],
      ] as const) {
        const fullPath = path.join(dir, target.relPath);
        try {
          const content = await readFile(fullPath, "utf8");
          return await parseDetail(fullPath, target.relPath, source, content, (await stat(fullPath)).mtimeMs);
        } catch (err) {
          if (!isENOENT(err)) throw err;
        }
      }
      throw new AskNotFoundError(`question not found: ${name}`);
    },

    async create(name, opts = {}) {
      const target = safeAskPath(folder, name);
      const exists = await stat(target.fullPath).then(() => true).catch(() => false);
      if (exists && !opts.overwrite) throw new AskExistsError(`ask already exists: ${target.fullPath}`);
      await mkdir(path.dirname(target.fullPath), { recursive: true });
      const content = opts.content ?? newAskTemplate(target.relPath.replace(/\.md$/i, ""));
      await writeFile(target.fullPath, content, "utf8");
      return parseDetail(target.fullPath, target.relPath, "folder", content, (await stat(target.fullPath)).mtimeMs);
    },

    async save(name, content) {
      const target = safeAskPath(folder, name);
      await mkdir(path.dirname(target.fullPath), { recursive: true });
      await writeFile(target.fullPath, content, "utf8");
      return parseDetail(target.fullPath, target.relPath, "folder", content, (await stat(target.fullPath)).mtimeMs);
    },

    async move(from, to) {
      const src = safeAskPath(folder, from);
      const dst = safeAskPath(folder, to);
      if (!(await stat(src.fullPath).then(() => true).catch(() => false)))
        throw new AskNotFoundError(`question not found: ${from}`);
      if (await stat(dst.fullPath).then(() => true).catch(() => false))
        throw new AskExistsError(`destination already exists: ${dst.relPath}`);
      await mkdir(path.dirname(dst.fullPath), { recursive: true });
      await rename(src.fullPath, dst.fullPath);
      return { from: src.relPath, to: dst.relPath };
    },

    async delete(name) {
      const target = safeAskPath(folder, name);
      try {
        await unlink(target.fullPath);
      } catch (err) {
        if (isENOENT(err)) throw new AskNotFoundError(`question not found: ${target.relPath}`);
        throw err;
      }
      return { name: target.relPath.replace(/\.md$/i, ""), path: target.relPath };
    },
  };
}
