import { homedir } from "node:os";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { readAskMeta, splitFrontMatter } from "./frontmatter.ts";

export type AskSource = "folder" | "profile";

export function askDirs(cwd: string = process.cwd()): { folder: string; profile: string } {
  return { folder: path.join(cwd, ".ask"), profile: path.join(homedir(), ".ask") };
}

export interface ResolvedAsk {
  file: string;
  source: AskSource;
}

/** Folder ask first, profile ask second; undefined when neither has `<name>.md`. */
export async function resolveAsk(name: string, cwd: string = process.cwd()): Promise<ResolvedAsk | undefined> {
  const { folder, profile } = askDirs(cwd);
  for (const [dir, source] of [
    [folder, "folder"],
    [profile, "profile"],
  ] as const) {
    const file = path.join(dir, `${name}.md`);
    try {
      if ((await stat(file)).isFile()) return { file, source };
    } catch {
      // keep looking
    }
  }
  return undefined;
}

export interface AskEntry {
  name: string;
  source: AskSource;
  file: string;
  model: string;
}

/** Every discovered ask; on a name clash the folder ask wins. */
export async function listAsks(cwd: string = process.cwd()): Promise<AskEntry[]> {
  const { folder, profile } = askDirs(cwd);
  const byName: Record<string, AskEntry> = {};
  for (const [dir, source] of [
    [profile, "profile"],
    [folder, "folder"],
  ] as const) {
    let files: string[];
    try {
      files = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith(".md"));
    } catch {
      continue; // no .ask dir at this level
    }
    for (const f of files) {
      const file = path.join(dir, f);
      const name = f.replace(/\.md$/i, "");
      let model = "-";
      try {
        const meta = readAskMeta(splitFrontMatter(await readFile(file, "utf8")).data, file);
        if (meta.model !== undefined) model = meta.model;
      } catch {
        model = "(invalid)"; // ponytail: list keeps going on a corrupt ask; the real error surfaces at run time
      }
      byName[name] = { name, source, file, model }; // folder parsed after profile → folder wins on clash
    }
  }
  return Object.values(byName).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Layer .env files under process.env: folder `./.ask/.env` beats profile `~/.ask/.env`,
 * and an already-set real environment variable beats both.
 */
export async function loadAskEnv(cwd: string = process.cwd()): Promise<void> {
  const { folder, profile } = askDirs(cwd);
  const merged: Record<string, string> = {}; // profile first, folder overwrites → nearer wins
  for (const file of [path.join(profile, ".env"), path.join(folder, ".env")]) {
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const [k, v] of parseDotEnv(text)) merged[k] = v;
  }
  for (const [k, v] of Object.entries(merged))
    if (process.env[k] === undefined) process.env[k] = v;
}

function parseDotEnv(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue; // ponytail: no `export` prefix, interpolation, or multiline values — add if an .env needs them
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    out.push([key, value]);
  }
  return out;
}
