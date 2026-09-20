import { homedir } from "node:os";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { askDirs, openAskStore, type AskSource } from "./askstore.ts";
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

export type { AskSource };

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
  const allAsks = await openAskStore(cwd, home).list();
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
