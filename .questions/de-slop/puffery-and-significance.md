---
description: "De-slop check: puffery, false grandeur, superficial analysis, and unearned significance"
model: jev-latest
schema:
  rework:
    type: noul
    instructions: "Does {{filename}} need rework to remove puffery — does it rely on unearned grandeur, superficial participial analysis, or weasel claims of significance?"
    criteria:
      true: "Needs rework — inflated importance or superficial analysis undermines credibility"
      false: "Passes — claims are grounded, specific, and let facts convey significance"
  false_grandeur:
    type: score
    direction: low
    instructions: "False Grandeur / Puffery — inflating mundane topics with monumental phrasing ('pivotal moment', 'enduring legacy', 'testament to', 'transformative power', 'rich tapestry')"
    criteria: &scale
      - "Absent — no instances in the text"
      - "Minor — one or two isolated phrases"
      - "Moderate — repeated instances of unearned gravitas"
      - "Severe — pervasive; the text reads like breathless promotional copy"
  trailing_ing_analysis:
    type: score
    direction: low
    instructions: "Trailing -ing Analysis — tacking superficial present-participle clauses onto sentences ('highlighting...', 'underscoring...', 'fostering...', 'reflecting...', 'ensuring...')"
    criteria: *scale
  weasel_attributions:
    type: score
    direction: low
    instructions: "Vague Authority & Weasel Words — attributing opinions to faceless consensus ('experts believe', 'industry observers suggest', 'critics argue', 'widely seen as')"
    criteria: *scale
  canned_notability:
    type: score
    direction: low
    instructions: "Canned Notability & Media Hype — hitting the reader over the head with lists of media outlets or claims of 'active presence' rather than describing what occurred"
    criteria: *scale
  promotional_adjectives:
    type: score
    direction: low
    instructions: "Promotional Adjectives — travel-brochure or PR language ('nestled', 'vibrant', 'breathtaking', 'groundbreaking', 'renowned', 'stunning')"
    criteria: *scale
---
Judge `{{filename}}` against the puffery standard: good prose earns its impact
through concrete facts, specifics, and clear nouns/verbs. AI slop constantly
tells the reader how important, historic, or vibrant something is instead of
showing what happened.

Score each smell below 0 (absent) to 3 (severe) — the goal is a low score.
`rework` is true when puffery and superficial significance dilute the writing.

Smells:
- `false_grandeur` — Unearned importance: framing routine steps as "a pivotal
  moment", "an enduring testament", "shaping the evolving landscape", or "a
  rich tapestry of history".
- `trailing_ing_analysis` — Superficial participial tags: attaching ", highlighting
  the crucial importance of...", ", underscoring the deep commitment to...", or
  ", fostering greater collaboration" to the tail of ordinary declarative sentences.
- `weasel_attributions` — Vague authorities: invoking "observers note", "industry
  experts agree", "scholars have long debated" without citing a specific person,
  paper, or institution.
- `canned_notability` — Hype checklists: cataloging where an entity was featured
  ("covered by CNN, Wired, and other prominent outlets") or claiming it "maintains
  a vibrant digital presence" instead of presenting substance.
- `promotional_adjectives` — Travel-brochure fluff: "nestled in the heart of",
  "a vibrant hub", "groundbreaking initiatives", "breathtaking views".

Not violations: direct quotes containing promotional language; genuinely historic
events described with accurate, sourced magnitude; legitimate media citations with
substantive context.

The complete text:

{{content}}
