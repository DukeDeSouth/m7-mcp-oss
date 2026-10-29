# Discovery: `complete_session` has no phase guard (STATE-2)

Tracked as STATE-2 in [KNOWN_ISSUES.md](../../../KNOWN_ISSUES.md).

## What was read

- `src/core/orchestrator/taskOrchestrator.ts` — `completeSession`, `finalizeCompletedSession`, `getPhaseRequirements`, `isPhaseCompleted`, `checkPhaseTransition`, `markRequirementComplete`
- `src/core/tools/unified/sessionTool.ts` — `complete_session` handler
- `KNOWN_ISSUES.md` acceptance criteria
- `grep` for `completeSession`, `getPhaseRequirements`, `isPhaseCompleted`

## Root cause

1. **`completeSession`** set `currentPhase = 'completed'` without checking current phase or validation requirements.
2. **`getPhaseRequirements`** returned only discovery/architecture/planning lists; implementation and validation had no keys, so callers saw an empty requirement set for those phases.
3. **`isPhaseCompleted`** used `requirements.every(...)` — for an empty array, `every` is vacuously `true`, so any phase with no declared requirements looked "done".
4. **`checkPhaseTransition`** could advance from implementation directly to `completed` when implementation keys were satisfied, skipping validation.

## Why the fix is local

Session lifecycle is contained in `TaskOrchestrator` and the session tool is a thin wrapper. Guard logic in `completeSession`, corrected requirement resolution, empty-list semantics in `isPhaseCompleted`, and capping transitions at validation reuse existing persistence and `crossSessionLearning.endSession` paths via `finalizeCompletedSession`.
