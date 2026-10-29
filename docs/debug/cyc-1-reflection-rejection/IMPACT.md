# Impact: rejecting malformed reflections (CYC-1)

## What changes

`submitReflection()` now returns `{ success: false, error, instruction }` when the
submitted content is not JSON, is JSON but not an object, or has no `decision`
in `continue | pivot | rewind | abort`. The `error` string starts with
`Reflection rejected:` followed by the reason and a reminder that the Gate-ID
is unchanged. The `instruction` is the same gate, rebuilt the same way
`getCurrentInstruction()` builds it.

For well-formed reflections nothing changes: field mapping, the `confidence`
clamp and its `0.5` default, `change_detected` coercion, `rewind_target`
validation and case/whitespace tolerance of `decision` are all as before.

## Behaviour change to be aware of

Clients that sent a reflection as prose with a `## Gate-ID:` line and no JSON
block, or JSON with a misspelled `decision`, used to advance the phase. They now
get an error and must resend a JSON block. This is intentional: a gate that
accepts an unparseable answer with confidence 1.0 is not a gate. The repository
itself contains no such client; the only occurrence was the old test.

Repeated malformed submissions will be rejected repeatedly. That is the same
behaviour the `gate_instruction_id` mismatch path already has today; a retry
counter is tracked separately (CYC-5).

## What else is touched

- `state.reflections`, the phase artifact and `REFLECTION_LOG.json` no longer
  receive `Auto-continue` entries. Their formats are unchanged.
- Returning the gate goes through `finalizeInstruction()`, which (as for every
  instruction render) bumps the per-phase MCP call counter and saves state.
  Phase, `awaitingReflection`, the gate ID and the reflections list are not
  modified.
- `CycleResponse`, `ReflectionGate`, `ReflectionDecision` and `cycleTool.ts` are
  untouched. The new error is rendered by the existing `success: false` branch.
- The `default:` branch of the decision switch is now an exhaustiveness guard
  instead of a silent `continue`.

## Verification

- `tests/cycleOrchestrator.test.mjs`: the old `auto-continue` test is replaced
  by five tests — not-JSON, `decision: "proceed"`, missing `decision`, a
  well-formed retry accepted with the same Gate-ID after a rejection, and a
  positive control for ` Continue ` being accepted. The first four fail on the
  previous build and pass on this one; the fifth passes on both.
- `npm run build` and `npm test` (all suites) pass.

## Rollback

Revert `src/core/orchestrator/cycleOrchestrator.ts` and
`tests/cycleOrchestrator.test.mjs`, rebuild. No on-disk state format changed, so
existing cycles under `.m7/` are unaffected either way.
