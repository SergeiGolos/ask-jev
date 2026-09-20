// The grep-matching convention, owned once: case-insensitive regex, literal
// case-insensitive substring when the pattern is invalid regex. Consumers:
// the trend-matrix question filter and the watch trigger map.

/** Compile `raw` into a predicate; invalid regex degrades to a substring test. */
export function grepMatcher(raw: string): (value: string) => boolean {
  try {
    const re = new RegExp(raw, "i");
    return (value) => re.test(value);
  } catch {
    const needle = raw.toLowerCase();
    return (value) => value.toLowerCase().includes(needle);
  }
}
