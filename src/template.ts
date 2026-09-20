/** Scaffold for `ask-jev new` — valid per the locked ask anatomy, renders without prompting. */
export function newAskTemplate(name: string): string {
  return `---
# One line naming the question this ask answers; ask-jev list shows it. Update it if you repurpose the ask.
description: "Review one file for general code quality"
# Judge model. Args are token defaults; -t name=value overrides them at run time.
model: jev-latest
args:
  focus: "general quality"
---

# Review request — ask '${name}'

(This whole body is the prompt sent to the judge; edit it freely.)

Review $filename with attention to $focus.

The complete file contents:

$content

<!-- Optional: add a tool block — a \`\`\`shell fence anywhere above runs before
     judging and its stdout is inlined right there. Built-in tokens are file,
     filename and content; your args work too. -->

---
# Judge questions. Types: score (ordered criteria, >=2 levels), choice (option: rubric), noul (true/false).
severity:
  type: score
  instructions: "How severe are the problems visible in the input?"
  criteria:
    - "No real problems"
    - "Minor problems worth noting"
    - "Serious problems that need fixing"
flag:
  type: noul
  instructions: "Should this input be reworked?"
  criteria:
    true: "Yes, rework needed"
    false: "Acceptable as is"
`;
}
