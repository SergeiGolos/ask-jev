/** The package's one canonical object guard: narrows unknown to a keyable record. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
