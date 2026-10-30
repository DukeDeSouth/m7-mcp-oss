# CYC-2: Serialized, idempotent cycle submits

**KNOWN_ISSUES:** CYC-2 · **Fixed in:** 3.19.0

## Root cause

`submitArtifact` / `submitReflection` had no per-task queue and no content fingerprint. Concurrent or retried MCP calls could append the same phase twice to `completedPhases`.

## Fix

- `enqueue(taskId)` promise chain for artifact, reflection, and rewind paths.
- `lastAccepted` `{ phase, kind, sha256 }` + `lastSuccessfulResponse` on successful submit.
- Duplicate byte-identical submit for the same phase and kind returns the cached response without mutating state.

## Test

`tests/cycleOrchestrator.test.mjs` — block **CYC-2 serialized submit**.
