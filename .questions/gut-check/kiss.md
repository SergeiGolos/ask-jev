---
description: "KISS check: accidental complexity, cleverness, and over-engineering in one file"
model: jev-latest
schema:
  rework:
    type: noul
    instructions: "Does {{filename}} need rework to meet the KISS standard — is the same behavior expressible with visibly less code, nesting, or indirection, or does an optimization or clever trick lack measured justification?"
    criteria:
      true: "Needs rework — accidental complexity exceeds what the problem demands"
      false: "Passes — every construct earns its place; complexity tracks the problem's essential complexity"
  long_method:
    type: score
    direction: low
    instructions: "Long Method — one function spans many lines, mixes several jobs, and cannot be summarized in a single sentence"
    criteria: &scale
      - "Absent — no instances in the file"
      - "Minor — one or two isolated instances with limited impact"
      - "Moderate — repeated instances, or one serious instance"
      - "Severe — pervasive; the file is defined by it"
  deep_nesting:
    type: score
    direction: low
    instructions: "Arrow Anti-Pattern — if/else/for/try blocks indented 4+ levels into an arrow shape instead of guard clauses or early returns"
    criteria: *scale
  needless_indirection:
    type: score
    direction: low
    instructions: "Middle Man / Indirection Layer — pass-through wrappers, single-implementation interfaces, or factory chains that forward calls without adding behavior"
    criteria: *scale
  speculative_generality:
    type: score
    direction: low
    instructions: "Speculative Generality — unused type parameters, config flags, extension points, or 'just in case' flexibility serving no current requirement"
    criteria: *scale
  premature_optimization:
    type: score
    direction: low
    instructions: "Premature Optimization — manual caching, bit tricks, unrolled loops, or hand-rolled fast paths with no measured need, sacrificing clarity"
    criteria: *scale
  obfuscated_cleverness:
    type: score
    direction: low
    instructions: "Clever Code — chained ternaries, XOR swap, implicit coercion, or operator abuse a reader must mentally execute to decode"
    criteria: *scale
  long_parameter_list:
    type: score
    direction: low
    instructions: "Long Parameter List — functions taking 5+ arguments (especially boolean flags) that an object or restructuring would collapse"
    criteria: *scale
  comment_deodorant:
    type: score
    direction: low
    instructions: "Comment As Deodorant — comments like 'hack', 'don't touch', 'works because...' apologizing for convoluted code instead of the code being clear"
    criteria: *scale
---
Judge `{{filename}}` against KISS: a file should contain only the complexity the
problem demands. Essential complexity (inherent to the problem) is fine;
accidental complexity (self-inflicted via tools, cleverness, or speculative
design) is the violation. The bar is not "short" but "nothing a reader must
decode that the problem didn't force".

Score each smell below 0 (absent) to 3 (severe) — the goal is a low score.
`rework` is true when accidental complexity outruns the problem.

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
