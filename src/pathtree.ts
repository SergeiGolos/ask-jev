// pathtree.ts — generic nested-directory grouping for path lists, shared by the
// trend matrix and the report. Shells own domain payloads (run counts, scores)
// and tree walks; this owns only the insertion loop.

export interface Dir<T> {
  name: string;
  /** Directory path: the segment chain from the root ("" at root). */
  path: string;
  dirs: Map<string, Dir<T>>;
  /** Leaf payloads keyed by file name (last path segment). */
  files: Map<string, T>;
}

export function newDir<T>(name: string, path: string): Dir<T> {
  return { name, path, dirs: new Map(), files: new Map() };
}

/**
 * Insert value at the path given by segments, creating intermediate dirs.
 * `filePath` is stored as the payload key; callers split paths themselves so
 * each shell keeps its own separator and normalization policy.
 */
export function insert<T>(root: Dir<T>, segments: string[], filePath: string, value: T): void {
  let cur = root;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    let next = cur.dirs.get(seg);
    if (!next) {
      next = newDir<T>(seg, cur.path ? `${cur.path}/${seg}` : seg);
      cur.dirs.set(seg, next);
    }
    cur = next;
  }
  cur.files.set(segments[segments.length - 1]!, value);
}
