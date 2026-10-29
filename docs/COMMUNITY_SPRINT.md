# Community fix sprint — Stage 1 (batch 1)

This batch is the first implementation pass on [KNOWN_ISSUES.md](../KNOWN_ISSUES.md) after triaging an external source review (October 2026). The review surfaced concrete defects; maintainers re-verified each item against the public snapshot before listing it.

**Review context:** [DiadkoShmek](https://github.com/DiadkoShmek) — related fail-closed workflow work: [evidence-gated-agent-workflows](https://github.com/DiadkoShmek/evidence-gated-agent-workflows).

## Roadmap slice

Stage 1 goal (from KNOWN_ISSUES): *nothing is lost silently* — every reported write is on disk, and the server does not advance on input it could not understand.

### Fixed in batch 1

| ID | Summary |
|---|---|
| CYC-1 | Invalid reflection JSON/decision is rejected; cycle stays on the same gate |
| STATE-1 | Failed cycle persist surfaces `State not persisted`; corrupt main JSON can recover from `.bak.*` |
| STATE-2 | `complete_session` requires validation phase (or explicit `force: true`) |
| MEM-3 | Graceful shutdown flushes debounced L2/L3 memory (and journal) before exit |

### Tests

- Extended `tests/cycleOrchestrator.test.mjs`, `tests/taskOrchestrator.test.mjs`
- `tests/stage1-fixes-100.test.mjs` — 100 regression cases across the four fixes
- `tests/reliability/shutdownFlush.test.mjs`, updates to atomic-write reliability scenarios

### Still open (Stage 1)

MEM-1, MEM-2, CYC-9, CYC-7, MEM-4 — see KNOWN_ISSUES roadmap order.

Contributors: pick an open ID, open an issue with the ID in the title, follow [CONTRIBUTING.md](../CONTRIBUTING.md).
