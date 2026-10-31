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

## Batch 3 — v3.20.0–v3.20.1 (Stage 2, memory and grounding)

| ID | Summary |
|---|---|
| MEM-0 | One read path: `resolveRecord` / `iterateRecords`, persisted tombstones, mirror records marked and capped, L4 records durable |
| GATE-1 | `path:` premises check the filesystem under the project root; Fog of War adds freshness |

Tests: `tests/unifiedMemoryReadPath.test.mjs`, `tests/groundingGate.test.mjs`. Debug notes: `docs/debug/mem-0-*`, `docs/debug/gate-1-*`.

## Batch 4 — v3.21.0–v3.21.1 (Stage 2 remainder, first Stage 3 items)

| ID | Summary |
|---|---|
| GATE-2 | Irreversible step with no premises is one strong warning |
| GRAPH-1 | Depth-limited traversal re-expands a node reached with more remaining depth |
| GRAPH-2 | Random transfer ID suffix; `createTask` refuses an existing ID |
| GRAPH-3 | Failed transfer deletes the new task (source restore completed in batch 6) |
| HYG-2 | Hive cache key keeps word order and non-Latin letters |
| CYC-8 | Registry row for a cycle folder is replaced, not appended |
| HYG-1 | Non-Latin task IDs get a hash slug and a random suffix (artifact folder name completed in batch 6) |

Tests: `tests/taskGraph.test.mjs`, `tests/hiveCache.test.mjs`, `tests/groundingGate.test.mjs`, `tests/cycleOrchestrator.test.mjs`. Debug notes: `docs/debug/gate-2-*`, `docs/debug/graph-stage2`, `docs/debug/hyg-2-*`.

## Batch 5 — v3.22.0 (Stage 3)

| ID | Summary |
|---|---|
| GATE-3 | Gate prompt rendered once per response; error banner without a source dropped |
| HYG-3 | Hive file search uses `execFile('grep', argv)` |
| HYG-4 | `mcp_m7_test_tool` removed (other key-prefix sites completed in batch 6) |
| HYG-5 | README says re-injection counts `mcp_m7_cycle` calls |
| HYG-6 | `M7CodeInterceptor` removed |

Tests: `tests/hintGenerator.test.mjs`, `tests/cycleOrchestrator.test.mjs` (GATE-3), `tests/fileSearcher.test.mjs` (HYG-3); HYG-4/5/6 are checked in batch 6. Debug notes: `docs/debug/gate-3-*`, `docs/debug/hyg-stage3`.

## Batch 6 — v3.22.1 (acceptance suites over all of the above)

Three suites check every item against its KNOWN_ISSUES acceptance line, through the real server where an in-process test cannot prove it:

- `tests/deepScanAcceptance.test.mjs` — one `[ID]` block per item; restarts are real processes (`tests/helpers/deepScanWorker.mjs`), not re-instantiation.
- `tests/deepScanE2E.test.mjs` — `node dist/index.js` over stdio with the MCP SDK client: SIGTERM/SIGINT/close exits, restart, tool responses with hints as the client receives them, tool list against `mcp.json` and the docs, stderr with `M7_DEBUG=true`.
- `tests/deepScanTraceability.test.mjs` — KNOWN_ISSUES summary and item blocks, roadmap, FIX_PLAN, CHANGELOG, this file and the suites describe the same set of items.

Each fix was also checked the other way: putting the old behavior back into `dist/` makes its test fail (`scripts/deep-scan-mutants.mjs`).

Defects the suites found:

| ID | Summary |
|---|---|
| STATE-3 | *(new)* Task sessions lost on exit, written to the wrong project after a switch, invisible to the first call after start |
| STATE-4 | *(new)* Cross-session knowledge and several other modules used `process.cwd()` instead of the active project |
| HYG-7 | *(new)* Architecture context search ran task text through a shell; with `rg` installed it blocked on stdin and never returned results |
| HYG-8 | *(new)* Server reported version 2.0.0 |
| HYG-9 | *(new)* `analyze_task` started containers from a compose file in the server's working directory |
| HYG-10 | *(new)* Unreachable modules still carried shell-string `exec` and memory defects fixed elsewhere; git info lost without `origin` |
| GRAPH-3 | Rollback restored only `status`; `outcome` and `completed` stayed |
| CYC-2 | A retried reflection became the next phase's artifact |
| HYG-1 | Artifact folder slug was still Latin/Cyrillic-only; CJK/emoji cycles wrote into the `m7-cycles/` root |
| HYG-3 | Keyword starting with `-` was read by `grep` as an option |
| HYG-4 | Hive coordinator response and debug logs still carried a 15-character key prefix |

A second pass compared the review itself, finding by finding, with KNOWN_ISSUES and the code. Until then the link from finding numbers to items existed only in our response to the review, and nothing checked it. It is now the "Review findings" table in KNOWN_ISSUES, covered by the traceability test. The pass turned up:

| ID | Summary |
|---|---|
| CYC-10 | *(new)* Review finding F07, which our response had rated as overstated: cycles with the same description shared an artifact folder and a registry row |
| STATE-5 | *(new)* The contract registry reported success for registrations it never kept |
| MEM-5 | *(new)* Review §31 at run time: the 2001st long-term record pushed the first one off the disk (MEM-4 had fixed only loading) |
| MEM-6 | *(new)* Every schema read added another copy of the schema to long-term memory |
| MEM-7 | *(new)* Overlapping, unawaited memory flushes lost acknowledged writes from 50 pending writes on |

README now says what is stored where and for how long (review §33, point 8).

Also: stale `dist/` modules from deleted sources (now cleaned by `prebuild`), test files that wrote into the repository (now caught by `run-tests.sh`), escaped backticks in the README. Debug notes: `docs/debug/deep-scan-acceptance`.

## v3.22.2

| ID | Summary |
|---|---|
| HYG-11 | *(new)* `require()` in three ES modules threw `ReferenceError` behind a `catch`: mesh presence file never written, knowledge-graph cache never read, `createTSISystem()` threw |

The MEM-7 ordering test no longer depends on timing. It waited 2.5 s and relied on concurrent writes finishing out of order, so the "no write queue" mutant survived some runs. It now holds the first file write and counts concurrent writes.

All items in KNOWN_ISSUES are fixed as of v3.22.2. New defects go into KNOWN_ISSUES with the same template; contributors: open an issue with the ID in the title, follow [CONTRIBUTING.md](../CONTRIBUTING.md).
