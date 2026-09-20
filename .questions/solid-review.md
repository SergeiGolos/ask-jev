---
description: "Per-file SOLID review: one pass/fail flag plus a violation score per principle"
model: jev-latest
schema:
  rework:
    type: noul
    instructions: "Does {{filename}} need refactoring primarily because of SOLID violations — is any principle clearly violated, or are two or more principle smells present?"
    criteria:
      true: "Needs rework — a SOLID violation warrants it"
      false: "Passes — no principle violation warrants a rework"
  srp_violations:
    type: score
    instructions: "God Class — one class/module juggles several unrelated concerns (parse + persist + HTTP + format) whose helper methods form distinct clusters; multiple reasons to change in one file"
    criteria: &scale
      - "Absent — no instances in the file"
      - "Minor — one or two isolated instances with limited impact"
      - "Moderate — repeated instances, or one serious instance"
      - "Severe — pervasive; the file is defined by it"
  ocp_violations:
    type: score
    instructions: "Switch-on-Type / Conditional Cascade — core logic dispatches on a type-code/kind enum via switch or if-else chains, so adding a variant requires editing this dispatch instead of adding a type"
    criteria: *scale
  lsp_violations:
    type: score
    instructions: "Broken Substitutability — subclass methods throw NotImplementedError/UnsupportedOperationException, return dummies, or callers guard base-type use with instanceof/type checks"
    criteria: *scale
  isp_violations:
    type: score
    instructions: "Fat Interface — one wide interface/protocol whose implementers leave some methods empty bodies, pass, or throw, forcing unused methods on heterogeneous clients"
    criteria: *scale
  dip_violations:
    type: score
    instructions: "Hardwired Dependencies — high-level logic news up concrete DB/HTTP/config/clock objects inline with no injection seam, so the unit cannot be tested without real services"
    criteria: *scale
---
Judge `{{filename}}` against SOLID as five single-file checks:
- SRP: a unit has one reason to change.
- OCP: open for extension, closed for modification — new variants arrive as new types behind a stable interface, not edits to dispatch code.
- LSP: subtypes are usable through base references without breaking caller expectations (preconditions not strengthened, postconditions not weakened).
- ISP: clients are not forced to depend on methods they don't use.
- DIP: high-level policy depends on abstractions; concrete construction and I/O enter through constructor/parameter seams at the edges.

Score each principle's violations below 0 (absent) to 3 (severe) — the goal is
a low score. Judge only evidence visible in the file.

Smells:
- `srp_violations` — God Class: one class/module juggles several unrelated concerns whose helper methods form distinct clusters — multiple reasons to change in one file.
- `ocp_violations` — Switch-on-Type: core logic dispatches on a type-code/kind enum via switch or if-else chains; extension requires editing the dispatch.
- `lsp_violations` — Broken Substitutability: NotImplementedError stubs, dummy returns from overridden methods, or instanceof/type guards before base-type use.
- `isp_violations` — Fat Interface: a wide interface whose implementers leave methods empty/passing/throwing, forcing unused methods on clients.
- `dip_violations` — Hardwired Dependencies: concrete DB/HTTP/config/clock objects created inline in high-level logic, no injection seam, untestable without real services.

Not violations: dispatch that genuinely models data-shape differences with
exhaustive handling at a single boundary; injecting an injected factory;
interfaces fixed by an external framework contract.

The complete file:

{{content}}
