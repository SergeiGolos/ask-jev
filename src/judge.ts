import { isRecord } from "./guards.ts";

const API = "https://api.typesafe.ai/v1/systemone";

const LANG: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript", js: "JavaScript", mjs: "JavaScript", cjs: "JavaScript", jsx: "JavaScript",
  py: "Python", go: "Go", rs: "Rust", java: "Java", kt: "Kotlin", swift: "Swift", rb: "Ruby", php: "PHP",
  c: "C", h: "C", cpp: "C++", cc: "C++", cs: "C#", md: "Markdown", json: "JSON",
};

export const langOf = (p: string): string => LANG[p.split(".").pop()!.toLowerCase()] ?? "Unknown";

export interface JudgeInput {
  key: string;
  model: string;
  questions: Record<string, unknown>;
  state: Record<string, unknown>;
  retries?: number;
  backoffMs?: number;
  fetchImpl?: typeof fetch;
}

export interface JudgeResult {
  model: string;
  answers: Record<string, unknown>;
  usage?: unknown;
}

/**
 * One judge call. Retries 429/529 with retry-after or exponential backoff; any other
 * non-OK status is terminal (401 names the key, 422 surfaces the validation body).
 */
export async function judge(input: JudgeInput): Promise<JudgeResult> {
  const retries = input.retries ?? 4;
  const backoffMs = input.backoffMs ?? 500;
  const doFetch = input.fetchImpl ?? fetch;
  for (let attempt = 0; ; attempt++) {
    const res = await doFetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${input.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ state: input.state, model: input.model, questions: input.questions }),
    });
    if (res.ok) {
      const body: unknown = await res.json();
      if (!isRecord(body) || !isRecord(body.answers)) throw new Error(`unexpected response shape from ${API}`);
      return {
        model: typeof body.model === "string" ? body.model : input.model,
        answers: body.answers,
        usage: body.usage,
      };
    }
    if ((res.status === 429 || res.status === 529) && attempt < retries) {
      const retryAfter = Number(res.headers.get("retry-after"));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : backoffMs * 2 ** attempt;
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, waitMs);
      await promise;
      continue;
    }
    const text = (await res.text()).slice(0, 300);
    if (res.status === 401) throw new Error("TypeSafe rejected the API key (401) — check TYPESAFE_API_KEY");
    throw new Error(`TypeSafe API ${res.status}: ${text}`);
  }
}

/** The state field for one judge call: the rendered prompt is the entire state (map ticket 01). */
export function judgeState(file: string, prompt: string, single: boolean): Record<string, unknown> {
  return single ? { prompt, path: file, language: langOf(file) } : { prompt };
}

/** Human-readable block for one recorded pair (default terminal output). */
export function prettyPair(file: string, response: unknown): string {
  const lines = [file];
  if (isRecord(response) && isRecord(response.answers)) {
    for (const [id, a] of Object.entries(response.answers)) {
      if (!isRecord(a)) continue;
      if (typeof a.score === "number") {
        const legend = isRecord(a.legend) ? a.legend : {};
        const label = legend[String(Math.round(a.score))];
        lines.push(`  ${id} ${a.score.toFixed(1)}${typeof label === "string" ? ` — ${label}` : ""}`);
      } else if (typeof a.noul === "number") {
        lines.push(`  ${id} ${a.noul >= 0.5 ? "yes" : "no"} (${Math.round(a.noul * 100)}%)`);
      } else if (typeof a.choice === "string") {
        lines.push(`  ${id} ${a.choice}`);
      } else {
        lines.push(`  ${id} ${JSON.stringify(a)}`);
      }
    }
  }
  return lines.join("\n");
}
