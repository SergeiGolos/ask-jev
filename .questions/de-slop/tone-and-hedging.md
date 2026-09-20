---
description: "De-slop check: excessive hedging, sterile voiceless neutrality, preachiness, and canned conclusions"
model: jev-latest
schema:
  rework:
    type: noul
    instructions: "Does {{filename}} need tonal rework — is it bogged down by excessive hedging, sterile voicelessness, patronizing preachiness, or canned conclusion templates?"
    criteria:
      true: "Needs rework — timid hedging, sterile tone, or formulaic wrap-ups rob the text of conviction"
      false: "Passes — clear voice, honest stance, and natural conclusion"
  excessive_hedging:
    type: score
    direction: low
    instructions: "Excessive Hedging — layering qualifiers to avoid commitment ('it could potentially possibly be argued', 'one might tend to consider', 'it is important to note that')"
    criteria: &scale
      - "Absent — assertive, direct statements of fact or reasoned claims"
      - "Minor — occasional standard academic hedging where genuinely uncertain"
      - "Moderate — frequent timidity, padding sentences with softeners"
      - "Severe — pervasive evasiveness; unable to state any conclusion directly"
  sterile_voicelessness:
    type: score
    direction: low
    instructions: "Sterile Voicelessness — synthetic neutral drone; zero perspective, human edge, humor, frustration, or distinct viewpoint; refusal to take a side"
    criteria: *scale
  didactic_preachiness:
    type: score
    direction: low
    instructions: "Didactic Preachiness & Chatbot Artifacts — lecturing the reader ('It is crucial to remember', 'In an increasingly interconnected world', 'Let us explore'), sycophancy, or moralizing wrap-ups"
    criteria: *scale
  canned_conclusions:
    type: score
    direction: low
    instructions: "Canned 'Challenges & Future' Conclusions — formulaic ending: 'Despite these challenges, X continues to thrive... Only time will tell, but the future looks bright'"
    criteria: *scale
  false_balance:
    type: score
    direction: low
    instructions: "False Balance / Bothsidesism — mechanically juxtaposing 'On one hand... on the other hand...' on settled or trivial points to simulate objectivity"
    criteria: *scale
---
Judge `{{filename}}` against the voice-and-tone standard: compelling writing
has conviction, perspective, and a human behind the words. AI slop hedges
every assertion into mush, retreats into sterile corporate neutrality,
and wraps up every piece with a boilerplate "challenges and bright future" paragraph.

Score each smell below 0 (absent) to 3 (severe) — the goal is a low score.
`rework` is true when tonal timidity or canned endings weaken the piece.

Smells:
- `excessive_hedging` — "It could potentially be suggested that in certain cases,
  some observers might argue...", "It is important to bear in mind that...".
- `sterile_voicelessness` — Perfect beige prose. No human personality, no rough edges,
  no reaction to absurdity, no first-person "I" where natural, no stance.
- `didactic_preachiness` — Schoolmaster tone: "As we look ahead, one must always
  remember...", "In today's fast-paced digital world...", "Ultimately, it is up
  to all of us to ensure...".
- `canned_conclusions` — The boilerplate conclusion template:
  "Despite facing significant challenges, including [X] and [Y], [Subject] continues
  to demonstrate remarkable resilience. As [Subject] moves forward, its ongoing
  evolution will undoubtedly shape the landscape for years to come."
- `false_balance` — Giving equal rhetorical weight to vacuous counter-arguments
  just to fill out a pro/con template.

Not violations: genuine scientific uncertainty quantified with confidence levels;
balanced investigative reporting presenting verifiable competing viewpoints;
formal legal or compliance disclosures.

The complete text:

{{content}}
