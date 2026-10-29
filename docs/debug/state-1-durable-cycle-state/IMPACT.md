# Impact: durable cycle state (STATE-1)

## Behaviour change

| Surface | Before | After |
|---------|--------|-------|
| Failed cycle JSON write | `success: true`, in-memory advanced | `success: false`, `State not persisted: …`, no phase advance |
| Corrupt main + valid backup | load failed / null | `safeReadJSON` returns backup + `recoveredFrom` |
| Cycle JSON on disk | `writeFile` | `atomicWriteJSON` with `.bak.N` |

## Global

All `safeReadJSON` consumers gain parse-fail backup recovery (memory, sessions, journal, etc.) — intentional per KNOWN_ISSUES.

## Verification

- `tests/cycleOrchestrator.test.mjs` — read-only `.m7/cycles` + `submitArtifact`
- `tests/reliability/test-atomic-write-scenarios.mjs` — corrupt main strict recovery
- Full `npm test`
