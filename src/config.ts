import { homedir } from "node:os";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { readAskMeta, splitFrontMatter } from "./frontmatter.ts";

export type AskSource = "folder" | "profile";

export function askDirs(cwd: string = process.cwd(), home: string = homedir()): { folder: string; profile: string } {
  // ponytail: hardcoded to .questions; add custom path config or env var if requested
  return { folder: path.join(cwd, ".questions"), profile: path.join(home, ".questions") };
}

export interface ResolvedAsk {
  file: string;
  source: AskSource;
}

/** Folder ask first, profile ask second; undefined when neither has `<name>.md`. */
export async function resolveAsk(
  name: string,
  cwd: string = process.cwd(),
  home: string = homedir(),
): Promise<ResolvedAsk | undefined> {
  const { folder, profile } = askDirs(cwd, home);
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
  description: string;
}

/** Every discovered ask; on a name clash the folder ask wins. */
export async function listAsks(cwd: string = process.cwd(), home: string = homedir()): Promise<AskEntry[]> {
  const { folder, profile } = askDirs(cwd, home);
  const byName: Record<string, AskEntry> = {};
  for (const [dir, source] of [
    [profile, "profile"],
    [folder, "folder"],
  ] as const) {
    let files: string[];
    try {
      files = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith(".md"));
    } catch {
      continue; // no .questions dir at this level
    }
    for (const f of files) {
      const file = path.join(dir, f);
      const name = f.replace(/\.md$/i, "");
      let model = "-";
      let description = "";
      try {
        const meta = readAskMeta(splitFrontMatter(await readFile(file, "utf8")).data, file);
        if (meta.model !== undefined) model = meta.model;
        if (meta.description !== undefined) description = meta.description;
      } catch {
        model = "(invalid)"; // ponytail: list keeps going on a corrupt ask; the real error surfaces at run time
      }
      byName[name] = { name, source, file, model, description }; // folder parsed after profile → folder wins on clash
    }
  }
  return Object.values(byName).sort((a, b) => a.name.localeCompare(b.name));
}
