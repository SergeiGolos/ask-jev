---
description: "Per-file SOLID-adherence review with a rework flag"
model: jev-latest
args:
  focus: "SOLID adherence"
---
Review the source file `$filename` for adherence to the SOLID principles (Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion).

The complete file:

$content

```schema
overall:
  type: score
  instructions: "Overall, how strongly does the file adhere to the SOLID principles? Judge only evidence visible in the file."
  criteria:
    - "Blatant violations across several principles; untestable and risky to change"
    - "Serious violations in multiple principles"
    - "Mixed: partial adherence, clear violations remain"
    - "Mostly adherent; only minor violations"
    - "Exemplary adherence without over-engineering"
flag:
  type: noul
  instructions: "Would a senior reviewer flag this file for refactoring primarily because of design (SOLID) issues?"
  criteria:
    true: "Yes — design issues alone warrant a refactor"
    false: "No — the design is acceptable"
```
