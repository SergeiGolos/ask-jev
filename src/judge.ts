import { isRecord } from "./guards.ts";

const API = "https://api.typesafe.ai/v1/systemone";

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

