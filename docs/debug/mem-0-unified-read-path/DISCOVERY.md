# MEM-0 — unified read path

**Release target:** 3.20.0

## Problem

Unified memory consulted `recordStore`, Markdown mirrors, and `MemorySystem` levels through different code paths. Deletes did not survive restart; mirrors bypassed search filters; L4 records were lost after cold start; contradicts used inconsistent confidence sources.

## Fix (B3)

- **`resolveRecord(id)`** — tombstone → cache → keyed disk levels (`surface` … `conceptual`).
- **`iterateRecords(filter)`** — single filter pass for search and conflict enumeration; mirrors via `buildMirrorRecords` only inside the iterator.
- **Tombstones** — `.m7/memory-tombstones.json`, loaded on `initialize()` / after `reload()`.
- **L4** — user records persist to **longterm** JSON keyed by id with `level: 'L4'` in payload (not `ProjectMemory` merge).
- **Mirrors** — `metadata.provenance: 'mirror'`, confidence ≤ 0.6.

## Tests

`tests/unifiedMemoryReadPath.test.mjs` — cases 0a–d.

## Out of scope (this release)

- `PersistentMemory.deleteBySource` (store-only).
- Chroma / vector search parity with removed `MemorySystem.search()` merge in `cascadeSearch`.
