# CONTEXT

Glossary only — no implementation details.

## Ask
A named, hand-authored question configuration: a markdown file `<name>.md` living in a `.questions` folder. Executing one is an **ask run**.

## Ask name
The ask's filename without the `.md` extension. `ask-jev <ask name>` invokes it.

## Profile ask / Folder ask
Profile ask: lives in `~/.questions`. Folder ask: lives in the `.questions` folder of the directory being analyzed. A folder ask shadows a profile ask of the same name.

## Prompt body
The markdown between the front matter and the schema separator. It becomes the question sent to the judge, verbatim after substitution.

## Token
A `$`-prefixed placeholder (`$file`, `$filename`, `$content`, or custom) substituted throughout an ask before judging.

## Tool block
A ```shell fenced block inside the prompt body. It executes before judging and its output renders in place.

## Schema
The YAML questions definition after the last `---` separator; tells the judge how to score.

## Batch mode
One ask run covering all `-f` inputs in a single judge call, instead of one call per file.

## Run
One CLI invocation over its inputs, recorded as a directory under the project's `.questions/history/` named by its run ID.

## Run ID
A UUIDv7 generated per run; sorts by creation time.

## Pair
The request/response record for one judged file within a run: the rendered request markdown (schema section included) plus the full JSON response.

## Report
The HTML view of a run's pairs, each expandable through three view levels: result, extended (composition), verbose (console output).

## Trend matrix
The tabular view mapping questions (rows) against chronological runs (columns) for an inspected file or directory, displaying scores, choices, and temporal deltas.

## Trend server
The local HTTP service (`ask-jev serve`) providing the trend matrix UI and query endpoints over history.
