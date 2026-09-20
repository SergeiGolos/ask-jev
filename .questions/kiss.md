---
description: "KISS check: accidental complexity, cleverness, and over-engineering in one file"
model: jev-latest
schema:
  pass:
    type: noul
    instructions: "Does {{filename}} pass the KISS standard: every construct earns its place, complexity tracks the problem's essential complexity, nesting stays shallow, no speculative flexibility or unmeasured cleverness?"
    criteria:
      true: "Passes — nothing a reader must decode that the problem didn't force"
      false: "Fails — the same behavior is expressible with visibly less code, nesting, or indirection"
  long_method:
    type: score
    instructions: "Long Method — one function spans many lines, mixes several jobs, and cannot be summarized in a single sentence"
    criteria: &scale
      - "Absent — no instances in the file"
      - "Minor — one or two isolated instances with limited impact"
      - "Moderate — repeated instances, or one serious instance"
      - "Severe — pervasive; the file is defined by it"
  deep_nesting:
    type: score
    instructions: "Arrow Anti-Pattern — if/else/for/try blocks indented 4+ levels into an arrow shape instead of guard clauses or early returns"
    criteria: *scale
  needless_indirection:
    type: score
    instructions: "Middle Man / Indirection Layer — pass-through wrappers, single-implementation interfaces, or factory chains that forward calls without adding behavior"
    criteria: *scale
  speculative_generality:
    type: score
    instructions: "Speculative Generality — unused type parameters, config flags, extension points, or 'just in case' flexibility serving no current requirement"
    criteria: *scale
  premature_optimization:
    type: score
    instructions: "Premature Optimization — manual caching, bit tricks, unrolled loops, or hand-rolled fast paths with no measured need, sacrificing clarity"
    criteria: *scale
  obfuscated_cleverness:
    type: score
    instructions: "Clever Code — chained ternaries, XOR swap, implicit coercion, or operator abuse a reader must mentally execute to decode"
    criteria: *scale
  long_parameter_list:
    type: score
    instructions: "Long Parameter List — functions taking 5+ arguments (especially boolean flags) that an object or restructuring would collapse"
    criteria: *scale
  comment_deodorant:
    type: score
    instructions: "Comment As Deodorant — comments like 'hack', 'don't touch', 'works because...' apologizing for convoluted code instead of the code being clear"
    criteria: *scale
---
Judge `{{filename}}` against KISS: a file should contain only the complexity the
problem demands. Essential complexity (inherent to the problem) is fine;
accidental complexity (self-inflicted via tools, cleverness, or speculative
design) is the violation. The bar is not "short" but "nothing a reader must
decode that the problem didn't force".

Score each smell below 0 (absent) to 3 (severe) — the goal is a low score.
`pass` is true only when every construct earns its place.

Smells:
- `long_method` — Long Method: one function spans many lines / mixes several jobs and cannot be summarized in a single sentence.
- `deep_nesting` — Arrow Anti-Pattern: if/else/for/try blocks indented 4+ levels into an "arrow" shape instead of guard clauses or early returns.
- `needless_indirection` — Middle Man / Indirection Layer: pass-through wrappers, single-implementation interfaces, or factory chains that forward calls without adding behavior.
- `speculative_generality` — Speculative Generality: unused type parameters, config flags, extension points, or "just in case" flexibility serving no current requirement.
- `premature_optimization` — Premature Optimization: manual caching, bit tricks, unrolled loops, or hand-rolled fast paths with no measured need, sacrificing clarity.
- `obfuscated_cleverness` — Clever Code: chained ternaries, XOR swap, implicit coercion, or operator abuse a reader must mentally execute to decode.
- `long_parameter_list` — Long Parameter List: functions taking 5+ arguments (especially boolean flags) that an object or restructuring would collapse.
- `comment_deodorant` — Comment As Deodorant: comments like "hack", "don't touch", "works because..." apologizing for convoluted code instead of the code being clear.

Not violations: essential complexity the problem genuinely demands; measured
optimization of a demonstrated hot path.

The complete file:

{{content}}
