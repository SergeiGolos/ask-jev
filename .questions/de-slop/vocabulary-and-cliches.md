---
description: "De-slop check: AI vocabulary clusters, copula avoidance, synonym cycling, and buzzwords"
model: jev-latest
schema:
  rework:
    type: noul
    instructions: "Does {{filename}} need rework to cut AI vocabulary — does it lean on recognizable LLM buzzwords, copula avoidance, or unnatural synonym cycling?"
    criteria:
      true: "Needs rework — unnatural AI vocabulary or cliché clusters dominate the text"
      false: "Passes — uses plain, direct, concrete language"
  ai_vocabulary_cluster:
    type: score
    direction: low
    instructions: "AI Vocabulary Clusters — recognizable LLM words: 'delve', 'tapestry', 'beacon', 'testament', 'underscore', 'pivotal', 'interplay', 'intricate', 'foster', 'garner', 'crucial', 'vibrant', 'realm'"
    criteria: &scale
      - "Absent — no AI vocabulary clusters"
      - "Minor — one or two isolated words used naturally in context"
      - "Moderate — several recurring AI words drawing attention to themselves"
      - "Severe — dense clustering; sentences read like statistical LLM regression"
  copula_avoidance:
    type: score
    direction: low
    instructions: "Copula Avoidance — refusing to write 'is', 'are', or 'has', replacing them with 'serves as', 'stands as', 'features', 'boasts', 'embodies', 'marks'"
    criteria: *scale
  synonym_cycling:
    type: score
    direction: low
    instructions: "Synonym Cycling / Elegant Variation — rotating through distinct synonyms for the same entity within one paragraph ('the protagonist', 'the central figure', 'the hero') to avoid repetition"
    criteria: *scale
  abstract_metaphors:
    type: score
    direction: low
    instructions: "Abstract Metaphor Nouns — corporate/AI jargon like 'substrate', 'wedge', 'vector', 'nexus', 'flywheel', 'paradigm', 'landscape', 'bedrock' used metaphorically instead of plain concrete terms"
    criteria: *scale
  false_ranges:
    type: score
    direction: low
    instructions: "False Ranges — 'from X to Y' formulations where X and Y do not lie on an actual continuum ('from algorithms to ecosystems', 'from healthcare to hope')"
    criteria: *scale
---
Judge `{{filename}}` against the plain-vocabulary standard: clear writing prefers
the simple, concrete word ("is", "has", "use", "help") over inflated Latinate
synonyms and statistical LLM favorites.

Score each smell below 0 (absent) to 3 (severe) — the goal is a low score.
`rework` is true when AI vocabulary clusters or unnatural synonyms distort the prose.

Smells:
- `ai_vocabulary_cluster` — Characteristic AI lexicon: "delve into", "rich tapestry",
  "testament to", "crucial role", "fostering", "garnering", "interplay", "intricate",
  "pivotal", "underscore", "vibrant", "showcase", "realm".
- `copula_avoidance` — Straining to avoid "is" or "has": writing "stands as a beacon",
  "serves as a vital hub", "features a wide range", "boasts state-of-the-art facilities"
  instead of plain "is" or "has".
- `synonym_cycling` — Elegant variation: mechanically alternating words for the same
  subject in adjacent sentences because an LLM penalty discourages token repetition.
- `abstract_metaphors` — Metaphor salad: "in the evolving landscape", "at the nexus of",
  "acting as a catalyst and flywheel", "the underlying substrate".
- `false_ranges` — Pseudo-spectra: "spanning everything from cutting-edge machine
  learning to human compassion" (connecting two disparate concepts on a fake axis).

Not violations: literal uses (e.g. an actual woven tapestry, an archaeological substrate,
musical underscore); single conventional idioms when surrounded by robust, natural prose.

The complete text:

{{content}}
