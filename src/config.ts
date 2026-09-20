import { homedir } from "node:os";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { readAskMeta, splitFrontMatter } from "./askfile.ts";
import { layeredEnv } from "./env.ts";

export interface AppConfig {
  cwd: string;
  folder: string;
  profile: string;
  apiKey?: string;
  env: Record<string, string>;
}

/** Resolve project and profile configuration without mutating global process state. */
export async function resolveConfig(
  cwd: string = process.cwd(),
  home: string = homedir(),
  baseEnv: NodeJS.ProcessEnv = process.env,
): Promise<AppConfig> {
  const { folder, profile } = askDirs(cwd, home);
  const layered = await layeredEnv([path.join(profile, ".env"), path.join(folder, ".env")]);
  const combined: Record<string, string> = { ...layered };
  for (const [k, v] of Object.entries(baseEnv)) {
    if (v !== undefined) combined[k] = v;
  }
  return {
    cwd,
    folder,
    profile,
    apiKey: combined.TYPESAFE_API_KEY,
    env: combined,
  };
}

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
  if (!name || typeof name !== "string")
    throw new TypeError(`resolveAsk: ask name must be a non-empty string, got '${name}'`);
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
  for (const candidate of [path.resolve(cwd, name), path.resolve(cwd, `${name}.md`)]) {
    try {
      if ((await stat(candidate)).isFile()) return { file: candidate, source: "folder" };
    } catch {
      // keep looking
    }
  }
  return undefined;
}

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  return new RegExp("^" + escaped.replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
}

/** Expand question names: if a name matches a directory or glob pattern, expands to all matching questions. */
export async function expandAskNames(
  names: string[],
  cwd: string = process.cwd(),
  home: string = homedir(),
): Promise<string[]> {
  const { folder, profile } = askDirs(cwd, home);
  const allAsks = await listAsks(cwd, home);
  const out: string[] = [];

  for (const raw of names) {
    let clean = raw.replace(/[/\\]+$/, "");
    if (clean.startsWith(".questions/") || clean.startsWith(".questions\\")) {
      clean = clean.slice(11);
    }

    // 1. Glob matching (* or ?) against discovered ask names
    if (raw.includes("*") || raw.includes("?")) {
      const re = globToRegex(clean.replace(/\.md$/i, ""));
      const matched = allAsks.filter((a) => re.test(a.name));
      if (matched.length > 0) {
        for (const m of matched) out.push(m.name);
        continue;
      }
    }

    // 2. Exact directory prefix match against discovered asks (e.g. "gut-feeling" -> "gut-feeling/*")
    const prefix = clean + "/";
    const prefixMatched = allAsks.filter((a) => a.name.startsWith(prefix));
    if (prefixMatched.length > 0) {
      for (const m of prefixMatched) out.push(m.name);
      continue;
    }

    // 3. Filesystem directory candidates (including custom directories outside .questions)
    const candidates = [
      { dir: path.join(folder, clean), root: folder },
      { dir: path.join(profile, clean), root: profile },
      { dir: path.resolve(cwd, raw), root: cwd },
    ];

    let foundDir = false;
    for (const { dir } of candidates) {
      try {
        const st = await stat(dir);
        if (st.isDirectory()) {
          const files = (await readdir(dir, { recursive: true }))
            .map((f) => f.split(path.sep).join("/"))
            .filter((f) => f.toLowerCase().endsWith(".md") && !f.startsWith("history/") && !/(^|\/)\.[^/]+/.test(f));

          if (files.length > 0) {
            files.sort();
            for (const f of files) {
              const full = path.join(dir, f);
              if (full.startsWith(folder)) {
                out.push(path.relative(folder, full).replace(/\.md$/i, "").split(path.sep).join("/"));
              } else if (full.startsWith(profile)) {
                out.push(path.relative(profile, full).replace(/\.md$/i, "").split(path.sep).join("/"));
              } else {
                out.push(path.relative(cwd, full).replace(/\.md$/i, "").split(path.sep).join("/"));
              }
            }
            foundDir = true;
            break;
          }
        }
      } catch {
        // continue
      }
    }

    if (!foundDir) {
      out.push(raw);
    }
  }

  return out;
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
      // ponytail: recursive readdir for organized question subdirectories; skips history/ and dotfiles
      files = (await readdir(dir, { recursive: true }))
        .map((f) => f.split(path.sep).join("/"))
        .filter((f) => f.toLowerCase().endsWith(".md") && !f.startsWith("history/") && !/(^|\/)\.[^/]+/.test(f));
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
