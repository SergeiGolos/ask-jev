# ask-jev

`ask-jev` is a tool for asking focused questions about your files and tracking the answers over time. It runs your questions against **TypeSafe System One** (Jev), records every run automatically, and gives you visual reports and trend screens to see how your code evolves.

---

## What it does

Most code analysis tools check static rules. `ask-jev` evaluates qualitative questions: "Is this function doing too much?", "Are these error messages helpful?", or "Does this module follow our naming conventions?"

- Define questions in Markdown and evaluate any file or directory.
- Track score regressions and improvements across revisions.
- Audit runs with the exact prompt and raw model response for each file.
- Inspect trends, score deltas, and sparklines in the terminal or web dashboard.

---

## How it works

```
   Write questions in Markdown (.questions/<name>.md)
                        │
                        ▼
          Run: ask <name> -f <files>
                        │
                        ▼
       TypeSafe Judge evaluates each file
                        │
                        ▼
      Results saved to .questions/history/
      (prompt, response, and score manifest)
                        │
                        ▼
          Explore trends: ask serve
   (Search runs, inspect files, and track scores)
```

1. **Questions**: Authored in `.questions/<name>.md` with instructions and scoring criteria.
2. **Runs & history**: Saved to `.questions/history/<run-id>/` with the prompt, raw model response, and score manifest.
3. **Inspection & trends**:
   - Terminal: live scores with deltas against prior runs.
   - HTML reports: standalone reports with expandable prompts and responses (`--html`).
   - Web dashboard (`ask serve`): trend matrices, sparklines, and run search.

---

## Getting Started

Node.js 24 or newer and a TypeSafe API key are required.

### 1. Install and set your API key

1. Register for an API key at [TypeSafe](https://typesafe.ai) (or view the [TypeSafe Documentation](https://docs.typesafe.ai)).
2. Install the CLI globally:

```bash
# Install the latest GitHub release
npm install -g https://github.com/SergeiGolos/ask-jev/releases/latest/download/ask-jev-latest.tgz

# Or install a specific version
npm install -g https://github.com/SergeiGolos/ask-jev/releases/download/v0.1.0/ask-jev-0.1.0.tgz
```

This installs the `ask-jev` package and exposes the `ask` command in your PATH.

You can set the key globally in your user profile so all projects can use it, or locally in a single project repository.

#### Option A: Set in your user profile (recommended)

Save the key in `~/.questions/.env` so `ask` can find it across all your repositories:

**macOS / Linux (bash/zsh):**
```bash
mkdir -p ~/.questions
echo "TYPESAFE_API_KEY=your_key_here" >> ~/.questions/.env
```

**Windows (PowerShell):**
```powershell
New-Item -ItemType Directory -Force -Path "$HOME\.questions"
Add-Content -Path "$HOME\.questions\.env" -Value "TYPESAFE_API_KEY=your_key_here"
```

**Windows (Command Prompt):**
```cmd
if not exist "%USERPROFILE%\.questions" mkdir "%USERPROFILE%\.questions"
echo TYPESAFE_API_KEY=your_key_here >> "%USERPROFILE%\.questions\.env"
```

#### Option B: Set for a single project

Save the key inside the current project folder:

```bash
mkdir -p .questions
echo "TYPESAFE_API_KEY=your_key_here" >> .questions/.env
```

You can also pass `TYPESAFE_API_KEY` as an environment variable in your current terminal session.
### 2. Create your first question

Create a starter question file:

```bash
ask new code-review
```

This creates `.questions/code-review.md` with starter scoring criteria. You can edit this file in any text editor to customize the prompt or the questions.

### 3. Run the question on your files

Run your question against one or more files:

```bash
# Check one file
ask code-review -f src/index.ts

# Check all files matching a pattern
ask code-review -f 'src/**/*.ts'
```

The terminal shows scores for each file. If you have run this question before, it also shows whether the score went up or down.

### 4. Inspect run details

Generate an interactive HTML report to inspect the exact prompt and response:

```bash
ask code-review -f src/index.ts --html
```

Or inspect past runs directly in your terminal:

```bash
# List past runs
ask history

# View the exact prompt and response for pair #1 of a run
ask show <run-id> 1
```

### 5. Open the trend dashboard

Launch the local web dashboard:

```bash
ask serve
```

Open `http://localhost:3000` in your browser to:
- Filter the file tree to inspect component scores.
- Track score changes over time with color-coded deltas and sparklines.
- Search past runs and audit prompt-response pairs.
- Edit questions and schemas directly in the browser.

---

## Core Features

- **Markdown questions**: Authored with YAML front matter and scoring schemas.
- **Shell tool blocks**: Fenced ```shell blocks run local commands (e.g. `git diff`) and inline stdout into the prompt before judging.
- **Three question types**:
  - `score`: Ordinal ratings across defined criteria levels (e.g. 0 to 3).
  - `choice`: Categorical selection mapped to rubrics.
  - `noul`: Binary true/false checks with confidence ratings.
  - `direction: low`: Inverts display tone so lower scores render green and higher scores red.
- **Evaluation modes**:
  - Per-file (default): Evaluates each file individually to surface per-file deltas.
  - Batch (`--batch`): Combines files into one judge call to evaluate cross-file relationships and save tokens.
- **Layered question resolution**:
  - Local questions in `./.questions/<name>.md`.
  - Shared personal questions in `~/.questions/<name>.md`. Local questions shadow profile questions.
- **Audit trail**: Every run records the rendered prompt, schema, and raw model output under `.questions/history/<runId>/`.
- **Trend dashboard**: `ask serve` plots questions against runs, displaying score deltas, sparklines, and directory rollups.
---

## CLI Commands

| Command | Description |
|---|---|
| `ask list` | List available questions in `./.questions` and `~/.questions` |
| `ask new <name> [--force]` | Create a new question template in `.questions/<name>.md` |
| `ask <name> -f <path\|glob>...` | Run questions against target files |
| `ask history [run-id]` | List past runs or inspect a specific run |
| `ask history [run-id] -f <file>` | Compare a file's answers against its previous run |
| `ask clean [--force]` | Delete recorded run history from `.questions/history/` |
| `ask show <run-id> [pair#]` | View the exact prompt and response recorded for a file in a run |
| `ask report [run-id] [-o file]` | Generate an interactive HTML report |
| `ask serve [path] [--port 3000] [--watch]` | Start the local web dashboard; `--watch` runs questions when matching files change |

See [docs/cli.md](docs/cli.md) for full flag descriptions, arguments, and examples.
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

Detailed reference documents are available in the [`docs/`](docs/) directory:
- [CLI Reference](docs/cli.md): Commands, arguments, options, and environment variables.
- [Markdown Format Guide](docs/markdown-format.md): Anatomy of a question file, variables, shell tools, and question schemas.
- [Web UI Views](docs/views.md): Overview of dashboard views, routes, and data flow.

---

## Architecture

```
src/
├── cli.ts          # CLI entry point, routing, and terminal presentation
├── run.ts          # Pipeline coordination: discovery, rendering, judging, recording
├── askfile.ts      # Markdown parser, metadata inspection, and scaffolding template
├── render.ts       # Token substitution, batch layout, and shell tool execution
├── answers.ts      # Typed question schemas (score/choice/noul) & result formatting
├── history.ts      # Run persistence under .questions/history/ (manifest, request/response)
├── report.ts       # Interactive HTML report generator
├── matrix.ts       # Trend matrix query engine, time-series data, and rollups
├── serve.ts        # HTTP server hosting web dashboard & REST API
├── watch.ts        # Grep-trigger map and fs watcher for `ask serve --watch`
├── grepmatch.ts    # The grep-matching convention (regex-i, substring fallback) shared by matrix and watch
├── config.ts       # Directory resolution (.questions vs ~/.questions)
├── env.ts          # Layered .env loader (.questions/.env & ~/.questions/.env)
├── uuid7.ts        # Time-sortable UUIDv7 generator
└── web/            # Embedded web assets (app.js, style.css)
```

---

## License

[MIT](LICENSE)
