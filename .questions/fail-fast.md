---
description: "Fail Fast check: hidden failures — swallowed errors, null/sentinel signals, deferred validation"
model: jev-latest
schema:
  pass:
    type: noul
    instructions: "Does {{filename}} pass the fail-fast standard: every caught exception ends up visible (knowingly handled expected failure, logged with context, or rethrown wrapped) and no failure is signaled via null/sentinel?"
    criteria:
      true: "Passes — failures are immediate and visible"
      false: "Fails — an empty catch, null/-1-as-error return, silent impossible state, or mid-stack catch-all hides a failure"
  empty_catch_block:
    type: score
    instructions: "Empty Catch — catch block body is empty or only a comment, discarding the error entirely (exception swallowing)"
    criteria: &scale
      - "Absent — no instances in the file"
      - "Minor — one or two isolated instances with limited impact"
      - "Moderate — repeated instances, or one serious instance"
      - "Severe — pervasive; the file is defined by it"
  catch_log_continue:
    type: score
    instructions: "Catch-Log-Continue — handler logs (or ignores) then falls through returning normally, so callers cannot distinguish success from failure"
    criteria: *scale
  null_return_signal:
    type: score
    instructions: "Returning Null as Error — failure path returns null, pushing the real failure point to a later dereference"
    criteria: *scale
  sentinel_error_code:
    type: score
    instructions: "Error-Code Return — method returns -1/0/false/status-code enum to flag failure instead of raising"
    criteria: *scale
  catch_all_catch:
    type: score
    instructions: "Overly Broad Catch — bare except:/catch (Exception)/catch (Throwable) mid-stack, capturing programming errors it cannot handle"
    criteria: *scale
  deferred_validation:
    type: score
    instructions: "Missing Boundary Checks — public entry point dereferences inputs with no precondition, letting bad values crash far from the boundary"
    criteria: *scale
  unasserted_impossible_state:
    type: score
    instructions: "Unasserted Impossible State — branch marked 'unreachable'/'should never happen' (comment or default: pass) with no assertion or throw"
    criteria: *scale
  lost_cause_chain:
    type: score
    instructions: "Swallowed Cause — catch block logs/throws a new generic message without wrapping or recording the original exception"
    criteria: *scale
---
Judge `{{filename}}` against fail-fast error handling: when something goes
wrong, fail immediately and visibly instead of hiding it. Errors use exceptions
with context rather than null/-1/sentinel codes; boundary inputs are validated
so failures surface at the seam; caught exceptions are always visible — handled
knowingly, logged with context, or rethrown/wrapped.

Score each smell below 0 (absent) to 3 (severe) — the goal is a low score.

Smells:
- `empty_catch_block` — Empty Catch: catch block body is empty or only a comment, discarding the error entirely.
- `catch_log_continue` — Catch-Log-Continue: handler logs (or ignores) then falls through returning normally, so callers cannot distinguish success from failure.
- `null_return_signal` — Returning Null as Error: failure path returns null, pushing the real failure point to a later NPE/dereference.
- `sentinel_error_code` — Error-Code Return: method returns -1/0/false/status-code enum to flag failure instead of raising.
- `catch_all_catch` — Overly Broad Catch: bare `except:`/`catch (Exception)`/`catch (Throwable)` mid-stack, capturing programming errors it cannot handle.
- `deferred_validation` — Missing Boundary Checks: public entry point dereferences inputs with no precondition, letting bad values crash far from the boundary.
- `unasserted_impossible_state` — Unasserted Impossible State: branch marked "unreachable"/"should never happen" (comment or `default: pass`) with no assertion or throw.
- `lost_cause_chain` — Swallowed Cause: catch block logs/throws a new generic message without wrapping or recording the original exception.

Not violations: anticipated, expected failures handled gracefully at a defined
boundary (cache miss, optional config falling back to a documented default,
retry loop moving to the next item) — only hidden failures violate.

The complete file:

{{content}}
