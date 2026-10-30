# Community fix sprint — KNOWN_ISSUES (October 2026)

Implementation passes on [KNOWN_ISSUES.md](../KNOWN_ISSUES.md) after triaging an external source review. The review surfaced concrete defects; maintainers re-verified each item against the public snapshot before listing it.

**Review context:** [DiadkoShmek](https://github.com/DiadkoShmek) — related fail-closed workflow work: [evidence-gated-agent-workflows](https://github.com/DiadkoShmek/evidence-gated-agent-workflows).

## Batch 1 — v3.18.1 (Stage 1, first slice)

Stage 1 goal: *nothing is lost silently* — every reported write is on disk, and the server does not advance on input it could not understand.

| ID | Summary |
|---|---|
| CYC-1 | Invalid reflection JSON/decision is rejected; cycle stays on the same gate |
| STATE-1 | Failed cycle persist surfaces `State not persisted`; corrupt main JSON can recover from `.bak.*` |
| STATE-2 | `complete_session` requires validation phase (or explicit `force: true`) |
| MEM-3 | Graceful shutdown flushes debounced L2/L3 memory (and journal) before exit |

Tests: extended cycle/session suites, `tests/stage1-fixes-100.test.mjs`, `tests/reliability/shutdownFlush.test.mjs`. Merged PR #5.

## Batch 2 — v3.19.0 (Stage 1 remainder + Stage 2 cycles)

### Stage 1 remainder

| ID | Summary |
|---|---|
| MEM-1 | Invalidate persists STALE to L2/L3; L0/L1 error without mutating RAM |
| MEM-2 | Confidence `0` survives reload |
| MEM-4 | Large memory files resize BoundedMap; persist guard against silent truncation |
| CYC-7 | Artifact resubmit appends with separator; failed write surfaces error |
| CYC-9 | Old cycle cleanup skips active; archives completed state |

### Stage 2 — cycle protocol

| ID | Summary |
|---|---|
| CYC-2 | Serialized per-task submit; idempotent replay of identical content |
| CYC-3 | Completed/aborted cycles are terminal |
| CYC-4 | `projectPath` pinned at `startCycle` for state + artifacts |
| CYC-5 | Separate short-artifact vs rewind counters (**breaking:** no force-accept on 3rd short) |
| CYC-6 | Carry-forward uses latest reflection per phase |

### Tests (batch 2)

- `tests/cycleOrchestrator.test.mjs` — CYC-2…CYC-6 blocks
- `tests/mem1-invalidate-persist.test.mjs`, `tests/mem2-confidence-zero-load.test.mjs`, `tests/mem4-bounded-load.test.mjs`
- `tests/cyc9-cleanup.test.mjs`
- Debug notes under `docs/debug/cyc-*` and `docs/debug/mem-*`

### Still open

Stage 1 complete after v3.19.0. Next roadmap slice: MEM-0, then GATE/GRAPH items — see KNOWN_ISSUES Stage 2/3 order.

Contributors: pick an open ID, open an issue with the ID in the title, follow [CONTRIBUTING.md](../CONTRIBUTING.md).
