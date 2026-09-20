---
description: "De-slop check: mechanical listicles, em-dash crutches, negative parallelisms, and rule-of-three"
model: jev-latest
schema:
  rework:
    type: noul
    instructions: "Does {{filename}} need structural rework — does it rely on mechanical listicles, inline-header crutches, excessive em dashes, or rigid parallelisms?"
    criteria:
      true: "Needs rework — formulaic formatting and structural mannerisms displace natural prose flow"
      false: "Passes — natural sentence variety, fluid transitions, and organic structure"
  inline_header_lists:
    type: score
    direction: low
    instructions: "Inline-Header Vertical Lists — vertical bullet lists formatted with a bold label followed by a colon and description ('**Category:** Description...'), especially when restating the line"
    criteria: &scale
      - "Absent — natural prose or organically structured text"
      - "Minor — one isolated bullet list where a list is genuinely appropriate"
      - "Moderate — prose broken up unnecessarily into formulaic bold-prefix bullet points"
      - "Severe — pervasive; the document is essentially a listicle masquerading as prose"
  em_dash_overuse:
    type: score
    direction: low
    instructions: "Em Dash Overuse — using '—' as a universal punctuation crutch for dramatic pause, emphasis, or parenthetical aside instead of periods, commas, or natural syntax"
    criteria: *scale
  negative_parallelism:
    type: score
    direction: low
    instructions: "Negative Parallelism — formulaic contrast constructions: 'It is not just X, but also Y', 'Not X, but Y', 'Rather than X, it is Y', 'No A, no B, just C'"
    criteria: *scale
  rule_of_three:
    type: score
    direction: low
    instructions: "Rule of Three — compulsively grouping adjectives, nouns, or clauses into triplets ('dynamic, vibrant, and transformative') to sound authoritative"
    criteria: *scale
  rhythmic_monotony:
    type: score
    direction: low
    instructions: "Rhythmic Monotony / Machine Cadence — uniform sentence length and uniform S-V-O clauses with no tempo variation, burstiness, or short punchy breaks"
    criteria: *scale
---
Judge `{{filename}}` against the structural naturalness standard: human prose
has rhythm, sentence variety, and cohesive paragraph progression. AI slop
fragments thoughts into bullet points with bold prefixes, overuses em dashes
to punch up clauses, and forces ideas into symmetrical three-part lists.

Score each smell below 0 (absent) to 3 (severe) — the goal is a low score.
`rework` is true when mechanical structures degrade the reading experience.

Smells:
- `inline_header_lists` — Converting narrative into a checklist:
  - "**Innovation:** Driving innovation through..."
  - "**Collaboration:** Fostering collaboration among..."
  Each bullet starts with a bold topic word, a colon, and a sentence repeating the word.
- `em_dash_overuse` — Peppered em dashes (`—`) interrupting sentences to force
  dramatic pauses, sales-pitch emphasis, or unearned contrast.
- `negative_parallelism` — Reflexive contrast framing: "It's not just a tool—it's
  a revolution", "Far from being an isolated incident, it represents...", "Rather
  than merely observing, they actively shape...".
- `rule_of_three` — Forcing triplets: "a culture of excellence, innovation, and
  integrity", "empowering communities, driving growth, and building the future".
- `rhythmic_monotony` — Metronome syntax: every sentence is 18–25 words with
  one subordinate clause; no staccato single-clause sentences, no discursive flow.

Not violations: structured reference documents (e.g. API specs or glossary tables)
where lists are essential; single purposeful em dashes in well-varied paragraphs.

The complete text:

{{content}}
