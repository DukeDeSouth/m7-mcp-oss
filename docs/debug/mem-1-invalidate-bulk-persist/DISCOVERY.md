# Discovery: invalidate_bulk persist (MEM-1)

Tracked as MEM-1 in [KNOWN_ISSUES.md](../../../KNOWN_ISSUES.md).

## Root cause

`memoryTool` `invalidate_bulk` mutated in-memory records from `get()` without calling `MemorySystem.store`. `persistRecord` omitted `invalidatedAt` from the JSON payload, and `convertToRecord` did not restore `invalidatedAt` after reload — so confidence and epistemic STALE state reverted on restart.

## Fix (summary)

- `UnifiedMemoryCore.invalidate()` — durable levels only (L2/L3), strict persist, rollback on failure
- Shared `buildPersistPayload()` includes `invalidatedAt`
- `invalidate_bulk` counts only successfully persisted invalidations

See `tests/mem1-invalidate-persist.test.mjs`.
