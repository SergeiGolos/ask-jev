import { readFile } from "node:fs/promises";

/**
 * Merge .env files left to right, later files winning; missing files are skipped.
 * Pure: returns the layered vars and applies nothing — the caller decides where they
 * land (the CLI entry applies them under the real environment, real env winning).
 */
export async function layeredEnv(
  files: string[],
  read: (p: string) => Promise<string> = (p) => readFile(p, "utf8"),
): Promise<Record<string, string>> {
  if (!Array.isArray(files)) throw new TypeError("layeredEnv: files array is required");
  const merged: Record<string, string> = {};
  for (const file of files) {
    let text: string;
    try {
      text = await read(file);
    } catch {
      continue;
    }
    for (const [k, v] of parseDotEnv(text)) merged[k] = v;
  }
  return merged;
}

function parseDotEnv(text: string): [string, string][] {
  if (typeof text !== "string") throw new TypeError("parseDotEnv: text must be a string");
  const out: [string, string][] = [];
  for (const raw of text.split("\n")) {
    let line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
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
