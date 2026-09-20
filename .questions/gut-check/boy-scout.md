---
description: "Boy Scout Rule check: visible neglect left in one file (markers, dead code, debris)"
model: jev-latest
---
Judge `{{filename}}` against the Boy Scout Rule: leave the code better than you
found it. This is judged from the file's visible hygiene only — evidence of care
vs neglect readable in the artifact itself (no git history).

Score each smell below 0 (absent) to 3 (severe) — the goal is a low score.

Smells:
- `orphan_todo_markers` — Unfinished-Work Marker: TODO/FIXME/HACK/XXX comments with no ticket, owner, or date, especially several or stale-looking ones.
- `commented_out_code` — Commented-Out Code: comments containing syntactically valid code (statements, function bodies, imports) instead of prose.
- `dead_code` — Dead Code: unreachable branches (`if (false)`, code after return), unused variables/functions/params left in place.
- `leftover_debug_logging` — Debug Debris: console.log/print/dbg!/dd calls, ad-hoc timers or dumps left on active paths.
- `copy_paste_debris` — Duplicated Code: near-identical blocks within the file differing only in a literal or name.
- `orphaned_imports` — Unused Import: requires/imports/usings referring to nothing used in the file.
- `style_seams` — Inconsistent Idiom: mixed indentation, quote style, naming convention, or error-handling pattern within one file, marking where un-scouted patches landed.

Not violations: a single dated/ticketed TODO is a legitimate way to defer work
(a warning at most); deliberate feature flags; intentional compatibility
shims.

The complete file:

{{content}}

```yaml
rework:
    type: noul
    instructions: "Does {{filename}} need rework per the Boy Scout Rule — do unowned TODO/FIXME/HACK markers, commented-out code, debug debris, dead code, or style seams remain in the file?"
    criteria:
      true: "Needs rework — visible neglect left in the file"
      false: "Passes — the file reads finished; everything executes or documents execution"
  orphan_todo_markers:
    type: score
    instructions: "Unfinished-Work Marker — TODO/FIXME/HACK/XXX comments with no ticket, owner, or date, especially several or stale-looking ones"
    criteria: &scale
      - "Absent — no instances in the file"
      - "Minor — a single dated/ticketed marker (a warning, not a failure)"
      - "Moderate — repeated instances, or one serious instance"
      - "Severe — pervasive; the file is defined by it"
  commented_out_code:
    type: score
    instructions: "Commented-Out Code — comments containing syntactically valid code (statements, function bodies, imports) instead of prose"
    criteria: *scale
  dead_code:
    type: score
    instructions: "Dead Code — unreachable branches (if (false), code after return), unused variables/functions/params left in place"
    criteria: *scale
  leftover_debug_logging:
    type: score
    instructions: "Debug Debris — console.log/print/dbg!/dd calls, ad-hoc timers or dumps left on active paths"
    criteria: *scale
  copy_paste_debris:
    type: score
    instructions: "Duplicated Code — near-identical blocks within the file differing only in a literal or name"
    criteria: *scale
  orphaned_imports:
    type: score
    instructions: "Unused Import — requires/imports/usings referring to nothing used in the file"
    criteria: *scale
  style_seams:
    type: score
    instructions: "Inconsistent Idiom — mixed indentation, quote style, naming convention, or error-handling pattern within one file, marking where un-scouted patches landed"
    criteria: *scale
```