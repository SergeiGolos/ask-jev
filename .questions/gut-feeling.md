---
description: "Holistic 0-10 gut-reaction scores of one file's code-health principles"
model: jev-latest
---
Gut-feeling review of `{{filename}}`.

Read the whole file below, then rate it on each principle in the questions.
For every question, pick the level description that best matches your honest
gut reaction to `{{filename}}`: the first criterion is 0 (worst), the last is 10
(best), and your score may land between levels. The descriptions anchor the
scale — trust your overall instinct for the file within it.

The complete file:

{{content}}

```schema
  kiss:
    type: choice
    instructions: "KISS (Keep It Simple): pick the 0-10 option whose description best matches the file."
    criteria:
      "0": Complex, convoluted logic for simple tasks.
      "1": Over-engineered solutions with unnecessary layers.
      "2": Frequent use of obscure language features.
      "3": Hard to follow control flow, deep nesting.
      "4": Some attempts at simplification, but still bloated.
      "5": Average complexity, understandable but could be simpler.
      "6": Mostly straightforward, few unnecessary abstractions.
      "7": Clear logic, easy to read for the most part.
      "8": Very simple, direct solutions to problems.
      "9": Elegant simplicity, minimal code to achieve the goal.
      "10": Simplest possible solution, zero unnecessary complexity.
  dry:
    type: choice
    instructions: "DRY (Don't Repeat Yourself): pick the 0-10 option whose description best matches the file."
    criteria:
      "0": Copy-pasting code blocks everywhere.
      "1": Duplicated logic with minor tweaks in many places.
      "2": Redundant helper functions doing the same thing.
      "3": Magic numbers and strings repeated throughout.
      "4": Some reuse, but still significant duplication.
      "5": Basic abstractions in place, but edge cases duplicated.
      "6": Most common logic is centralized.
      "7": Good use of inheritance/composition to avoid repetition.
      "8": High reuse, changes only need to be made in one place.
      "9": Almost zero duplication, highly modular code.
      "10": Single source of truth for all logic and data.
  yagni:
    type: choice
    instructions: "YAGNI (You Aren't Gonna Need It): pick the 0-10 option whose description best matches the file."
    criteria:
      "0": Building features for speculative future needs.
      "1": Heavy abstractions for features not yet required.
      "2": Unused parameters and dead code left in.
      "3": Over-generalized interfaces for single implementations.
      "4": Some unnecessary flexibility, but somewhat grounded.
      "5": Mostly focused on current requirements.
      "6": Only building what's needed, with minor exceptions.
      "7": Lean implementation, avoiding premature optimization.
      "8": Strict adherence to current requirements only.
      "9": Ruthlessly pruning unused or speculative code.
      "10": Only code that directly solves today's problem exists.
  srp:
    type: choice
    instructions: "SRP (Single Responsibility Principle): pick the 0-10 option whose description best matches the file."
    criteria:
      "0": Massive God classes doing everything.
      "1": Classes have many unrelated responsibilities.
      "2": Frequent changes required for unrelated reasons.
      "3": Low cohesion, methods don't share state.
      "4": Some separation, but still too much going on.
      "5": Basic separation of concerns, but imperfect.
      "6": Mostly adheres to SRP, easier to understand.
      "7": Good cohesion, classes have clear purposes.
      "8": High cohesion, changes only affect one area.
      "9": Excellent design, each class does one thing well.
      "10": Perfect modularity, single reason to change.
  ocp:
    type: choice
    instructions: "OCP (Open/Closed Principle): pick the 0-10 option whose description best matches the file."
    criteria:
      "0": Modifying existing code for every new feature.
      "1": Rampant switch statements and if-else chains.
      "2": Hardcoded behaviors, impossible to extend.
      "3": Tight coupling prevents easy additions.
      "4": Some use of inheritance, but still fragile.
      "5": Basic use of interfaces, but changes still ripple.
      "6": Mostly adheres to OCP, easier to add features.
      "7": Good use of polymorphism to extend behavior.
      "8": High extensibility, new features require new code only.
      "9": Excellent design, core logic is completely closed.
      "10": Perfect extensibility, zero modification to existing code.
  lsp:
    type: choice
    instructions: "LSP (Liskov Substitution Principle): pick the 0-10 option whose description best matches the file."
    criteria:
      "0": Subclasses break expectations of base classes.
      "1": Frequent use of NotImplementedException.
      "2": Subclasses require type checking (instanceof).
      "3": Overriding methods with completely different behavior.
      "4": Some adherence, but edge cases violate contract.
      "5": Basic inheritance, but occasional surprises.
      "6": Mostly adheres to LSP, substitutions work well.
      "7": Good design, subclasses honor base class contracts.
      "8": High reliability, polymorphic behavior is predictable.
      "9": Excellent design, seamless substitution everywhere.
      "10": Perfect adherence, subclasses are true subtypes.
  isp:
    type: choice
    instructions: "ISP (Interface Segregation Principle): pick the 0-10 option whose description best matches the file."
    criteria:
      "0": Massive fat interfaces forcing unused methods.
      "1": Clients depend on methods they don't use.
      "2": Dummy implementations of interface methods.
      "3": Changes to one method affect unrelated clients.
      "4": Some separation, but interfaces still too broad.
      "5": Basic interface segregation, but could be finer.
      "6": Mostly adheres to ISP, interfaces are reasonable.
      "7": Good design, clients only depend on what they use.
      "8": High cohesion, interfaces are small and focused.
      "9": Excellent design, role-based interfaces used effectively.
      "10": Perfect segregation, highly specific and lean interfaces.
  dip:
    type: choice
    instructions: "DIP (Dependency Inversion Principle): pick the 0-10 option whose description best matches the file."
    criteria:
      "0": High-level modules depend directly on low-level details.
      "1": Hard dependencies on concrete implementations.
      "2": Impossible to mock or test in isolation.
      "3": Tight coupling to databases, UI, or external systems.
      "4": Some use of interfaces, but instantiation is hardcoded.
      "5": Basic dependency injection, but inconsistent.
      "6": Mostly adheres to DIP, easier to swap implementations.
      "7": Good design, high-level policy is decoupled from details.
      "8": High testability, dependencies are easily mocked.
      "9": Excellent design, completely driven by abstractions.
      "10": Perfect inversion, all dependencies are abstractions.
  demeter:
    type: choice
    instructions: "Law of Demeter: pick the 0-10 option whose description best matches the file."
    criteria:
      "0": Deeply chained method calls.
      "1": High coupling to internal structures of other objects.
      "2": Objects know too much about their neighbors' neighbors.
      "3": Frequent reaching into objects to pull out data.
      "4": Some encapsulation, but still occasional deep reaching.
      "5": Moderate adherence, mostly talking to direct friends.
      "6": Good encapsulation, fewer chained calls.
      "7": Objects mostly ask direct collaborators for actions.
      "8": Strong encapsulation, minimal knowledge of internals.
      "9": Almost no chained calls, highly decoupled objects.
      "10": Perfect encapsulation, objects only talk to immediate friends.
  tell_dont_ask:
    type: choice
    instructions: "Tell Don't Ask: pick the 0-10 option whose description best matches the file."
    criteria:
      "0": Pulling data out of objects to make decisions outside.
      "1": Heavy use of getters to evaluate state externally.
      "2": Anemic domain models with logic in services.
      "3": Objects are just data structures with no behavior.
      "4": Some behavior in objects, but still much external logic.
      "5": Mix of telling objects what to do and asking for state.
      "6": Good encapsulation of logic within objects.
      "7": Mostly telling objects to perform actions.
      "8": Strong behavior-rich objects, minimal getters.
      "9": Logic is almost entirely co-located with data.
      "10": Perfect encapsulation, objects act on their own data.
  boy_scout:
    type: choice
    instructions: "The Boy Scout Rule: rate the evidence of care and clean-up in the file 0 (worst) to 10 (best) pick the 0-10 option whose description best matches the file."
    criteria:
      "0": Leaving code messier than when it was found.
      "1": Ignoring obvious technical debt while adding features.
      "2": Adding quick hacks instead of proper refactoring.
      "3": Only cleaning up when explicitly told to do so.
      "4": Occasional minor cleanups, but mostly focused on new work.
      "5": Leaving code roughly the same quality as found.
      "6": Consistent minor improvements (renaming, formatting).
      "7": Good habit of cleaning up local messes.
      "8": Proactive refactoring of nearby code during tasks.
      "9": Significant improvements to code quality with every commit.
      "10": Always leaving the code noticeably cleaner and better.
  naming:
    type: choice
    instructions: "Intention-Revealing Naming: pick the 0-10 option whose description best matches the file."
    criteria:
      "0": Variables like x, y, data, obj, temp.
      "1": Misleading names that don't match the behavior.
      "2": Cryptic abbreviations and acronyms.
      "3": Type information in names (e.g., strName, intCount).
      "4": Some clear names, but many ambiguous ones.
      "5": Average naming, understandable with some context.
      "6": Good, descriptive names for most variables and functions.
      "7": Names clearly express purpose without needing comments.
      "8": Strong, consistent naming conventions used throughout.
      "9": Highly expressive names, code reads almost like English.
      "10": Perfect naming, zero ambiguity about purpose or behavior.
  single_minded:
    type: choice
    instructions: "Single-Minded Functions: pick the 0-10 option whose description best matches the file."
    criteria:
      "0": 1000+ line functions doing multiple unrelated things.
      "1": Functions with high cyclomatic complexity and deep nesting.
      "2": Functions with side effects hidden in the name.
      "3": Functions that take many boolean flags to change behavior.
      "4": Some decomposition, but functions still do too much.
      "5": Average size, mostly focused but with some creep.
      "6": Good decomposition, functions mostly do one thing.
      "7": Small functions, clear purpose, easy to test.
      "8": Very focused functions, minimal side effects.
      "9": Tiny functions, highly reusable and composable.
      "10": Perfect isolation, each function does exactly one thing well.
  fail_fast:
    type: choice
    instructions: "Fail Fast: pick the 0-10 option whose description best matches the file."
    criteria:
      "0": Swallowing exceptions silently and continuing.
      "1": Returning null or error codes instead of throwing.
      "2": Catching generic exceptions at the top level only.
      "3": Validating inputs deep within the business logic.
      "4": Some validation, but errors surface late in execution.
      "5": Average error handling, mostly catching expected issues.
      "6": Good upfront validation of inputs and state.
      "7": Throwing specific exceptions early when things go wrong.
      "8": Strong use of assertions and early returns for invalid states.
      "9": Highly robust, invalid states are caught immediately.
      "10": Perfect early validation, impossible to enter invalid states.
```