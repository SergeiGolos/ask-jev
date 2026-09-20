# ask-jev

`ask-jev` is a tool for asking focused questions about your files and tracking the answers over time. It runs your questions against **TypeSafe System One** (Jev), records every run automatically, and gives you visual reports and trend screens to see how your code evolves.

---

## What it does

Most code analysis tools give you static errors or warnings. `ask-jev` lets you ask subjective or qualitative questions about your files—like "Is this function doing too much?", "Are these error messages helpful?", or "Does this module follow our naming conventions?"

- **Ask questions about your files**: Define questions in simple Markdown files and run them against any file or folder.
- **Track code evolution**: Every run is saved. See whether scores improve or regress as code changes.
- **Search across runs, questions, and files**: Search past runs, inspect specific files, or find questions and their answers.
- **Detailed execution details**: Inspect the exact prompt sent to the judge and the full response for every file.
- **Trend dashboard**: Explore interactive trend screens to track scores, deltas, and changes across files and directories over time.

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

1. **Questions (`.questions/<name>.md`)**: You write questions in Markdown with instructions and scoring criteria.
2. **Runs & History (`.questions/history/<run-id>/`)**: Every run saves the exact prompt, raw judge response, and scores. This creates an audit log of how each file was judged.
3. **Inspection & Trends**:
   - **Terminal output**: Instant scores and deltas compared to prior runs.
   - **Interactive HTML reports**: Detailed per-file results with prompt and response details.
   - **Web dashboard (`ask serve`)**: Search runs, filter by questions or files, and view trend matrices with score deltas over time.

---

## Getting Started

Follow these steps to set up `ask-jev`, ask your first question about a file, and view the results.

### 1. Install and set your API key

You need Node.js 24 or newer and a TypeSafe API key.

1. Register for an API key at [TypeSafe](https://typesafe.ai) (or view the [TypeSafe Documentation](https://docs.typesafe.ai)).
2. Install the CLI globally:

```bash
npm install -g ask-jev
```

3. Configure your API key.

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

### 4. View detailed execution details

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

Open `http://localhost:3000` in your browser. From the dashboard, you can:
- **Search files and folders**: Filter the file tree to see how specific components score.
- **Track trends**: View score changes over time with color-coded deltas and sparklines.
- **Browse runs**: Search past runs, inspect execution details, and view full reports.
- **Manage questions**: Edit questions and schemas directly in the browser.

---

## Core Features

- **Markdown-first questions**: Write questions in Markdown with YAML front matter and scoring schemas.
- **Dynamic tool blocks**: Run shell commands (such as `git diff` or `git log`) before judging and insert their output into the prompt.
- **Flexible question types**:
  - `score`: Numeric ratings across defined criteria levels (for example, 0 to 3).
  - `choice`: Categorical classifications mapped to option rubrics.
  - `noul`: Binary true/false checks with confidence ratings.
  - `direction: low`: Marks lower-is-better metrics (like bug severity or code smells) so lower scores display in green instead of red.
- **Per-file or batch evaluation**:
  - **Per-file** (default): Scores each file individually so you can see file-level changes.
  - **Batch** (`--batch`): Combines files into one judge call to review relationships across files and reduce API usage.
- **Project and profile questions**:
  - Save project-specific questions in `./.questions/<name>.md`.
  - Save shared personal questions in `~/.questions/<name>.md`. Local questions take precedence over personal ones.
- **Complete run history**: Every run saves the exact prompt, reference schema, and raw model output under `.questions/history/<runId>/`.
- **Interactive HTML reports**: View self-contained HTML reports with score summaries and expandable prompt/response details.
- **Trend dashboard**: A web interface (`ask serve`) that plots questions against runs, showing score deltas, sparkline trends, and directory rollups.
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
├── config.ts       # Directory resolution (.questions vs ~/.questions)
├── env.ts          # Layered .env loader (.questions/.env & ~/.questions/.env)
├── uuid7.ts        # Time-sortable UUIDv7 generator
└── web/            # Embedded web assets (app.js, style.css)
```

---

## License

[MIT](LICENSE)
