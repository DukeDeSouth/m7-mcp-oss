# Discovery: shutdown flush (MEM-3)

Tracked as MEM-3 in [KNOWN_ISSUES.md](../../../KNOWN_ISSUES.md).

## Root cause

`gracefulExit()` in `src/index.ts` called `process.exit(0)` without awaiting `MemorySystem.shutdown()`. Debounced `pendingWrites` (1s) for `longterm` / `conceptual` were discarded on IDE disconnect or SIGTERM.

MCP memory stores go through `UnifiedMemoryCore` → `persistRecord` → `memorySystem.store`. Default L0 `store` does not use `pendingWrites`; acceptance uses **L2** (`store_at`).

## Evidence

- `memorySystem.ts` — `shutdown()` exists and calls `flushPendingWrites()`
- `index.ts` — sync exit on SIGTERM, stdin close, EPIPE, transport close
