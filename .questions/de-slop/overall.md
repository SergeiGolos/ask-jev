---
description: "Composite de-slop review: overall AI slop score (0-9) plus key dimension scores"
model: jev-latest
schema:
  rework:
    type: noul
    instructions: "Does {{filename}} need a de-slop rewrite — is the text visibly polluted by AI writing habits, inflated rhetoric, or formulaic padding?"
    criteria:
      true: "Needs de-slop — artificial AI patterns or empty padding compromise the text"
      false: "Passes — natural human voice, substantive content, and clean prose"
  slop_score:
    type: score
    direction: low
    instructions: "Overall Slop Score — rate overall AI slopification on an ascending 0-9 scale"
    criteria:
      - "0: Clean — authentic human voice, zero AI formulaic tells, high substantive density"
      - "1: Minimal — one isolated trope or slightly stiff phrase; overwhelmingly authentic"
      - "2: Low — occasional minor AI tells (e.g. a trailing -ing clause or generic transition) but mostly substantive"
      - "3: Noticeable — visible AI patterning; multiple telltale words or structural clichés"
      - "4: Moderate — clearly AI-drafted or heavily homogenized; repetitive formulaic clauses"
      - "5: Substantial — pervasive puffery, AI vocabulary, symmetrical listicles, and superficial analysis"
      - "6: High — heavy slop; hollow fluff, lack of voice, copula avoidance, and repetitive hedging"
      - "7: Severe — classic raw LLM output; tapestries, beacons, rule-of-three, empty boilerplate"
      - "8: Very Severe — almost entirely devoid of original voice or concrete facts; pure generic padding"
      - "9: Total Slop — maximum slopification; completely artificial, formulaic, sycophantic, and vacuous"
  puffery_and_significance:
    type: score
    direction: low
    instructions: "Puffery & False Significance — unearned grandeur, 'pivotal moment', 'rich tapestry', trailing -ing analysis"
    criteria: &scale
      - "Absent — clean, grounded, neutral statements of fact"
      - "Minor — one or two mildly inflated phrases"
      - "Moderate — repeated grandiosity or superficial significance clauses"
      - "Severe — pervasive unearned drama; reads like an AI press release"
  ai_vocabulary:
    type: score
    direction: low
    instructions: "AI Vocabulary & Clichés — overuse of 'delve', 'tapestry', 'testament', 'underscore', and copula avoidance ('serves as')"
    criteria: *scale
  structural_artificiality:
    type: score
    direction: low
    instructions: "Structural Artificiality — inline-header lists (**Key:** description), em dash crutches, negative parallelisms, rule-of-three"
    criteria: *scale
  tone_and_hedging:
    type: score
    direction: low
    instructions: "Tone & Voicelessness — excessive hedging ('could potentially'), sterile drone, lack of opinion, didactic preaching"
    criteria: *scale
  padding_and_low_density:
    type: score
    direction: low
    instructions: "Padding & Low Information Density — circumlocution ('due to the fact that'), high word count with low propositional density"
    criteria: *scale
---
Judge `{{filename}}` against the De-Slop standard: good writing communicates
substantive facts, distinct human voice, and crisp reasoning without formulaic
AI crutches, empty inflation, or mechanical padding.

Score each dimension below 0 (absent/clean) to 3 (severe), and assign an overall
`slop_score` from 0 (clean human writing) to 9 (total AI slop).
`rework` is true when AI tells, puffery, or padding degrade the text.

Core dimensions:
- `slop_score` — Composite AI slop index (0–9).
- `puffery_and_significance` — False grandeur: arbitrary topics framed as "pivotal",
  "enduring legacy", or "transformative"; superficial participial analysis ("highlighting...",
  "underscoring...", "fostering...").
- `ai_vocabulary` — AI buzzwords ("delve", "tapestry", "beacon", "testament", "vibrant")
  and copula avoidance (replacing "is"/"has" with "serves as", "stands as", "features").
- `structural_artificiality` — Inline-header lists (`**Label:** detail`), excessive
  em dashes, rigid negative parallelisms ("not just X, but Y"), and formulaic triplets.
- `tone_and_hedging` — Layered hedging ("it could potentially be argued"), voiceless
  sterile neutrality, preachy didacticism, or canned "challenges and future prospects".
- `padding_and_low_density` — Wordy circumlocution ("in order to facilitate", "due to
  the fact that") where high token counts convey minimal concrete information.

Not violations: genuinely monumental historical events described factually;
legitimate technical bullet points; natural occasional metaphors; precise
probabilistic nuance supported by data.

The complete text:

{{content}}
