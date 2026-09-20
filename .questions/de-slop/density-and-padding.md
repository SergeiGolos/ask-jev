---
description: "De-slop check: circumlocution, filler phrases, low propositional density, and generic padding"
model: jev-latest
schema:
  rework:
    type: noul
    instructions: "Does {{filename}} need rework to cut padding — is it filled with wordy circumlocution, low information density, or hollow generalities?"
    criteria:
      true: "Needs rework — bloated word count dilutes the substantive points"
      false: "Passes — tight, economical prose with high information density"
  circumlocution:
    type: score
    direction: low
    instructions: "Circumlocution & Filler Phrases — using wordy strings where one word works: 'due to the fact that' (because), 'in order to facilitate' (to help), 'at this point in time' (now)"
    criteria: &scale
      - "Absent — lean, economical phrasing throughout"
      - "Minor — one or two isolated wordy constructions"
      - "Moderate — frequent filler phrases inflating sentence length"
      - "Severe — pervasive verbiage; paragraphs can be halved without losing content"
  low_information_density:
    type: score
    direction: low
    instructions: "Low Information Density / Empty Caloric Prose — high token volume that communicates very few concrete facts, verifiable numbers, specific dates, or tangible mechanisms"
    criteria: *scale
  abstract_generalities:
    type: score
    direction: low
    instructions: "Abstract Generalities — hand-wavy conceptual descriptions where concrete examples, names, and operational details are needed"
    criteria: *scale
  repetitive_restatement:
    type: score
    direction: low
    instructions: "Repetitive Restatement / Echoing — saying the exact same core point three times in slightly different phrasing across introductory, body, and summary paragraphs"
    criteria: *scale
---
Judge `{{filename}}` against the information density standard: good writing
respects the reader's time by maximizing signal per token. AI slop pads
simple points with wordy idioms, generates paragraphs of abstract filler,
and restates the central premise over and over to hit an arbitrary length.

Score each smell below 0 (absent) to 3 (severe) — the goal is a low score.
`rework` is true when padding or low density suffocates the meaning.

Smells:
- `circumlocution` — Wordy crutches:
  - "In order to ensure that" -> "To ensure"
  - "Due to the fact that" -> "Because"
  - "Plays a significant role in facilitating" -> "Helps"
  - "With regard to the matter of" -> "Regarding" / "About"
  - "It is widely acknowledged that" -> (delete entirely)
- `low_information_density` — Reading three full paragraphs and coming away with
  only one trivial fact. High fluency, zero substance.
- `abstract_generalities` — Sentences that could appear unchanged in any document
  on any company or topic without needing modification ("leveraging robust solutions
  to optimize outcomes across diverse environments").
- `repetitive_restatement` — Announcing what will be said, saying it in generalities,
  and then summarizing that it was said, adding zero new facts in between.

Not violations: deliberate rhetorical emphasis when backed by fresh details;
necessary transitional phrases in long, multi-topic analytical documents.

The complete text:

{{content}}
