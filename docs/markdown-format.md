# Ask Markdown Format

Every ask configuration in `ask` is a single markdown file located in `.questions/<name>.md` (or `~/.questions/<name>.md`).

An ask file is composed of four distinct sections, in order:
1. **YAML Front Matter**: Execution metadata and default arguments.
2. **Prompt Body**: The prompt sent to the judge, containing tokens and optional shell tool blocks.
3. **Schema Separator**: The final standalone `---` separator outside any code blocks.
4. **Questions Schema**: YAML defining the typed questions, rubrics, and evaluation criteria.

---

## Visual Anatomy

```markdown
---
model: jev-latest
args:
  focus: "maintainability"
---

# Prompt Title

Review the implementation of $filename with respect to $focus.

The full source code:

$content

```shell
git log -n 1 --oneline -- $file
```

---

quality:
  type: score
  instructions: "How clean and maintainable is this code?"
  criteria:
    - "Unacceptable or messy"
    - "Adequate with minor issues"
    - "Exemplary and clean"

flag:
  type: noul
  instructions: "Does this file require immediate rework?"
  criteria:
    true: "Immediate rework required"
    false: "No immediate rework needed"
```

---

## 1. YAML Front Matter

The file begins with standard YAML front matter bounded by `---` lines.

```yaml
---
model: jev-latest
args:
  focus: "general quality"
  threshold: "strict"
---
```

### Fields

- `model` *(optional string)*: Specifies the judge model to invoke (e.g. `jev-latest`, `jev-1`). Defaults to `jev-latest` when omitted.
- `args` *(optional mapping)*: Key-value map defining default values for custom tokens referenced in the prompt body. These defaults can be overridden at invocation time using `-t key=value`.

---

## 2. Prompt Body

The prompt body is everything between the closing `---` of the front matter and the schema separator.

### Token Substitution

Tokens start with `$` followed by alphanumeric characters or underscores (e.g. `$file`, `$focus`).

#### Built-in Tokens
Built-in tokens are populated automatically from the `-f` flag inputs:

| Token | Single File Mode (`-f <file>`) | Batch Mode (`--batch`) |
|---|---|---|
| `$file` | Target file path (e.g. `src/cli.ts`) | Newline-separated list of all matched file paths |
| `$filename` | Base filename without directory (e.g. `cli.ts`) | **Error**: Forbidden in batch mode |
| `$content` | Full text content of the target file | Formatted sections with headings: `## <path>\n\n<content>` |

> **Note**: Built-in tokens cannot be overridden with `-t`.

#### Custom Tokens
Any token defined in the front matter `args` mapping or passed via `-t name=value` will be substituted globally throughout the body and tool blocks:
- Overriding: `-t focus="security"` overrides `args.focus`.
- Validation: In non-interactive environments, any `$token` left unresolved causes the run to halt with an error.

### Tool Blocks (Shell Fences)

A fenced code block tagged with `shell` inside the prompt body executes locally in bash before the prompt is sent to the judge:

````markdown
```shell
git diff HEAD~1 -- $file
```
````

#### Tool Block Rules
- Executed in a subprocess shell (`/bin/sh`) with current working directory set to the project root.
- Tokens (both built-in like `$file` and custom args) are substituted inside the tool block before execution.
- Standard output (`stdout`) replaces the code fence in-place in the final rendered prompt.
- Non-zero exit code or stderr halts the run with an error.
- **Change/Diff analysis pattern**: To judge changes rather than file contents, author an ask with zero `-f` dependencies and a tool block running `git diff` or `git show`:

````markdown
---
model: jev-latest
---

# Commit Review

Review the following git diff for regressions:

```shell
git diff HEAD~1 HEAD
```

---

severity:
  type: score
  instructions: "Risk level of the changes?"
  criteria:
    - "Low risk"
    - "Medium risk"
    - "High risk"
````

---

## 3. Schema Separator

The prompt body is separated from the questions schema by the **last standalone `---` line** outside of any code fences.
- Any `---` dividers inside fenced blocks (such as markdown examples) are ignored by the separator parser.
- Everything preceding the last `---` becomes the prompt body. Everything following the last `---` is parsed as the questions schema.

---

## 4. Questions Schema

The schema section is a YAML mapping of question identifiers to question configurations.

```yaml
---
<question_id>:
  type: <score | choice | noul>
  instructions: "<prompt instructions for this question>"
  criteria: <rubrics / options>
```

Supported question types:

### A. `score` Questions

Ordinal evaluations along an ordered scale of descriptions.

```yaml
severity:
  type: score
  instructions: "Assess problem severity in this component."
  criteria:
    - "Clean: No issues detected"
    - "Minor: Stylistic or minor maintainability concerns"
    - "Major: Serious design flaws or edge cases"
    - "Critical: Severe architectural or correctness defects"
```

- `type`: Must be `"score"`.
- `instructions`: Clear instruction for what is being evaluated.
- `criteria`: An array of at least 2 non-empty string descriptions, ordered from lowest (0) to highest (N-1).
- Result: An ordinal score representing where the evaluated input falls along the scale.

### B. `choice` Questions

Categorical selections from a predefined set of named options.

```yaml
category:
  type: choice
  instructions: "Primary classification of this module."
  criteria:
    ui: "User interface components and display templates"
    core: "Core domain logic and algorithms"
    infrastructure: "I/O, database access, networking, or CLI drivers"
    test: "Unit or integration test fixtures"
```

- `type`: Must be `"choice"`.
- `instructions`: Question instructions.
- `criteria`: A key-value mapping of option names to rubric descriptions (or `null` if the option label is self-explanatory).
- Result: Selected choice key and associated confidence.

### C. `noul` Questions

Binary / probabilistic true-or-false determinations.

```yaml
rework_needed:
  type: noul
  instructions: "Does this file need immediate refactoring?"
  criteria:
    true: "Significant technical debt warrants immediate attention"
    false: "Code meets repository standards"
```

- `type`: Must be `"noul"`.
- `instructions`: Binary decision instruction.
- `criteria` *(optional)*: Mapping containing optional `true` and/or `false` rubric descriptions.
- Result: Probability between 0.0 and 1.0 (displayed as pass/fail percentage).
