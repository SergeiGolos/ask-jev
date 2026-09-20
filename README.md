# ask-jev

Hand-authored question configurations evaluated by **TypeSafe System One** (Jev) with automatic history recording, interactive HTML reports, and a temporal trend dashboard.

---

## The Wayfind (Mental Model)

```
       .questions/<name>.md
     (frontmatter + prompt + schema)
                 │
                 ▼
         ask <name> -f <target>
                 │
      ┌──────────┴──────────┐
      ▼                     ▼
 Per-File Mode          Batch Mode
(1 call / file)      (1 call / all)
      │                     │
      └──────────┬──────────┘
                 ▼
        TypeSafe Judge API
                 │
                 ▼
     .questions/history/<run-id>/
    ├── run.json
    ├── 001-<slug>.request.md
    ├── 001-<slug>.response.json
    └── report.html
                 │
                 ▼
        ask serve
    (Trend Matrix Dashboard)
```

1. **Questions (`.questions/<name>.md`)**: An ask is a single markdown file defining execution metadata, a prompt template with `{{token}}` placeholders (Mustache), optional executable shell tool blocks, and a YAML questions schema.
2. **Runs & History (`.questions/history/<runId>/`)**: Every run is assigned a time-sorted UUIDv7 identifier. The exact prompt rendered and the raw JSON response from the judge are persisted for every file, creating an immutable audit trail.
3. **Reports & Visualization**:
   - **CLI Table / JSON**: Instant terminal scores and JSON output for CI scripting.
   - **Interactive HTML Report**: Expandable three-level pair inspection (Result → Composition → Verbose console).
   - **Trend Matrix Server**: A web dashboard (`ask serve`) displaying question criteria over time, file/folder rollups, and delta trends.

---

## Quick Start

### 1. Prerequisites
- **Node.js**: `>= 24`
- **TypeSafe API Key**: Set `TYPESAFE_API_KEY` in your environment or in `.questions/.env`:
  ```bash
  mkdir -p .questions
  echo "TYPESAFE_API_KEY=your_key_here" > .questions/.env
  ```
- **Install the CLI** (command name: `ask`):
  ```bash
  npm install -g ask-jev
  ```

### 2. Scaffold a Question

```bash
ask new review
```

This creates `.questions/review.md` from the built-in template with front matter, prompt body, and question schema.

### 3. Run the Ask

```bash
# Judge each matching file individually
ask review -f 'src/**/*.ts'

# Run in batch mode (single judge call over all matched files)
ask review -f 'src/**/*.ts' --batch

# Generate an interactive HTML report
ask review -f src/cli.ts --html
```

### 4. Explore History and Trends

```bash
# List past runs
ask history

# View raw request & response pair
ask show <run-id> 1

# Launch the trend dashboard
ask serve
```

---

## Core Features

- **Markdown-First Authoring**: Write questions naturally in markdown with standard YAML front matter and schemas.
- **Dynamic Tool Blocks**: Inline ```shell blocks (e.g. `git diff`, `git log`) that execute before judging and insert their stdout into the prompt.
- **Typed Question Schemas**:
  - `score`: Ordinal scales across descriptive criteria levels (0 to N-1).
  - `choice`: Categorical classifications mapped to option rubrics.
  - `noul`: Probabilistic binary true/false judgments.
  - `direction: low` per question marks lower-is-better scales (violations, severity), so low scores render green instead of red; judge confidence renders as a low→high trust meter in reports.
- **Granular vs Batch Execution**:
  - **Per-file** (default): Granular per-file scores and file-level accountability.
  - **Batch** (`--batch`): Aggregates all files into a single judge call to minimize API requests and judge holistic relationships.
- **Layered Ask Discovery**:
  - Project asks (`./.questions/<name>.md`) shadow Profile asks (`~/.questions/<name>.md`). Keep common personal asks in your home directory and project-specific asks in the repo.
- **Immutable Run Lineage**: Every run records the rendered markdown prompt, reference schema, and raw model output under `.questions/history/<runId>/`.
- **Standalone Interactive HTML Reports**: Self-contained single-file HTML reports generated on-demand with zero external runtime dependencies.
- **Trend Matrix Dashboard**: Web UI mapping questions (rows) against runs (columns) with temporal delta tracking, sparklines, and directory rollups.

---

## CLI Commands Overview

| Command | Description |
|---|---|
| `ask list` | List available asks in `./.questions` and `~/.questions` |
| `ask new <name> [--force]` | Scaffold a new question template in `.questions/<name>.md` |
| `ask <ask> -f <path\|glob>...` | Execute an ask against target files |
| `ask history [run-id]` | List past run manifests or inspect a single run |
| `ask history [run-id] -f <file>` | Diff a file's answers vs the prior run of the same ask |
| `ask clean [--force]` | Delete all recorded runs under `.questions/history/` |
| `ask show <run-id> [pair#]` | Print raw request markdown and response JSON for a pair |
| `ask report [run-id] [-o file]` | Generate interactive HTML report |
| `ask serve [path] [--port 3000]` | Start the local Trend Matrix web dashboard |

See [docs/cli.md](docs/cli.md) for detailed flag references, arguments, and examples.

---

## Markdown Question Format

An ask markdown file is composed of:
1. **Front Matter**: `model` selection and default `args`.
2. **Prompt Body**: Markdown text containing `{{file}}`, `{{filename}}`, `{{content}}`, custom tokens, and optional ```shell tool fences.
3. **Separator**: The final standalone `---` line.
4. **Questions Schema**: YAML defining `score`, `choice`, or `noul` questions.

```markdown
---
model: jev-latest
args:
  focus: "code structure"
---

Review {{filename}} for {{focus}}.

Source:
{{content}}

---

clarity:
  type: score
  instructions: "Is this code well-structured and clear?"
  criteria:
    - "Obscure and difficult to follow"
    - "Understandable with effort"
    - "Clean and idiomatic"
```

See [docs/markdown-format.md](docs/markdown-format.md) for the complete format specification and recipes.

---

## Documentation

Detailed references are available in the [`docs/`](docs/) directory:
- [CLI Reference](docs/cli.md) — Exhaustive documentation of all commands, arguments, flags, and environment variables.
- [Markdown Format Guide](docs/markdown-format.md) — Anatomy of an ask file, token substitution, tool execution, and schema definitions.

---

## Architecture & Implementation

```
src/
├── cli.ts          # CLI entry point, routing, and terminal presentation
├── run.ts          # Pipeline coordination: discovery, rendering, judging, recording
├── askfile.ts      # Markdown parser, metadata inspection, and scaffolding template
├── render.ts       # Token substitution, batch layout, and shell tool execution
├── judge.ts        # TypeSafe API client (POST /v1/judge)
├── answers.ts      # Typed question schemas (score/choice/noul) & result formatting
├── history.ts      # Run persistence under .questions/history/ (manifest, request/response)
├── report.ts       # Interactive HTML report generator
├── matrix.ts       # Trend matrix query engine, time-series data, and rollups
├── serve.ts        # HTTP server hosting web dashboard & REST API
├── config.ts       # Directory resolution (.questions vs ~/.questions)
├── env.ts          # Layered .env loader (.questions/.env & ~/.questions/.env)
├── uuid7.ts        # Time-sortable UUIDv7 generator
└── web/            # Embedded web assets (app.js, style.css)
```

---

## License

[MIT](LICENSE)
