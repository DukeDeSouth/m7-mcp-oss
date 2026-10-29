# Discovery: durable cycle state (STATE-1)

Tracked as STATE-1 in [KNOWN_ISSUES.md](../../../KNOWN_ISSUES.md).

## Root cause

1. `saveState` caught all write errors and never surfaced failure to MCP clients; callers mutated in-memory state before persist.
2. `safeReadJSON` returned parse errors without walking `.bak.*` backups when the main file was readable but corrupt.
3. Cycle JSON used plain `writeFile` (no atomic backups); `getState` did not use `safeReadJSON`.

## Evidence

- `cycleOrchestrator.ts` — nine `saveState` call sites; `submitArtifact` pushed `completedPhases` before persist.
- `atomicWrite.ts` — parse-fail path returned `{ data: null }` without backup loop.
