---
name: ask-jev
description: Run ask-jev judgments (TypeSafe System One / Jev) against a file, a grep or glob subgroup, a diff, or a commit. Use when the user asks to run an ask, gut-feeling or SOLID-score files, or judge changes with ask-jev.
---

`ask-jev <ask> -f <path|glob>...` runs a hand-authored ask (`./.ask/<name>.md`, shadowing `~/.ask`; `ask-jev list`) and records the run under `.ask/history/<run-id>`. Cost scales with file count and `$content` size — pick the narrowest target that answers the question.

## Pick the target

| Target | Command |
|---|---|
| One file | `ask-jev <ask> -f src/cli.ts` |
| Glob subgroup | `ask-jev <ask> -f 'src/render/**/*.ts'` |
| Grep subgroup | `ask-jev <ask> $(printf -- '-f %s ' $(grep -rl 'PATTERN' src/))` |
| Diff files | `ask-jev <ask> $(printf -- '-f %s ' $(git diff --name-only HEAD))` |
| Commit's files | `ask-jev <ask> $(printf -- '-f %s ' $(git show --name-only --format= <sha>))` |

`-f` holds one value per flag — the `printf` form repeats it. Globs are deduped and sorted within pattern; directories are rejected (use `dir/**/*`); zero matches errors. Substitution splits on whitespace, so prefer globs when the subgroup is a path shape. Guard git recipes against empty output (clean tree → no `-f` → ask referencing `$content` fails).

## Pick per-file or --batch (the cost fork)

- Default: one judge call per file, sequential → per-file scores.
- `--batch`: one call over all inputs → one set-level verdict. `$file` renders as a newline list, `$content` as `## <path>` sections; `$filename` errors in batch.
- Prompt tokens are roughly equal either way; batch trades per-file granularity for a single call.

## Judge the change itself (diff/commit)

Files in a diff still get whole-file `$content`. To judge the change, use a zero-`-f` ask whose body carries a ```shell fence with the raw command (`git diff`, `git show <sha>`, `git diff <sha>~ <sha>`) — its stdout inlines into the prompt. A tool fence executes once per prompt, so in per-file mode the output is duplicated per call; tool-fence asks want exactly one call (no `-f`, or `--batch`).

## Tokens and asks

- `$file`/`$filename`/`$content` come from `-f`; `-t name=value` sets any other token, overriding front-matter `args`. A referenced token with no value hard-errors in non-TTY: pass every `-t`.
- New ask: `ask-jev new <name>` (`--force` overwrites), then edit `.ask/<name>.md`: front matter (`model:`, `args:`), markdown body, YAML questions after the final `---`.

## Read results

Default output is a per-file table. `--json` prints `{runId, pairs: [{file, answers}]}` for parsing. `ask-jev history [run-id]`, `show <run-id> [pair#]` (request md + response json), and `report [run-id] [-o file]` (HTML) inspect past runs. Scores are 0–`len(criteria)-1`; report to the user as score with its criterion label.
