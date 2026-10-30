# CYC-5: Separate short-artifact and rewind attempt counters

**KNOWN_ISSUES:** CYC-5 · **Fixed in:** 3.19.0

## Root cause

`phaseAttempts` tracked both (a) consecutive short artifact rejects and (b) rewinds to a target phase. When `phaseAttempts[phase] >= 3` after short rejects, the orchestrator **force-accepted** the invalid artifact. Rewinds could inflate the same counter and trigger force-accept on the first short submit after rewinds.

## Fix

- `shortArtifactAttempts` — incremented on short reject; at 3 → `Phase stuck` error (no advance).
- `rewindCount` — used only in `rewindToPhase` (max 2 per target, unchanged policy).
- Successful artifact commit resets `shortArtifactAttempts[currentPhase]` to 0.
- `phaseAttempts` deprecated (init/migrate only, not updated).
- `migrateState` initializes new counters to zero (does not copy legacy `phaseAttempts`).

## Test

`tests/cycleOrchestrator.test.mjs` — block **CYC-5 separate attempt counters**; replaced force-transition short test.

## Breaking change

Clients that relied on a third short artifact auto-advancing the phase must submit a valid artifact (≥100 chars) or abort the cycle (CYC-3).
