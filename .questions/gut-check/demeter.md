---
description: "Law of Demeter check: chained navigation through other objects' internals"
model: jev-latest
schema:
  rework:
    type: noul
    instructions: "Does {{filename}} need rework to meet the Law of Demeter — does any method navigate 2+ getter hops through domain objects' internals (beyond recognized exemptions like fluent builders, collections, and value-object returns)?"
    criteria:
      true: "Needs rework — methods reach through collaborators' internals"
      false: "Passes — methods talk only to immediate friends; all multi-dot expressions are recognized exemptions"
  train_wreck:
    type: score
    direction: low
    instructions: "Message Chains — an expression navigates 3+ dots through domain getters/actions, e.g. a.getB().getC().doIt()"
    criteria: &scale
      - "Absent — no instances in the file"
      - "Minor — one or two isolated instances with limited impact"
      - "Moderate — repeated instances, or one serious instance"
      - "Severe — pervasive; the file is defined by it"
  stranger_call:
    type: score
    direction: low
    instructions: "Reaching Through — a method invokes a method on an object obtained by calling a getter on a parameter/field/local it didn't create"
    criteria: *scale
  repeated_navigation:
    type: score
    direction: low
    instructions: "Duplicated Path — the same traversal (x.getA().getB()...) spelled out two or more times, so a structure change edits many lines"
    criteria: *scale
  null_guarded_chain:
    type: score
    direction: low
    instructions: "Structural Dependence — a null/optional check or try/catch guards a mid-chain link, proving the caller knows the whole path's shape"
    criteria: *scale
  temp_hop_disguise:
    type: score
    direction: low
    instructions: "Laundered Chain — the chain is chopped into sequential temporaries where each temp is used exactly once to fetch the next object; coupling unchanged, only cosmetically split"
    criteria: *scale
  feature_envy:
    type: score
    direction: low
    instructions: "Envious Method — most of a method's statements operate on data pulled from another object's getters rather than its own state"
    criteria: *scale
  middle_man_bloat:
    type: score
    direction: low
    instructions: "Over-Delegation — the class is dominated by one-line pass-through methods that merely forward to a single wrapped object, added to dodge chains"
    criteria: *scale
---
Judge `{{filename}}` against the Law of Demeter (principle of least knowledge): a
method should only invoke methods of itself, its fields, its parameters, and
objects it creates — "use only one dot". Reaching through `b` to reach `c`
couples the caller to `b`'s internal structure.

Score each smell below 0 (absent) to 3 (severe) — the goal is a low score.

Smells:
- `train_wreck` — Message Chains: an expression navigates 3+ dots through domain getters/actions, e.g. `a.getB().getC().doIt()`.
- `stranger_call` — Reaching Through: a method invokes a method on an object obtained by calling a getter on a parameter/field/local it didn't create.
- `repeated_navigation` — Duplicated Path: the same traversal (`x.getA().getB()...`) spelled out two or more times in the file.
- `null_guarded_chain` — Structural Dependence: a null/optional check or try/catch guards a mid-chain link, proving the caller knows the whole path's shape.
- `temp_hop_disguise` — Laundered Chain: the chain chopped into sequential temporaries, each used exactly once to fetch the next object — coupling unchanged, only cosmetically split.
- `feature_envy` — Envious Method: most of a method's statements operate on data pulled from another object's getters rather than its own state.
- `middle_man_bloat` — Over-Delegation: one-line pass-through methods dominating the class, forwarding to a single wrapped object just to dodge chains.

Not violations (chains that ARE the API): fluent builders/internal DSLs;
collection/array/map traversal; value-object transforms (`s.trim().upper()`);
freshly created objects; results only returned or passed as arguments.

The complete file:

{{content}}
