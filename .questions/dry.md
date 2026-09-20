---
description: "DRY check: duplication, magic literals, and wrong abstractions in one file"
model: jev-latest
schema:
  rework:
    type: noul
    instructions: "Does {{filename}} need rework to meet the DRY standard — do two blocks differ only in swapped literals or identifiers, does an unnamed meaningful literal appear three or more times, or does a helper need conditionals to serve its callers?"
    criteria:
      true: "Needs rework — knowledge is duplicated or the abstraction is wrong"
      false: "Passes — every piece of knowledge has a single authoritative representation"
  clone_and_modify_block:
    type: score
    instructions: "Clone-and-Modify — two nearby blocks are token-identical except for a handful of swapped values"
    criteria: &scale
      - "Absent — no instances in the file"
      - "Minor — one or two isolated instances with limited impact"
      - "Moderate — repeated instances, or one serious instance"
      - "Severe — pervasive; the file is defined by it"
  near_miss_clone:
    type: score
    instructions: "Type-3 Clone — repeated statement skeleton with a few statements added/removed or identifiers renamed between copies"
    criteria: *scale
  copy_paste_function:
    type: score
    instructions: "Duplicated Code — two functions in the file with essentially the same body, one carrying a small tweak"
    criteria: *scale
  magic_number:
    type: score
    instructions: "Magic Number — a bare literal with domain meaning embedded in expressions with no named constant"
    criteria: *scale
  repeated_literal:
    type: score
    instructions: "Repeated Literal — the same non-obvious string or number literal occurs three or more times in the file"
    criteria: *scale
  redundant_helper:
    type: score
    instructions: "Redundant Helper — two or more local helpers under different names that perform the same transformation with only trivial differences"
    criteria: *scale
  divergent_clone:
    type: score
    instructions: "Divergent Clone — one copy of a duplicated block carries a guard or fix its twin lacks; the twins encode one knowledge that already drifted"
    criteria: *scale
  wrong_abstraction_conditional:
    type: score
    instructions: "Wrong Abstraction — a 'shared' helper takes flags/parameters only to branch into caller-specific paths"
    criteria: *scale
---
Judge `{{filename}}` against DRY: every piece of knowledge must have a single,
unambiguous, authoritative representation within a system (Hunt & Thomas).
DRY targets knowledge/intent, not text — two similar-looking pieces that would
change for different reasons are not a violation.

Score each smell below 0 (absent) to 3 (severe) — the goal is a low score.

Smells:
- `clone_and_modify_block` — Clone-and-Modify: two nearby blocks are token-identical except for a handful of swapped values.
- `near_miss_clone` — Type-3 clone: repeated statement skeleton with a few statements added/removed or identifiers renamed between copies.
- `copy_paste_function` — Duplicated Code: two functions in the file with essentially the same body, one carrying a small tweak.
- `magic_number` — Magic Number: a bare literal with domain meaning embedded in expressions (e.g. `mass * height * 9.81`) with no named constant.
- `repeated_literal` — Repeated Literal: the same non-obvious string or number literal occurs three or more times in the file.
- `redundant_helper` — Redundant Helper: two or more local helpers under different names that perform the same transformation with only trivial differences.
- `divergent_clone` — Divergent Clone: one copy of a duplicated block carries a guard or fix its twin lacks — the twins encode one knowledge that already drifted.
- `wrong_abstraction_conditional` — Wrong Abstraction: a "shared" helper takes flags/parameters only to branch into caller-specific paths.

Not violations: shared idiom (loop headers, guard clauses); obvious literals
(loop index 0, `count - 1`); duplication that is cheaper than the wrong
abstraction — merging it with caller-specific conditionals is itself a smell.

The complete file:

{{content}}
