---
description: "Tell Don't Ask check: state pulled out of objects and decided externally"
model: jev-latest
schema:
  rework:
    type: noul
    instructions: "Does {{filename}} need rework to meet Tell, Don't Ask — is an object's state decided externally via accessor reads followed by mutations on that same object, or does a query-named method have side effects?"
    criteria:
      true: "Needs rework — behavior doesn't live with the data it governs"
      false: "Passes — objects are told what to do; queries are side-effect-free"
  anemic_domain_model:
    type: score
    direction: low
    instructions: "Anemic Domain Model — a domain-noun type (Order, Account, Invoice...) holds nothing but fields and accessors while sibling functions in the same file make all the rule decisions about that state"
    criteria: &scale
      - "Absent — no instances in the file"
      - "Minor — one or two isolated instances with limited impact"
      - "Moderate — repeated instances, or one serious instance"
      - "Severe — pervasive; the file is defined by it"
  data_class:
    type: score
    direction: low
    instructions: "Data Class — a type exposes essentially every field through symmetric public getter/setter pairs and offers no other behavior"
    criteria: *scale
  feature_envy:
    type: score
    direction: low
    instructions: "Feature Envy — within one method, accesses of a collaborator's data clearly outnumber uses of the method's own object's state"
    criteria: *scale
  train_wreck:
    type: score
    direction: low
    instructions: "Message Chains — an expression navigates multiple accessor hops (a.getB().getC().getD()) to fetch data for a decision made right there"
    criteria: *scale
  ask_then_mutate:
    type: score
    direction: low
    instructions: "Ask-Then-Mutate — a function reads a value/flag from an object, branches on it, then calls that same object's setter/command with the outcome; a check-and-act that should be one command inside the object"
    criteria: *scale
  temporal_coupling:
    type: score
    direction: low
    instructions: "Temporal Coupling — correctness depends on the caller invoking methods in one specific order (check/validate/isReady before act/apply/commit) with nothing enforcing that order"
    criteria: *scale
  cqs_violation:
    type: score
    direction: low
    instructions: "Command-Query Separation Violation — a query-named method (get..., is..., find..., calculate...) mutates state, or a state-changing method returns a value callers rely on (benign pop-and-return or caching idioms exempt)"
    criteria: *scale
---
Judge `{{filename}}` against Tell, Don't Ask: objects should be told what to do,
not interrogated for their state so outside code can decide for them. Behavior
lives with the data it governs; queries are side-effect-free; asking for state,
deciding outside, then pushing the result back is "a fertile breeding ground
for bugs".

Score each smell below 0 (absent) to 3 (severe) — the goal is a low score.

Smells:
- `anemic_domain_model` — Anemic Domain Model: a domain-noun type (Order, Account, Invoice...) holds nothing but fields and accessors while sibling functions in the same file make all the rule decisions about that state.
- `data_class` — Data Class: a type exposes essentially every field through symmetric public getter/setter pairs and offers no other behavior.
- `feature_envy` — Feature Envy: within one method, accesses of a collaborator's data (`other.getX()`, `other.getY()`) clearly outnumber uses of the method's own object's state.
- `train_wreck` — Message Chains: an expression navigates multiple accessor hops (`a.getB().getC().getD()`) to fetch data for a decision made right there in the file.
- `ask_then_mutate` — Ask-Then-Mutate: a function reads a value/flag from an object, branches on it, then calls that same object's setter/command with the outcome — a check-and-act that should be one command inside the object.
- `temporal_coupling` — Temporal Coupling: correctness depends on the caller invoking methods in one specific order (check/validate/isReady before act/apply/commit) with nothing in the type enforcing that order.
- `cqs_violation` — CQS Violation: a query-named method (`get...`, `is...`, `find...`, `calculate...`) mutates state, or a state-changing method returns a value callers rely on (benign pop-and-return or caching idioms exempt).

Not violations: behavior-free data carriers (DTOs/records/wire formats) at
layer boundaries; pure queries used as legitimate collaboration.

The complete file:

{{content}}
