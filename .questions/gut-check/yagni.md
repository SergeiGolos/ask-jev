---
description: "YAGNI check: speculative code with no current use in one file"
model: jev-latest
schema:
  rework:
    type: noul
    instructions: "Does {{filename}} need rework to meet YAGNI — can you point to any declaration whose removal would leave the file's observable behavior unchanged (beyond declared framework/test-hook exceptions)?"
    criteria:
      true: "Needs rework — speculative members exist solely for an imagined future"
      false: "Passes — everything in the file is exercised by a current code path"
  unused_export:
    type: score
    instructions: "Unused Export — an exported class/function/constant that no code in the file references, exported on spec for callers that don't exist yet"
    criteria: &scale
      - "Absent — no instances in the file"
      - "Minor — one or two isolated instances with limited impact"
      - "Moderate — repeated instances, or one serious instance"
      - "Severe — pervasive; the file is defined by it"
  unused_parameter:
    type: score
    instructions: "Unused Parameter — a signature parameter never read in the body, typically kept 'so callers can pass it later'"
    criteria: *scale
  one_impl_interface:
    type: score
    instructions: "One-Implementation Interface — an interface/abstract class whose sole implementer is in the same file, built purely as a flexibility point"
    criteria: *scale
  dead_code:
    type: score
    instructions: "Dead Code — commented-out code, statements after a return/throw, or branches guarded by conditions that can never be true"
    criteria: *scale
  placeholder_stub:
    type: score
    instructions: "Placeholder Stub — a method body that throws NotImplemented, returns null/empty, or carries a TODO because the real feature is 'for later'"
    criteria: *scale
  future_tense_marker:
    type: score
    instructions: "Future-Tense Marker — identifiers or comments saying 'future', 'will support', 'eventually', 'reserved for' advertising capability no current code path uses"
    criteria: *scale
  speculative_wrapper:
    type: score
    instructions: "Speculative Wrapper — a class or function that only forwards to another member without adding behavior; delegation awaiting an imagined abstraction"
    criteria: *scale
  config_for_later:
    type: score
    instructions: "Config For Later — an options object, flag, or knob with exactly one value ever supplied, parameterized against a future that hasn't arrived"
    criteria: *scale
---
Judge `{{filename}}` against YAGNI: always implement things when you actually
need them, never when you merely foresee the need — even total certainty about
the future doesn't justify building now. The question per declaration: does any
code path visible in this file exercise it?

Score each smell below 0 (absent) to 3 (severe) — the goal is a low score.

Smells:
- `unused_export` — Unused Export: an exported class/function/constant that no code in the file references, exported on spec for callers that don't exist yet.
- `unused_parameter` — Unused Parameter: a signature parameter never read in the body, typically kept "so callers can pass it later".
- `one_impl_interface` — One-Implementation Interface: an interface/abstract class whose sole implementer is in the same file, built purely as a flexibility point.
- `dead_code` — Dead Code: commented-out code, statements after a return/throw, or branches guarded by conditions that can never be true.
- `placeholder_stub` — Placeholder Stub: a method body that throws NotImplemented, returns null/empty, or carries a TODO because the real feature is "for later".
- `future_tense_marker` — Future-Tense Marker: identifiers or comments saying "future", "will support", "eventually", "reserved for" that advertise capability no current code path uses.
- `speculative_wrapper` — Speculative Wrapper: a class or function that only forwards to another member without adding behavior — delegation awaiting an imagined abstraction.
- `config_for_later` — Config For Later: an options object, flag, or knob with exactly one value ever supplied, parameterized against a future that hasn't arrived.

Not violations: framework APIs whose consumers live outside the file; elements
referenced only by tests; signatures fixed by an interface/override being
implemented — note these, don't count them.

The complete file:

{{content}}
