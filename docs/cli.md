# CLI Reference: `ask-jev`

`ask-jev` runs hand-authored question configurations against files, evaluated by TypeSafe System One (Jev). Every run is captured as a timestamped, auditable record under `.questions/history/`.

---

## Global Options & Usage

```bash
ask-jev <command> [options]
```

When invoked with no arguments, `-h`, or `--help`, the CLI prints general usage instructions.

### Environment & Authentication

- `TYPESAFE_API_KEY`: Required to execute asks against the TypeSafe API.
- Loaded automatically in layered order:
  1. `~/.questions/.env` (profile level)
  2. `./.questions/.env` (folder/project level, overrides profile)
  3. Environment variables in the active shell (highest precedence, overrides `.env` files)

---

## Commands

### 1. `ask-jev list`

Lists all asks discovered in the profile directory and the current project folder.

```bash
ask-jev list
```

- **Lookup directories**:
  - Folder ask: `./.questions/*.md`
  - Profile ask: `~/.questions/*.md`
- **Precedence**: A folder ask shadows a profile ask with the identical name.
- **Output**: Formatted table displaying ask `NAME`, `SOURCE` (`folder` or `profile`), and default `MODEL`.

---

### 2. `ask-jev new <name> [--force]`

Scaffolds a new ask markdown template in the local project's `.questions/` directory.

```bash
ask-jev new <name> [--force]
```

#### Arguments
- `<name>`: The ask identifier (e.g. `code-smells`, `security-review`). Allowed characters: `[A-Za-z0-9_-]`.
- `--force`: Overwrites `./.questions/<name>.md` if it already exists. Without `--force`, existing files are preserved with an error.

---

### 3. `ask-jev <question-name> -f <path|glob>... [options]`

Executes an ask against one or more target files.

```bash
ask-jev <question-name> -f <path|glob>... [-t name=value]... [--batch] [--verbose] [--json] [--html]
```

#### Arguments & Flags

| Flag / Option | Description |
|---|---|
| `<question-name>` | The name of the ask to execute (resolves `<name>.md` from `./.questions` then `~/.questions`). |
| `-f <path\|glob>` | Target file or glob pattern. Can be passed multiple times (e.g. `-f file1.ts -f file2.ts` or `-f 'src/**/*.ts'`). Required if the ask prompt references `$file`, `$filename`, or `$content`. |
| `-t name=value` | Overrides or provides a custom token value for `$name`. Can be specified multiple times. Cannot override built-in tokens (`$file`, `$filename`, `$content`). |
| `--batch` | Runs all matched files through a single judge call instead of sequential per-file calls. |
| `--verbose` | Emits detailed progress logs and diagnostics during execution. |
| `--json` | Outputs JSON result payload (`{ runId, pairs: [...] }`) to `stdout` for programmatic scripting. |
| `--html` | Automatically writes a standalone interactive HTML report to `.questions/history/<runId>/report.html`. |

#### Globbing & File Resolution Rules
- Glob patterns are expanded, deduplicated, and sorted within each pattern.
- Directories are rejected directly (use glob syntax like `dir/**/*`).
- If no files match the provided `-f` flags, the command fails immediately.
- In batch mode (`--batch`), `$filename` is forbidden because there is no single target file.

---

### 4. `ask-jev history [run-id]`

Inspects recorded run history stored in `.questions/history/`.

```bash
ask-jev history [run-id]
```

#### Modes
- **Without `run-id`**: Prints a chronological tabular list of all recorded runs:
  - `RUN`: First 8 characters of the UUIDv7 run ID.
  - `WHEN`: Timestamp (UTC format `YYYY-MM-DD HH:MM:SS`).
  - `ASK`: The ask name.
  - `PAIRS`: Total count of judged file pairs in the run.
- **With `run-id`**: Displays the full manifest for a specific run. Accepts full UUIDv7 or unique leading prefix (e.g. first 8 characters).

---

### 5. `ask-jev show <run-id> [pair]`

Prints the verbatim markdown request and JSON response recorded for a specific file pair within a run.

```bash
ask-jev show <run-id> [pair]
```

#### Arguments
- `<run-id>`: Full UUIDv7 or unique leading prefix.
- `[pair]`: 1-based index of the target file pair in the run (default: `1`).

---

### 6. `ask-jev report [run-id] [-o file]`

Generates a self-contained interactive HTML report for a past run.

```bash
ask-jev report [run-id] [-o file]
```

#### Options
- `[run-id]`: Full UUIDv7 or unique prefix. Defaults to the latest recorded run if omitted.
- `-o <file>`: Output path for the HTML file. Defaults to `.questions/history/<runId>/report.html`.

---

### 7. `ask-jev serve [path] [--port <n>]`

Starts a local HTTP server hosting the Trend Matrix web dashboard over recorded history.

```bash
ask-jev serve [path] [--port 3000]
```

#### Options
- `path`: Project directory containing `.questions/history` (default: current working directory).
- `--port <n>`: TCP port to bind (default: `3000`). If port is in use, auto-increments to the next open port.

#### Web Dashboard Features
- Interactive file tree navigation.
- Matrix grid plotting question criteria against chronological run executions.
- Score delta badges and sparkline trends.
- Filtering by ask name and timestamp ranges (`from` / `to`).
- Direct JSON endpoints:
  - `GET /api/tree?ask=<name>&from=<iso>&to=<iso>`
  - `GET /api/matrix?path=<file-or-dir>&ask=<name>&from=<iso>&to=<iso>`
