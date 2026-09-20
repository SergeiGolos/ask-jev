---
name: ask
description: Run ask judgments (TypeSafe System One / Jev) against a file, a grep or glob subgroup, a diff, or a commit. Use when the user asks to run an ask, gut-feeling or SOLID-score files, judge changes, or discover what questions ask can answer.
---

`ask <ask> -f <path|glob>...` runs a hand-authored ask (`./.questions/<name>.md`, shadowing `~/.questions`) and records the run under `.questions/history/<run-id>`. Cost scales with file count and `$content` size — pick the narrowest target that answers the question.

## Pick the ask

`ask list` prints every ask with its description — one line naming the question it answers. When the fitting ask isn't obvious, run `ask list` and pick by description; when none fits, `ask new` scaffolds one with a starting description.

## Pick the target

| Target | Command |
|---|---|
| One file | `ask <ask> -f src/cli.ts` |
| URL | `ask <ask> -f https://example.com/page.md` |
| Glob subgroup | `ask <ask> -f 'src/render/**/*.ts'` |
| Grep subgroup | `ask <ask> $(printf -- '-f %s ' $(grep -rl 'PATTERN' src/))` |
| Diff files | `ask <ask> $(printf -- '-f %s ' $(git diff --name-only HEAD))` |
| Commit's files | `ask <ask> $(printf -- '-f %s ' $(git show --name-only --format= <sha>))` |

`-f` holds one value per flag — the `printf` form repeats it. Globs are deduped and sorted within pattern; directories are rejected (use `dir/**/*`); zero matches errors. Substitution splits on whitespace, so prefer globs when the subgroup is a path shape. Guard git recipes against empty output (clean tree → no `-f` → ask referencing `$content` fails).

URL targets: `https?://` inputs bypass the filesystem — fetched fresh per run (redirects followed, ~30s timeout, non-2xx fails the run), raw body becomes `$content`, `$file`/`$filename` are the URL verbatim. Runs against the same URL stack as one series in `ask history` and the serve views, grouped by host in the trend tree.

## Pick per-file or --batch (the cost fork)

- Default: one judge call per file, sequential → per-file scores.
- `--batch`: one call over all inputs → one set-level verdict. `$file` renders as a newline list, `$content` as `## <path>` sections; `$filename` errors in batch.
- Prompt tokens are roughly equal either way; batch trades per-file granularity for a single call.

## Judge the change itself (diff/commit)

Files in a diff still get whole-file `$content`. To judge the change, use a zero-`-f` ask whose body carries a ```shell fence with the raw command (`git diff`, `git show <sha>`, `git diff <sha>~ <sha>`) — its stdout inlines into the prompt. A tool fence executes once per prompt, so in per-file mode the output is duplicated per call; tool-fence asks want exactly one call (no `-f`, or `--batch`).

## Tokens and asks

- `$file`/`$filename`/`$content` come from `-f`; `-t name=value` sets any other token, overriding front-matter `args`. A referenced token with no value hard-errors in non-TTY: pass every `-t`.
- New ask: `ask new <name>` (`--force` overwrites), then edit `.questions/<name>.md`: front matter (`description:`, `model:`, `args:`), markdown body, YAML questions after the final `---`.

## Read results

Default output is a per-file table; each question line carries a diff against the file's previous run of the same ask (`(+1)`, `(-2)`, `(=)` for numeric scores/choices; `(was: x)` for relabeled choices). `--json` prints `{runId, pairs: [{file, answers}]}` for parsing. `ask history [run-id]`, `show <run-id> [pair#]` (request md + response json), and `report [run-id] [-o file]` (HTML) inspect past runs. Scores are 0–`len(criteria)-1`; report to the user as score with its criterion label. `ask clean --force` wipes `.questions/history/` (refuses without `--force`) — only on explicit request.

## Check what changed after a run

To verify an edit moved the scores, diff the file against its prior evaluation:

| Scope | Command |
|---|---|
| Latest run of the file | `ask history -f src/cli.ts` |
| Specific run | `ask history <run-id> -f src/cli.ts` |

The comparison target is the most recent earlier run of the **same ask** covering that file. Typical flow: run the ask, edit the file, run the ask again — the inline diff in the run output (or `history -f <file>`) shows which questions moved. `history -f` errors when no run recorded the file; an 8-char run prefix can be ambiguous — lengthen it.
