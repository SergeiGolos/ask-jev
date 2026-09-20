---
description: "Set-level SOLID-adherence verdict across many files in one judge call"
model: jev-latest
---
Review these source files as a set for SOLID adherence (Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion).

Files:

$file

Contents:

$content

---
overall:
  type: score
  instructions: "Overall, how strongly does this set of files adhere to the SOLID principles? Judge only evidence visible in the files."
  criteria:
    - "Blatant violations across several principles; untestable and risky to change"
    - "Serious violations in multiple principles"
    - "Mixed: partial adherence, clear violations remain"
    - "Mostly adherent; only minor violations"
    - "Exemplary adherence without over-engineering"
