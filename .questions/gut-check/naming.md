---
description: "Naming check: intention-revealing, honest, consistent identifiers"
model: jev-latest
schema:
  rework:
    type: noul
    instructions: "Does {{filename}} need rework per the naming standard — does any name mislead, do type-prefix/noise-word/non-predicate-boolean failures occur more than once, or do three or more distinct naming smell types appear?"
    criteria:
      true: "Needs rework — names mislead or obscure intent"
      false: "Passes — identifiers are intention-revealing, encoding-free, and convention-consistent"
  meaningless_name:
    type: score
    direction: low
    instructions: "Meaningless Name — data, temp, foo, result, value, handleStuff standing in for a purpose-stating name"
    criteria: &scale
      - "Absent — no instances in the file"
      - "Minor — one or two isolated instances with limited impact"
      - "Moderate — repeated instances, or one serious instance"
      - "Severe — pervasive; the file is defined by it"
  misleading_name:
    type: score
    direction: low
    instructions: "Misleading Name — identifier contradicts body behavior visible in the file, e.g. getUsers() that clears a collection, userList holding a Map"
    criteria: *scale
  type_prefix_encoding:
    type: score
    direction: low
    instructions: "Systems Hungarian / Type Encoding — strName, iCount, bFlag, dwFoo, mName, kName prefixing compile-time type or scope that the declaration already shows"
    criteria: *scale
  noise_word_suffix:
    type: score
    direction: low
    instructions: "Noise Word — UserInfo, DataManager, OrderHelper, ResponseProcessor appending Info/Data/Manager/Helper/Processor without distinguishing anything from the base concept"
    criteria: *scale
  unpronounceable_abbreviation:
    type: score
    direction: low
    instructions: "Unpronounceable Abbreviation — drop-vowel or crunched names like usrMgr, calcTot, prcItem, addrLst that a reader cannot say aloud or grep reliably"
    criteria: *scale
  boolean_without_predicate:
    type: score
    direction: low
    instructions: "Non-Predicate Boolean — a bool named flag, check, state, status — or negatively isNotEnabled forcing double negation — instead of an is/has/can/found-style predicate"
    criteria: *scale
  inconsistent_convention:
    type: score
    direction: low
    instructions: "Inconsistent Convention In-File — one identifier category mixes styles (snake_case params among camelCase, UPPER locals) or synonym verbs (fetch/get/retrieve) for one concept"
    criteria: *scale
  mental_mapping_name:
    type: score
    direction: low
    instructions: "Mental-Mapping Name — single letters a, b, x, o outside tiny loop counters or one-char public-method parameters, making readers translate in their heads"
    criteria: *scale
---
Judge `{{filename}}` against intention-revealing naming: every identifier —
variables, parameters, methods, classes, constants — must state what it
holds/does and why it exists, decodable from the file alone. A name that needs a
comment does not reveal its intent; misleading names skew every later read.

Score each smell below 0 (absent) to 3 (severe) — the goal is a low score.

Smells:
- `meaningless_name` — Meaningless Name: `data`, `temp`, `foo`, `result`, `value`, `handleStuff` standing in for a purpose-stating name.
- `misleading_name` — Misleading Name: identifier contradicts body behavior visible in the file, e.g. `getUsers()` that clears a collection, `isReady` returning a computed count, `userList` holding a Map.
- `type_prefix_encoding` — Systems Hungarian / Type Encoding: `strName`, `iCount`, `bFlag`, `dwFoo`, `mName`, `kName` prefixing compile-time type or scope that the declaration already shows.
- `noise_word_suffix` — Noise Word: `UserInfo`, `DataManager`, `OrderHelper`, `ResponseProcessor` appending Info/Data/Manager/Helper/Processor without distinguishing anything from the base concept.
- `unpronounceable_abbreviation` — Unpronounceable Abbreviation: drop-vowel or crunched names like `usrMgr`, `calcTot`, `prcItem`, `addrLst` that a reader cannot say aloud or grep reliably.
- `boolean_without_predicate` — Non-Predicate Boolean: a bool named `flag`, `check`, `state`, `status` — or negatively `isNotEnabled` forcing double negation — instead of an is/has/can/found-style predicate.
- `inconsistent_convention` — Inconsistent Convention In-File: one identifier category mixes styles (snake_case params among camelCase, UPPER locals, `fetch`/`get`/`retrieve` synonyms for one concept).
- `mental_mapping_name` — Mental-Mapping Name: single letters `a`, `b`, `x`, `o` outside tiny loop counters or one-char public-method parameters, making readers translate in their heads.

Not violations: well-known domain abbreviations the reader brings to the file
(SQL, URL); semantic prefixes distinguishing same-type different-meaning
values; conventional loop indices (`i`, `j`) in tiny scopes.

The complete file:

{{content}}
