---
description: "Single-Minded Functions check: functions doing exactly one thing at one abstraction level"
model: jev-latest
schema:
  rework:
    type: noul
    instructions: "Does {{filename}} need rework per the single-minded-functions standard — does any function visibly carry two responsibilities (flag argument, sectioned body, 'and' name, long multi-step body) or hide a side effect its name doesn't state?"
    criteria:
      true: "Needs rework — some function does more than one thing"
      false: "Passes — every function is small, single-level, and single-effect"
  long_function:
    type: score
    direction: low
    instructions: "Long Method — function body runs well past ~20-30 lines or one screen, so its steps can't be grasped at a glance"
    criteria: &scale
      - "Absent — no instances in the file"
      - "Minor — one or two isolated instances with limited impact"
      - "Moderate — repeated instances, or one serious instance"
      - "Severe — pervasive; the file is defined by it"
  flag_argument:
    type: score
    direction: low
    instructions: "Flag Argument — boolean parameter whose value picks different branches inside the function body (if (isDraft) ... else ...)"
    criteria: *scale
  hidden_side_effect:
    type: score
    direction: low
    instructions: "Hidden Side Effect — function named as a query also mutates module/global state, a parameter, or performs I/O the name doesn't mention"
    criteria: *scale
  mixed_abstraction_levels:
    type: score
    direction: low
    instructions: "Mixed Abstraction Levels (SLAP violation) — high-level step calls sit between raw string slicing, index arithmetic, or formatting detail in the same body"
    criteria: *scale
  sectioned_function:
    type: score
    direction: low
    instructions: "Sectioned Function — body divided by blank lines or comment banners (// step 1, // now validate) each naming a distinct task"
    criteria: *scale
  deep_nesting:
    type: score
    direction: low
    instructions: "Deep Nesting / Arrow Code — 4+ indentation levels or a pyramid of if/for/try with the happy path buried mid-function"
    criteria: *scale
  command_query_mix:
    type: score
    direction: low
    instructions: "Command-Query Mixing — one function both returns a value and changes state, so callers can't tell which it does"
    criteria: *scale
  and_named_function:
    type: score
    direction: low
    instructions: "'And' Name — identifier like loadAndSaveUser naming two responsibilities in a single function"
    criteria: *scale
---
Judge `{{filename}}` against "functions should do one thing": a function is
small (a few lines, one screen), its statements sit at a single level of
abstraction, and its name fully describes its single observable effect. If you
can extract a section or a second verb from it, it does more than one thing.

Score each smell below 0 (absent) to 3 (severe) — the goal is a low score.

Smells:
- `long_function` — Long Method: function body runs well past ~20-30 lines or one screen, so its steps can't be grasped at a glance.
- `flag_argument` — Flag Argument: boolean parameter whose value picks different branches inside the function body (`if (isDraft) ... else ...`).
- `hidden_side_effect` — Hidden Side Effect: function named as a query also mutates module/global state, a parameter, or performs I/O the name doesn't mention.
- `mixed_abstraction_levels` — Mixed Abstraction Levels (SLAP violation): high-level step calls sit between raw string slicing, index arithmetic, or formatting detail in the same body.
- `sectioned_function` — Sectioned Function: body divided by blank lines or comment banners (`// step 1`, `// now validate`) each naming a distinct task.
- `deep_nesting` — Deep Nesting / Arrow Code: 4+ indentation levels or a pyramid of `if`/`for`/`try` with the happy path buried mid-function.
- `command_query_mix` — Command-Query Mixing: one function both returns a value and changes state, so callers can't tell which it does.
- `and_named_function` — "And" Name: identifier like `loadAndSaveUser` naming two responsibilities in a single function.

Not violations: a single top-level try/finally wrapping a linear flow;
conventional accessors whose caching is invisible to callers.

The complete file:

{{content}}
