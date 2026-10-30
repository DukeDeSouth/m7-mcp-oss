# CYC-3: Terminal cycle status

**KNOWN_ISSUES:** CYC-3 · **Fixed in:** 3.19.0

## Root cause

`CycleState.status` existed after CYC-2 but was never set to `completed` or `aborted`. Submits kept mutating state after a cycle ended. MCP completion text always said «All 7 phases done», including after `abort`.

## Fix

- Set `status: 'completed'` on last-phase artifact commit and when `transitionToNextPhase` has no next phase.
- Set `status: 'aborted'` on reflection `abort` before finalize.
- `rejectIfTerminal()` at the start of submit inners **before** idempotent replay.
- `migrateState`: legacy states with 7 completed phases → `completed`.
- `formatCompletionResponse(taskId, status, phase, count)` — distinct copy for aborted cycles.

## Test

`tests/cycleOrchestrator.test.mjs` — block **CYC-3 terminal status**.
