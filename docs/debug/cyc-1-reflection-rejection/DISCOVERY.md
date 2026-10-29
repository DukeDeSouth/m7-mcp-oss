# Discovery: malformed reflection advances the cycle (CYC-1)

Tracked as CYC-1 in [KNOWN_ISSUES.md](../../../KNOWN_ISSUES.md).

## What was read

- `src/core/orchestrator/cycleOrchestrator.ts` — `submitReflection`, `parseReflection`, `validateDecision`, `validatePhase`, `getCurrentInstruction`, `buildGateInstruction`, `finalizeInstruction`
- `src/core/orchestrator/controlChannel.ts` — `extractGateInstructionId`, `validateGateInstructionId`
- `src/core/orchestrator/types/cycle.ts` — `ReflectionGate`, `ReflectionDecision`, `CycleResponse`
- `src/core/tools/cycleTool.ts` — how a `success: false` response is rendered
- `tests/cycleOrchestrator.test.mjs` — the existing test for this path and its helpers
- `grep` over `src/` and `tests/` for every caller of `parseReflection` and `submitReflection`

## Root cause

Two layers of fail-open, either of which is enough on its own:

1. `parseReflection()` wrapped `JSON.parse` in a `try` whose `catch` returned a
   synthetic reflection (`decision: 'continue'`, `confidence: 1.0`,
   `summary: 'Auto-continue (no reflection provided)'`). Any content that was not
   JSON — prose, a markdown block, a truncated payload — was turned into a
   confident "continue".
2. `validateDecision()` coerced its input with `String(raw)` and returned
   `'continue'` for anything outside the four known values. A typo
   (`"proceed"`), a missing field (`undefined` → `"undefined"`), `null` or a
   number all became `'continue'`.

`submitReflection()` then pushed the synthetic reflection into `state.reflections`,
cleared the gate ID, wrote it into the phase artifact and `REFLECTION_LOG.json`,
and called `transitionToNextPhase()`. The `default:` branch of the decision
switch also mapped to `transitionToNextPhase()`.

Evidence: the test `invalid JSON in reflection → auto-continue` asserted
`result.success` and `phase.name === 'discovery'` after submitting
`"this is not valid json at all"`, i.e. the behaviour was pinned by the suite.

`parseReflection` has exactly one caller (`submitReflection`). No other test file
calls `submitReflection`; all other reflections in the suite are built with
helpers that emit valid JSON.

## Why the fix is local

The gate ID is issued once in `submitArtifact` and cleared only inside
`submitReflection` after parsing. `submitReflection` already has a rejection
path that leaves state alone and re-issues the same gate (the
`gate_instruction_id` mismatch case). Rejecting a malformed reflection at the
same point — before the first `state` mutation — reuses that path and needs no
rollback logic.

Out of scope, behaviour unchanged: `rewind` without `rewind_target` (falls back
to the previous phase), `pivot` without `task_framing_update`, and an unknown
`rewind_target` (`validatePhase` returns `undefined`). Those are documented as
optional fields and are not what CYC-1 is about. A retry limit for repeated
rejections is a separate item (CYC-5).
