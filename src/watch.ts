// The watch trigger: an abstract grep→question map plus the fs watcher driving it.
// An ask declares `grep:` patterns in front matter; when `ask serve --watch` observes a
// file change matching any pattern, every matching ask runs on that file as ONE run.
// The map rebuilds whenever a question file is added, saved, or deleted.

import { watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { askDirs, openAskStore, type AskEntry } from "./askstore.ts";
import { grepMatcher } from "./grepmatch.ts";
import { invokeRun, type RunResult } from "./run.ts";

/** One compiled grep→question pair. `test` matches a `/`-separated path relative to cwd. */
export interface Trigger {
  ask: string;
  raw: string;
  test: (relPath: string) => boolean;
}

export function buildTriggers(entries: readonly Pick<AskEntry, "name" | "grep" | "isRunnable">[]): Trigger[] {
  const out: Trigger[] = [];
  for (const e of entries) {
    if (!e.isRunnable) continue;
    for (const raw of e.grep) out.push({ ask: e.name, raw, test: grepMatcher(raw) });
  }
  return out;
}

/** Unique ask names whose grep matches the changed file, in trigger order. */
export function matchTriggers(triggers: readonly Trigger[], relPath: string): string[] {
  return [...new Set(triggers.filter((t) => t.test(relPath)).map((t) => t.ask))];
}

export interface WatchOptions {
  cwd?: string;
  /** Profile .questions home override; tests point it at a tmp dir. */
  home?: string;
  /** Judge transport seam; tests inject a stub. */
  fetchImpl?: typeof fetch;
  /** Quiet window after the last fs event before firing, per file. */
  debounceMs?: number;
  /** Progress sink ([watch] lines); silent when omitted. */
  log?: (line: string) => void;
  /** Invoked with each completed watch-triggered run. */
  onRun?: (result: RunResult) => void;
}

export interface RunningWatcher {
  /** Current trigger map; rebuilt on question changes. */
  triggers: () => readonly Trigger[];
  close: () => void;
}

const SKIP = /(^|\/)(\.git|node_modules)(\/|$)/;

export async function startWatcher(o: WatchOptions = {}): Promise<RunningWatcher> {
  const cwd = o.cwd ?? process.cwd();
  const debounceMs = o.debounceMs ?? 300;
  const store = openAskStore(cwd, o.home);
  let triggers = buildTriggers(await store.list());
  o.log?.(`[watch] ${triggers.length} grep trigger(s) across ${new Set(triggers.map((t) => t.ask)).size} question(s)`);

  let rebuildTimer: NodeJS.Timeout | null = null;
  const pending = new Map<string, NodeJS.Timeout>();

  async function rebuild(): Promise<void> {
    triggers = buildTriggers(await store.list());
    o.log?.(`[watch] triggers rebuilt (${triggers.length} grep trigger(s))`);
  }

  function scheduleRebuild(): void {
    if (rebuildTimer) clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      rebuildTimer = null;
      void rebuild().catch((err) => o.log?.(`[watch] trigger rebuild failed: ${err instanceof Error ? err.message : err}`));
    }, debounceMs);
  }

  async function fire(rel: string): Promise<void> {
    const asks = matchTriggers(triggers, rel);
    if (asks.length === 0) return;
    o.log?.(`[watch] ${rel} → ${asks.join(", ")}`);
    try {
      // ONE invokeRun call: every matching ask × this file is recorded under a single run id.
      await invokeRun({
        names: asks,
        cwd,
        home: o.home,
        argv: ["--watch", ...asks, "-f", rel],
        files: [rel],
        fetchImpl: o.fetchImpl,
        onRun: o.onRun,
      });
    } catch (err) {
      // A failed run never kills the watcher.
      o.log?.(`[watch] run failed for ${rel}: ${err instanceof Error ? err.message : err}`);
    }
  }

  function onEvent(filename: string | null): void {
    if (!filename) return;
    const rel = filename.split(path.sep).join("/");
    if (SKIP.test(rel)) return;
    if (rel.startsWith(".questions/")) {
      // Question edits rebuild the map; history writes (our own runs) are ignored.
      if (!rel.startsWith(".questions/history/")) scheduleRebuild();
      return;
    }
    const prev = pending.get(rel);
    if (prev) clearTimeout(prev);
    pending.set(
      rel,
      setTimeout(() => {
        pending.delete(rel);
        void fire(rel);
      }, debounceMs),
    );
  }

  const watchers: FSWatcher[] = [watch(cwd, { recursive: true }, (_event, filename) => onEvent(filename))];
  // Profile asks live outside cwd; watch them too so their edits rebuild the map.
  try {
    watchers.push(watch(askDirs(cwd, o.home).profile, { recursive: true }, () => scheduleRebuild()));
  } catch {
    // no profile .questions dir — folder triggers still work
  }

  return {
    triggers: () => triggers,
    close() {
      if (rebuildTimer) clearTimeout(rebuildTimer);
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
      for (const w of watchers) w.close();
    },
  };
}
