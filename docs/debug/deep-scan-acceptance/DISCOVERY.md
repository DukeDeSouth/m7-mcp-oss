# Discovery: deep scan acceptance suites

Covers every item in [KNOWN_ISSUES.md](../../../KNOWN_ISSUES.md) and the roadmap in [COMMUNITY_SPRINT.md](../../COMMUNITY_SPRINT.md) (batch 6).

## Method

Each item's "Acceptance test" line was turned into a test that runs at the level the line names:

- In-process against `dist/` (`tests/deepScanAcceptance.test.mjs`), one `[ID]` block per item. "After restart" means a second Node process (`tests/helpers/deepScanWorker.mjs`), not a new instance in the same process.
- Real server over stdio with the MCP SDK client (`tests/deepScanE2E.test.mjs`): exits on SIGTERM/SIGINT/stdin close, restart, responses with hints as a client receives them, tool list against `mcp.json` and the docs, stderr with `M7_DEBUG=true`.
- Documents against each other and against the suites (`tests/deepScanTraceability.test.mjs`): KNOWN_ISSUES summary rows vs item blocks, roadmap stage orders, FIX_PLAN, CHANGELOG version order and IDs, COMMUNITY_SPRINT.

Then the opposite direction: `scripts/deep-scan-mutants.mjs` puts the old behavior back into `dist/` one fix at a time and expects the matching test to fail for the stated reason (a baseline run first, so a test that already fails does not count as a kill). Mutated runs use a temp cwd, because a mutant may write where the old code wrote.

## Defects the suites found

| ID | Root cause | How it showed up |
|---|---|---|
| STATE-3 | Session persistence is async on both ends: debounced write not drained on exit, file path recomputed per write, constructor load not awaited by readers | E2E: `analyze_task` + SIGTERM left no sessions file; `status` as the first call said "not found" |
| STATE-4 | Cross-session store and nine other sites used `process.cwd()` instead of `getProjectPath()`; one process-wide instance; save errors at debug level | `run-tests.sh` pollution check: `./.m7/cross-session/*.json` in the repo |
| HYG-7 | `exec('rg "<kw>" …')` with task text | Searching `src/` for the HYG-3 pattern (shell string built from input) found this second site; with `rg` installed the search also blocked on stdin |
| HYG-8 | Hardcoded `2.0.0` in `McpServer` and `m7://status` | E2E `getServerVersion()` |
| GRAPH-3 | Rollback restored `status` only | Snapshot comparison after a failed transfer |
| CYC-2 | Replay matched on phase + hash, so a retried reflection after the phase advanced was taken as the next artifact | Retry test through the cycle tool |
| HYG-1 | `generateSlug` regex was Latin/Cyrillic only | CJK/emoji descriptions; mutant survived until the test asserted the slug itself |
| HYG-3 | `grep` keyword not behind `-e` / `--` | Keyword starting with `-` |
| HYG-4 | Key prefix still in hive coordinator response, its report file, and `M7_DEBUG` startup log | E2E stderr scan for `sk-test-` |
| HYG-9 | Health check started Docker from a compose file in cwd | STATE-4 allowlist review; stub `docker` in E2E |
| HYG-10 | Unreachable modules with shell strings and MEM-1/MEM-2 patterns; `scanGitInfo` single `try` | Review of remaining `child_process` imports |

Also: stale `dist/` modules from deleted sources, and `tests/taskOrchestrator.test.mjs` binding itself to the repo root (its debounced session write never fired before `--test-force-exit`, which is why the pollution check only caught the synchronous cross-session write).

## Checked and left as is

- `mesh/relay/server.ts` uses cwd as its data dir: a standalone process started on purpose, not the MCP server.
- Hive and planner orchestrators capture `getCrossSessionLearning()` in the constructor, but are created per call.
- Old tests that set only `M7_PROJECT_PATH` (`mem1`, `mem2`, `unifiedMemoryReadPath`, `shutdownFlush`): they pass the temp dir to `getMemoryCore(dir)` explicitly, so the pinned `CURSOR_WORKSPACE` does not reach them.

- `src/memory/auto/compaction.ts`: not imported anywhere, but no defect found; kept.

## Second pass: remaining `child_process` and dead code

Listed first as open questions, then fixed:

- **HYG-9.** `tryStartDocker` in `health/healthCheck.ts`: with ChromaDB offline (the normal case, it is optional) every `analyze_task` looked for a compose file in cwd and ran `docker compose up -d` on it, then waited up to 15 s. The package ships no compose file, so it could only start the user's own services. Removed; the hint now names `CHROMA_URL` and the local fallback. A stub `docker` on `PATH` proved the call before the fix (the E2E test took 16.5 s, the 15 s wait); after the fix the same test runs in about 1 s.
- **HYG-10.** `core/verification/` (never imported; `execSync` with an interpolated `grep`), the unregistered auto-memory tool and the four `memory/auto` modules only it used, the `PersistentMemory` wrapper (`importance || 0.7`, a second `UnifiedMemoryCore`, RAM-only `deleteBySource`), `invalidateDependents` / `updateWithInvalidation` (RAM only, 0 → 0.56, recursion without a visited set). All removed. `projectScanner.scanGitInfo` was the last shell-string user; it moved to `execFile`, and the conversion exposed that one `try` around four commands dropped branch and last commit in repos without `origin`.

After this pass `src/` imports only `execFile` / `execFileSync` from `child_process`, and a static test keeps it that way.

## Third pass: the review against KNOWN_ISSUES, finding by finding

The review PDF was read again directly: F01–F26 plus §04 and §31, 28 claims, and the eight requirements of §33. Each finding was compared with the item that claimed to cover it, and the item's fix with the finding's own repair condition. The mapping is now the "Review findings" table in KNOWN_ISSUES, checked by the traceability test.

| ID | Root cause | How it showed up |
|---|---|---|
| CYC-10 | Task ID and artifact folder were two independent functions of the description; only the ID had a random part | F07's repair condition ("a unique ID in the artifact path, two independent histories") did not hold: two cycles with one description, one folder |
| MEM-5 | A bounded LRU map was the source for a whole-file write | §31's trace on the current build: `{"onDisk":2000,"firstOnDisk":false}`; MEM-4 had covered loading only |
| STATE-5 | Registry created per call, load not awaited and incomplete, write error swallowed | §33 "success only after the write", checked through the real server: `list` = 0 after three registrations |
| MEM-6 | `loadSchema()` stored the schema in memory as a side effect | Counting records while writing the MEM-5 tests: three `analyze_task` → three copies |
| MEM-7 | Unawaited flush at 50 pending writes; no ordering of whole-file writes; `shutdown()` drained only the queue | MEM-5's public-path test passed before the fix because nothing reached the disk: 50 stores then exit → 0 |

Also corrected: our first response rated F07 as overstated, and KNOWN_ISSUES "Not on this list" repeated that as a Latin-only ID collision. The review's sequential scenario needs no forced clock. `cleanupOldCycles()` ran in the directory captured by the constructor after a project switch; it now takes the cycle's project.
