# Known issues and fix roadmap

This is the list of confirmed defects in m7-mcp-oss, each tied to a specific place in the code, with a suggested order for fixing them. It exists so that anyone who wants to contribute can pick something concrete without first re-discovering the problem.

Line numbers refer to commit `72a7640` (the initial public release). After a fix lands, the numbers will drift; the function and symbol names next to them should still be enough to find the spot.

Most items come from an independent source-level review published in October 2026. Every item was re-verified against the code before being listed here, and a few came from running the server rather than reading it. Items from the review that did not hold up on re-verification, or that describe design choices rather than defects, are not on this list (see the last section for the notable ones). Review context and the first response sprint: [docs/COMMUNITY_SPRINT.md](docs/COMMUNITY_SPRINT.md) (community review triage; implementation by [DukeDeSouth/m7-mcp-oss](https://github.com/DukeDeSouth/m7-mcp-oss) maintainers; [DiadkoShmek](https://github.com/DiadkoShmek) on GitHub).

## How to pick one up

1. Open a GitHub issue with the item ID in the title (for example `CYC-1: unparseable reflection auto-continues`). That is how we avoid two people working on the same thing.
2. Follow [CONTRIBUTING.md](CONTRIBUTING.md): a bug fix needs a test that fails before the change and passes after it. The "Acceptance test" line under each item is the minimum that test should cover. A suggested approach for each item — which functions to touch, which test file, what to watch out for — is in [docs/FIX_PLAN.md](docs/FIX_PLAN.md).
3. In the PR, change the item's status in this file (`open` → `fixed in #NN`). Keep the item; do not delete it.

Items marked `good first issue` are self-contained and need no knowledge of the rest of the system. Items marked `help wanted` are larger or touch shared code and benefit from a design note in the issue before coding.

## Severity scale

- **high** — silent loss or corruption of persisted data, or the server reports success for something it did not do.
- **medium** — observably wrong result for an input that a normal client can produce.
- **low** — hygiene, dead code, misleading output, documentation drift.

## Summary

| ID | Title | Severity | Stage | Labels | Status |
|---|---|---|---|---|---|
| CYC-1 | Unparseable reflection is treated as `continue` with confidence 1.0 | high | 1 | bug, help wanted | fixed in #5 |
| CYC-2 | Artifact submission is neither idempotent nor serialized | medium | 2 | bug, help wanted | fixed in #6 |
| CYC-3 | A finished or aborted cycle is not terminal | medium | 2 | bug | fixed in #6 |
| CYC-4 | Cycle state and artifact files can land in different projects | medium | 2 | bug | fixed in #6 |
| CYC-5 | One attempt counter serves two unrelated limits | medium | 2 | bug | fixed in #6 |
| CYC-6 | Carry-forward picks the first reflection, not the latest | medium | 2 | bug, good first issue | fixed in #6 |
| CYC-7 | Re-submitting an artifact overwrites the previous file without trace | medium | 1 | bug, good first issue | fixed in #6 |
| CYC-8 | Registry append never deduplicates | low | 3 | bug, good first issue | open |
| CYC-9 | Cleanup deletes cycle state by age alone | high | 1 | bug | fixed in #6 |
| STATE-1 | Failed state write is reported as success; backups are never consulted for corrupt files | high | 1 | bug, help wanted | fixed in #5 |
| STATE-2 | `complete_session` has no phase guard | high | 1 | bug | fixed in #5 |
| MEM-0 | Tracking: one read path for memory | medium | 2 | bug, help wanted | open |
| MEM-1 | `invalidate_bulk` mutates in memory only | high | 1 | bug, good first issue | fixed in #6 |
| MEM-2 | Confidence `0` becomes `0.5` on load | high | 1 | bug, good first issue | fixed in #6 |
| MEM-3 | Pending memory writes are dropped on shutdown | high | 1 | bug | fixed in #5 |
| MEM-4 | Loading more than 2000 long-term records evicts and then rewrites the file | high | 1 | bug | fixed in #6 |
| GRAPH-1 | Depth-limited DFS marks nodes visited at the wrong depth | medium | 2 | bug, good first issue | open |
| GRAPH-2 | Transfer task IDs can collide and overwrite | low | 2 | bug, good first issue | open |
| GRAPH-3 | Failed transfer leaves an orphan task | medium | 2 | bug | open |
| GATE-1 | Grounding treats `path:` references as memory lookups, not file checks | medium | 2 | bug | open |
| GATE-2 | Irreversible steps with no premises raise no warning | medium | 2 | bug, good first issue | open |
| GATE-3 | Response noise: gate prompt repeated, error banner without a source | low | 3 | enhancement, good first issue | open |
| HYG-1 | Task IDs: non-Latin descriptions produce an empty slug | low | 3 | bug, good first issue | open |
| HYG-2 | Hive result cache key collapses non-Latin and order-sensitive tasks | medium | 2 | bug | open |
| HYG-3 | Shell command built by string interpolation | low | 3 | enhancement, good first issue | open |
| HYG-4 | Debug tool prints API key prefixes | low | 3 | enhancement, good first issue | open |
| HYG-5 | README describes rule re-injection as counting "tool calls" | low | 3 | documentation, good first issue | open |
| HYG-6 | `M7CodeInterceptor` is dead code | low | 3 | enhancement, good first issue | open |

## Roadmap

The order below is driven by dependencies more than by severity. Each stage has a one-line "done when".

### Stage 1 — nothing is lost silently

Done when: every write the server reports as successful is on disk, and the server never advances state on input it could not understand.

Order: STATE-1 → MEM-3 → MEM-1 → MEM-2 → CYC-1 → STATE-2 → CYC-9 → CYC-7 → MEM-4.

STATE-1 and MEM-3 share one principle: write, then respond. Fixing STATE-1 first gives you the error path that MEM-3 and CYC-7 then reuse. CYC-1 changes a tested behavior (see the item), so the test change should be part of the PR, not a follow-up.

### Stage 2 — the server does what it says

Done when: the cycle protocol has one state per call, one call per state, and memory reads return the same record regardless of how it was loaded.

Order: CYC-2 → CYC-3 → CYC-5 → CYC-6 → CYC-4 → MEM-0 → GATE-1 → GATE-2 → GRAPH-1 → GRAPH-3 → GRAPH-2 → HYG-2.

CYC-2 before CYC-3: once submissions are serialized and deduplicated, a terminal status field is a small addition; the other way round you end up guarding the status field against races. MEM-0 is a tracking item: its four sub-points have one root and should be fixed by one change to the read path, not by four patches.

### Stage 3 — hygiene and documentation

Done when: no dead code paths, no misleading output, README matches behavior.

Order: HYG-1, HYG-3, HYG-4, HYG-5, HYG-6, GATE-3, CYC-8 — independent of each other, any order.

---

## Cycle contract (`CYC-*`)

### CYC-1 — Unparseable reflection is treated as `continue` with confidence 1.0

**Severity:** high · **Stage:** 1 · **Labels:** bug, help wanted · **Status:** fixed in #5

**Where:** `src/core/orchestrator/cycleOrchestrator.ts` — `parseReflection()` L634-665 (`defaultReflection`, `catch` branch), `validateDecision()` L672-675; test `tests/cycleOrchestrator.test.mjs` L389-401.

**Reproduce:** Start a cycle, submit any artifact, then submit `## Gate-ID: <id>\n\nnot json` as the reflection. The response shows the next phase.

**Expected:** The submission is rejected with an error naming what could not be parsed; the cycle stays in the awaiting-reflection state; no reflection record is written. Same for an unrecognized `decision` value.

**Acceptance test:** Replace the test at L389-401 with one asserting `success === false` and that `getCurrentInstruction` still reports the same phase and gate. Add a case for `decision: "proceed"`.

**Notes:** This is the single most consequential item on the list: a reflection gate that accepts garbage is not a gate. The fix is small; the discussion to have in the issue is whether a retry counter is needed (see CYC-5) and what the error message should tell the client.

### CYC-2 — Artifact submission is neither idempotent nor serialized

**Severity:** medium · **Stage:** 2 · **Labels:** bug, help wanted · **Status:** fixed in #6

**Where:** `src/core/tools/cycleTool.ts` L87-100 (branch between `submitReflection` and `submitArtifact` based on current state); `src/core/orchestrator/cycleOrchestrator.ts` — `submitArtifact()` L154-183 (no lock, no content hash).

**What happens:** Two problems with one root. (a) A client that retries the same `tools/call` with identical content gets the second copy accepted as the artifact of the *next* phase (or as a reflection, depending on where the state is by then). (b) Two concurrent submissions for the same task both read the same state, both pass validation, and both append — `completedPhases` ends up as `["intake", "intake"]`.

**Reproduce:** (a) Submit the same artifact twice in a row. (b) `Promise.all([submitArtifact(id, a), submitArtifact(id, a)])` in a test.

**Expected:** (a) A repeat of the last accepted content for the same phase returns the same response it got the first time and changes nothing. (b) Submissions for one task are processed one at a time; the second sees the state left by the first.

**Acceptance test:** Both reproductions above as unit tests against `CycleOrchestrator`: after (a) `completedPhases.length === 1`; after (b) the same, and exactly one of the two calls reports a phase transition.

**Notes:** One option is a per-task promise chain plus a hash of the last accepted content stored in state. Do this before CYC-3; a terminal status is easier to guard once submissions are serialized.

### CYC-3 — A finished or aborted cycle is not terminal

**Severity:** medium · **Stage:** 2 · **Labels:** bug · **Status:** fixed in #6

**Where:** `src/core/orchestrator/cycleOrchestrator.ts` — completion paths at L236-242, L363-370 (`abort`), L429-436; `src/core/tools/cycleTool.ts` — `formatCompletionResponse()` L210 (static string).

**What happens:** The state record has no status field. After the seventh phase, and equally after `abort`, the cycle keeps accepting artifacts; `completedPhases` grows past seven. Both completion and abort render the same static text, so an aborted cycle reports "All 7 phases done".

**Reproduce:** Reflect with `decision: "abort"` on the first gate and read the response. Then submit another artifact to the same task ID.

**Expected:** State carries `status: 'active' | 'completed' | 'aborted'`. Any submission to a non-active cycle is rejected with that status in the message. The abort response says the cycle was aborted and at which phase.

**Acceptance test:** Abort at intake → response does not contain "7 phases"; subsequent `submitArtifact` returns `success: false` with `aborted` in the error.

**Notes:** Depends on CYC-2 for a clean guard. The registry entry (CYC-8) should also record the status.

### CYC-4 — Cycle state and artifact files can land in different projects

**Severity:** medium · **Stage:** 2 · **Labels:** bug · **Status:** fixed in #6

**Where:** `src/core/orchestrator/cycleOrchestrator.ts` — constructor L59-61 captures `cyclesDir` from `getProjectPath()` once; `submitArtifact()` L186 calls `getProjectPath()` again when writing the artifact file.

**What happens:** If the active project changes during the life of one server process, state JSON keeps going to the original project's `.m7/cycles/` while artifact Markdown files go to the new project. The two halves of one cycle then disagree about where they live.

**Reproduce:** Start a cycle, switch project (whatever mechanism `getProjectPath()` honors), submit an artifact, compare the two directories.

**Expected:** One cycle has one owner project, resolved once at `startCycle` and stored in state. Every later write uses the stored path.

**Acceptance test:** Unit test that stubs `getProjectPath()` to return A then B; both files end up under A.

### CYC-5 — One attempt counter serves two unrelated limits

**Severity:** medium · **Stage:** 2 · **Labels:** bug · **Status:** fixed in #6

**Where:** `src/core/orchestrator/cycleOrchestrator.ts` — `phaseAttempts` incremented for short artifacts at L166 and checked with `>= 3` at L170 (third short artifact is force-accepted); the same map incremented by `rewindToPhase()` at L466 and checked with `> 2` at L467.

**What happens:** Two different limits ("too many short artifacts" and "too many rewinds") share one counter per phase. Two rewinds into DISCOVERY followed by one short artifact triggers the forced transition on the first attempt. Separately, the third short artifact is accepted regardless of length — the loop guard turns a validation failure into a pass.

**Reproduce:** Submit a 10-character artifact three times. The third is accepted and the phase advances.

**Expected:** Separate counters (`shortArtifactAttempts`, `rewindCount`), and exhausting the short-artifact limit returns an error telling the client the cycle is stuck, rather than accepting invalid input.

**Acceptance test:** Three short submissions → third still returns `success: false`; rewinds do not affect the short-artifact counter.

### CYC-6 — Carry-forward picks the first reflection, not the latest

**Severity:** medium · **Stage:** 2 · **Labels:** bug, good first issue · **Status:** fixed in #6

**Where:** `src/core/orchestrator/cycleOrchestrator.ts` — `buildCarryForward()` L788: `state.reflections.find(r => r.phase === phase)`.

**What happens:** After a rewind, a phase has two reflections. The "Previous Phases" table shown to the client uses `find`, which returns the first (pre-rewind) one, so the context carried forward is the one that was explicitly revised away.

**Reproduce:** Complete DISCOVERY, rewind to it from a later gate, complete it again with a different summary; the table still shows the first summary.

**Expected:** The most recent reflection for each phase.

**Acceptance test:** Unit test with two reflections for one phase asserting the second summary appears in the generated instruction.

### CYC-7 — Re-submitting an artifact overwrites the previous file without trace

**Severity:** medium · **Stage:** 1 · **Labels:** bug, good first issue · **Status:** fixed in #6

**Where:** `src/core/orchestrator/cycleOrchestrator.ts` — `submitArtifact()` L195: `fs.writeFile(path.join(artifactsDir, filename), ...)`.

**What happens:** The artifact file for a phase is written with a fixed name. After a rewind (or after CYC-2's double-accept), the second submission replaces the first on disk. The earlier text — which the gate protocol treats as part of the record — is gone.

**Reproduce:** Submit DISCOVERY, rewind, submit a different DISCOVERY; only the second file exists.

**Expected:** Either the previous file is kept under a versioned name (`DISCOVERY.v1.md`) or the new content is appended with a separator and timestamp. Which one is a design choice for the issue; losing the first version is not.

**Acceptance test:** After two submissions for the same phase, both texts are recoverable from the artifact directory.

### CYC-8 — Registry append never deduplicates

**Severity:** low · **Stage:** 3 · **Labels:** bug, good first issue · **Status:** open

**Where:** `src/core/orchestrator/cycleOrchestrator.ts` — `appendToRegistry()` L989-1021.

**What happens:** Completing a cycle appends a row to `CYCLE_REGISTRY.md`, numbered `max + 1`. Nothing checks whether a row for the same task slug already exists, so completing twice (possible today because of CYC-3) or calling with a summary after the row was already written produces duplicate rows with different numbers.

**Reproduce:** Call the completion path twice for one task.

**Expected:** One row per task slug; a second completion updates that row instead of adding one.

**Acceptance test:** Unit test on a temp registry file: two completions → one row.

### CYC-9 — Cleanup deletes cycle state by age alone

**Severity:** high · **Stage:** 1 · **Labels:** bug · **Status:** fixed in #6

**Where:** `src/core/orchestrator/cycleOrchestrator.ts` — `cleanupOldCycles()` L67-91: any `.json`/`.jsonl` in `cyclesDir` with `mtime` older than 7 days is unlinked; called from `startCycle()` at L100.

**What happens:** The cleanup does not look at the cycle's state. A cycle that was last touched eight days ago and is still at phase 4 is deleted the next time *any* cycle is started; the next `submitArtifact` for it returns "not found". The artifact Markdown files remain, so the project directory shows a half-finished cycle whose state no longer exists.

**Reproduce:** Create cycle A, set its state file's mtime back nine days (`touch -d`), start cycle B, submit an artifact to A.

**Expected:** Only cycles whose state is `completed`/`aborted` (after CYC-3) are eligible for age-based cleanup. Active cycles are kept, or at minimum archived rather than unlinked, with a log line at `warn`, not `debug`.

**Acceptance test:** Old-but-active state file survives `cleanupOldCycles()`; old-and-completed one does not.

## Persisted state (`STATE-*`)

### STATE-1 — Failed state write is reported as success; backups are never consulted for corrupt files

**Severity:** high · **Stage:** 1 · **Labels:** bug, help wanted · **Status:** open

**Where:** `src/core/orchestrator/cycleOrchestrator.ts` — `saveState()` L968-977 catches every error and logs at `warn`; `src/core/utils/atomicWrite.ts` — `safeRead()` L335-358 falls back to `.bak` files only when the main file cannot be *read*; `safeReadJSON()` L364-378 returns an error on parse failure without trying backups.

**What happens:** (a) If writing `.m7/cycles/<id>.json` fails (permissions, full disk, path from CYC-4 not existing), the in-memory map is still updated and the client receives a normal success response. The next server start has no record of the cycle. (b) If the state file exists but is truncated or corrupt, parse fails and the existing backups are not tried, so the backup mechanism never helps in the case it was built for.

**Reproduce:** (a) Make `cyclesDir` read-only, submit an artifact, observe `success: true`, restart, observe "not found". (b) Truncate a state file to half its length with a valid `.bak.1` next to it; load fails.

**Expected:** (a) `saveState` propagates the error; the tool response reports that state was not persisted and the in-memory state is not advanced. (b) A parse error on the main file triggers the same backup walk as a read error.

**Acceptance test:** (a) `submitArtifact` with an unwritable directory returns `success: false` and `completedPhases` is unchanged. (b) `safeReadJSON` on a corrupt main file with a valid backup returns the backup's data with `recoveredFrom` set.

**Notes:** This is the "write, then respond" principle. MEM-3 and CYC-7 should reuse whatever error type this introduces. The README promises durable state; this item is what makes that promise true.

### STATE-2 — `complete_session` has no phase guard

**Severity:** high · **Stage:** 1 · **Labels:** bug · **Status:** open

**Where:** `src/core/orchestrator/taskOrchestrator.ts` — `completeSession()` L812-818 sets `currentPhase = 'completed'` unconditionally; `isPhaseCompleted()` L506-509 uses `every()` over `getPhaseRequirements()`, which returns `[]` for phases other than discovery/architecture/planning, so `every([])` is `true`; `src/core/tools/unified/sessionTool.ts` L252-258 exposes this as `mcp_m7_session action="complete_session"`.

**What happens:** This is the session tool, not the cycle tool, but it is public and its completion is the stronger of the two. Any session can be marked complete from any phase with no requirements checked; and for phases with no declared requirements, the "is this phase done" check is vacuously true.

**Reproduce:** Create a session, immediately call `complete_session`. Response: "Session Completed Successfully".

**Expected:** `completeSession` refuses unless the session's current phase is the last one and its requirements are met, or an explicit `force` flag is passed and recorded in the session. `isPhaseCompleted` returns `false` for phases with no declared requirements, or those phases get requirements.

**Acceptance test:** `completeSession` on a fresh session returns `false`; with `force: true` it returns `true` and the session records `forcedCompletion`.

## Memory (`MEM-*`)

### MEM-0 — Tracking: one read path for memory

**Severity:** medium · **Stage:** 2 · **Labels:** bug, help wanted · **Status:** open

**Where:** `src/memory/auto/unified-memory-core.ts` — `search()` L589-600 iterates `recordStore` only; `indexReferenceFiles()` L655-660 indexes `CYCLE_REGISTRY.md` as an L2 record; `get()` L745 skips the `project` level when falling back to `MemorySystem`.

**What happens:** The unified core has two stores that are consulted differently depending on the operation and on whether the process is warm. Four symptoms, one root:

- [ ] **MEM-0a** A record deleted through the memory tool comes back after restart, because the Markdown mirror (`CYCLE_REGISTRY.md`, `INDEX.md`) is re-indexed as a fresh L2 record with confidence 0.9.
- [ ] **MEM-0b** `contradicts` returns a different confidence for the same pair depending on whether the records were loaded from disk or created in this process (0.54 vs 0.90 observed).
- [ ] **MEM-0c** `levels` and `confidenceThreshold` filters apply to `recordStore` but a Markdown-mirrored record bypasses them.
- [ ] **MEM-0d** L4 (`project`-level) records written before a restart cannot be fetched by ID afterwards, because the fallback loop excludes that level.

**Reproduce:** Each sub-item separately; the shortest is MEM-0d: `store` at level `project`, restart, `get` by ID → null.

**Expected:** One function answers "what is the record with this ID / matching this query", and every tool action goes through it. Markdown mirrors are indexed with provenance (`source: 'mirror'`) and lower confidence than a direct store, and an explicit delete is remembered across restarts (tombstone or exclusion list).

**Acceptance test:** One test per sub-item, all asserting the same thing from different angles: the result before restart equals the result after restart.

**Notes:** Do not patch the four symptoms separately. If you take this on, open the issue with a short description of the proposed read path before coding.

### MEM-1 — `invalidate_bulk` mutates in memory only

**Severity:** high · **Stage:** 1 · **Labels:** bug, good first issue · **Status:** fixed in #6

**Where:** `src/core/tools/unified/memoryTool.ts` — `case 'invalidate_bulk'` L826-838: sets `confidence *= 0.3` and `invalidatedAt` on the fetched record and never calls a persist/update method.

**What happens:** The tool responds "Invalidated: N/N records". After restart the records are back at their original confidence (0.9 → 0.27 → 0.9 observed). An invalidation that does not survive a restart is the opposite of what the action name promises.

**Reproduce:** `invalidate_bulk` on a stored record, restart, `get` the record.

**Expected:** Each invalidated record is written back through the same path `store`/`update` uses; the response reflects how many were persisted.

**Acceptance test:** After `invalidate_bulk` and a reload from disk, `confidence` is the reduced value and `invalidatedAt` is set.

### MEM-2 — Confidence `0` becomes `0.5` on load

**Severity:** high · **Stage:** 1 · **Labels:** bug, good first issue · **Status:** fixed in #6

**Where:** `src/memory/auto/unified-memory-core.ts` — `convertToRecord()` L1248: `confidence: data.confidence || 0.5`.

**What happens:** `||` treats `0` as missing. A record stored with confidence 0 (explicitly refuted) is loaded as 0.5, which the status mapping reports as ASSUMED. A fact the system was told is false reappears as a plausible assumption.

**Reproduce:** Store with `confidence: 0`, restart, `get`.

**Expected:** `data.confidence ?? 0.5` (and the same audit for the other `||` defaults in that block where `0` is a valid value).

**Acceptance test:** Round-trip of a confidence-0 record preserves 0.

### MEM-3 — Pending memory writes are dropped on shutdown

**Severity:** high · **Stage:** 1 · **Labels:** bug · **Status:** open

**Where:** `src/memory/memorySystem.ts` — `FLUSH_DELAY_MS = 1000` L52 (debounced writes in `pendingWrites`); `src/index.ts` — `gracefulExit()` L19-23 calls `process.exit(0)` directly, registered for `SIGTERM`/`SIGINT` and for stdin `end`/`close` at L163-166.

**What happens:** Writes are buffered for up to a second. When the client closes the connection (IDE restart, window close), the server exits immediately and whatever is in the buffer is lost. Reproduced with an immediate `client.close()` after a `store` call: the record is absent after restart.

**Reproduce:** `store`, then close the transport within a second; restart; `get`.

**Expected:** `gracefulExit` awaits a flush of `pendingWrites` (the existing `flushPendingWrites()`, with a short timeout) before calling `process.exit`. All five registered paths go through the same function, so one change covers them.

**Acceptance test:** Integration test: store, send SIGTERM, start again, record is present.

**Notes:** Same principle as STATE-1. Keep the debounce; just drain it on the way out.

### MEM-4 — Loading more than 2000 long-term records evicts and then rewrites the file

**Severity:** high · **Stage:** 1 · **Labels:** bug · **Status:** fixed in #6

**Where:** `src/memory/memorySystem.ts` — `longterm: new BoundedMap(2000)` L66; `loadPersisted()` L195-203 does `clear()` then `set()` for every entry in the file.

**What happens:** `BoundedMap` evicts on insert. If `longterm.json` on disk holds more than 2000 entries, loading it silently drops the oldest ones; the next debounced flush writes the truncated map back to the same file. The data is gone after one restart with no log line.

**Reproduce:** Write a `longterm.json` with 2100 entries, start the server, trigger any write, inspect the file: 2000 entries.

**Expected:** Loading never discards persisted data silently. Options: raise the bound, make the bound apply to in-process inserts only, or refuse to overwrite a file that is larger than what was loaded and log at `error`.

**Acceptance test:** Round-trip of a 2100-entry file preserves 2100 entries (or the server logs an error and leaves the file untouched).

## Task graph and transfer (`GRAPH-*`)

### GRAPH-1 — Depth-limited DFS marks nodes visited at the wrong depth

**Severity:** medium · **Stage:** 2 · **Labels:** bug, good first issue · **Status:** open

**Where:** `src/core/task-graph/taskGraphManager.ts` — `getSubgraph()` L300-302: `if (depth < 0 || visited.has(nodeId)) return; visited.add(nodeId);`.

**What happens:** Classic depth-limited traversal bug. A node first reached at the depth limit is marked visited with no remaining budget; when the same node is reached later via a shorter path, it is skipped, and its children are never expanded. The returned subgraph misses nodes that are within the requested depth.

**Reproduce:** Graph `A→B→C`, `A→C`, depth 1 from A with edges ordered so `A→B→C` is walked first: `C` is visited at depth 0, then skipped on the direct edge; any children of `C` are missing at depth 2.

**Expected:** Track the best depth at which each node was seen (`Map<nodeId, depth>`), and re-expand if reached with more remaining depth; or use BFS.

**Acceptance test:** The diamond graph above returns all reachable nodes within depth.

### GRAPH-2 — Transfer task IDs can collide and overwrite

**Severity:** low · **Stage:** 2 · **Labels:** bug, good first issue · **Status:** open

**Where:** `src/core/task-transfer/transferManager.ts` L192: ``task_${slugify(description)}_${Date.now().toString().slice(-4)}``.

**What happens:** The suffix is the last four digits of the millisecond clock, so it repeats every ten seconds. Two transfers with the same description within that window produce the same ID, and `createTask` does not check for existence, so the second overwrites the first in the graph. (The cycle ID in HYG-1 uses six digits and is much less exposed; this one is the real collision.)

**Reproduce:** Two transfers with the same description where `Date.now() % 10000` matches (easy to force in a test with a clock stub).

**Expected:** IDs that cannot collide in practice (random suffix or a counter), and `createTask` refusing to overwrite an existing ID.

**Acceptance test:** Two transfers with identical descriptions and a frozen clock produce two distinct tasks.

### GRAPH-3 — Failed transfer leaves an orphan task

**Severity:** medium · **Stage:** 2 · **Labels:** bug · **Status:** open

**Where:** `src/core/task-transfer/transferManager.ts` L196-215: `createTask` → `updateTaskStatus(from, 'transferred')` → `createLink`; the `catch` at the end returns `success: false` without undoing earlier steps.

**What happens:** If any step after `createTask` throws, the new task exists in the graph with no link and the old one may or may not be marked transferred. There is no rollback. The graph ends up describing a transfer that did not happen.

**Reproduce:** Stub `createLink` to throw; inspect the graph.

**Expected:** Either the steps are applied as one atomic graph update, or the catch block removes the new task and restores the old status.

**Acceptance test:** With `createLink` throwing, the graph after the call equals the graph before it.

## Gates and output (`GATE-*`)

### GATE-1 — Grounding treats `path:` references as memory lookups, not file checks

**Severity:** medium · **Stage:** 2 · **Labels:** bug · **Status:** open

**Where:** `src/core/orchestrator/groundingGate.ts` — `resolveRef()` L154-160: a `path:` prefix is looked up in fog-of-war entries only.

**What happens:** A premise like `{ "ref": "path:src/foo.ts" }` is reported NOT_FOUND whenever the file has not been recorded in fog-of-war, regardless of whether it exists on disk. In practice, every `path:` premise that refers to a file the model read directly (rather than through a memory action) is flagged, so the "soft warning" is permanently on and stops carrying information.

**Reproduce:** Submit a solution with a `path:` premise pointing at an existing file that has no fog entry; the grounding report shows NOT_FOUND.

**Expected:** `path:` references check the filesystem (relative to the project path) and report FOUND/NOT_FOUND on that basis; fog-of-war adds freshness information on top, if available.

**Acceptance test:** Premise with `path:` to an existing file and no fog entry → FOUND; to a nonexistent file → NOT_FOUND.

### GATE-2 — Irreversible steps with no premises raise no warning

**Severity:** medium · **Stage:** 2 · **Labels:** bug, good first issue · **Status:** open

**Where:** `src/core/orchestrator/groundingGate.ts` — step loop L229-230 iterates `step.premise_ids`; an empty array produces no iterations and therefore no warning.

**What happens:** The gate's stated purpose is to require grounded premises for irreversible steps. A step declared `reversibility: "irreversible"` with `premise_ids: []` passes with zero warnings.

**Reproduce:** Solution artifact with one irreversible step and an empty `premise_ids`.

**Expected:** An irreversible step with no premises is a strong warning on its own.

**Acceptance test:** The above artifact produces one `strong` warning naming the step.

### GATE-3 — Response noise: gate prompt repeated, error banner without a source

**Severity:** low · **Stage:** 3 · **Labels:** enhancement, good first issue · **Status:** open

**Where:** Gate text is generated at `src/core/orchestrator/cycleOrchestrator.ts` L563 (goal), L580 (instruction body), and again in `src/core/tools/cycleTool.ts` L168-174 (`gateSection`), so the full gate prompt appears up to three times in one response. `src/core/utils/hintGenerator.ts` L83-95 appends "Runtime errors increasing - add more error handling" whenever `recentErrors[0].count > 2`, with no indication of which errors or where.

**What happens:** A typical gate response is several hundred lines, most of it repeated; the actionable part (the gate ID and the JSON shape) appears three times. The error banner appears on every response once the counter is tripped and never says what to look at.

**Expected:** Gate prompt rendered once. The banner either names the error category and a count with a pointer to the error database, or is dropped.

**Acceptance test:** Response for one gate contains the string `Gate-ID:` exactly once; banner, if present, includes the source.

## Hygiene and documentation (`HYG-*`)

### HYG-1 — Task IDs: non-Latin descriptions produce an empty slug

**Severity:** low · **Stage:** 3 · **Labels:** bug, good first issue · **Status:** open

**Where:** `src/core/orchestrator/cycleOrchestrator.ts` — `generateTaskId()` L933-938: `.replace(/[^a-z0-9\s-]/g, '')` then `slice(0, 20)` plus six clock digits.

**What happens:** For a description with no Latin letters (Cyrillic, CJK, …) the slug is empty and the ID is `cycle__123456`. All such cycles differ only in the six-digit clock suffix, which repeats every ~17 minutes. The same slug feeds the artifact directory name, so unrelated cycles can share a folder.

**Reproduce:** `startCycle('Исправить баг')` → ID `cycle__NNNNNN`.

**Expected:** Transliterate or hash the description for the slug, and use a suffix that does not depend on the clock alone.

**Acceptance test:** Two non-Latin descriptions produce distinct, non-empty slugs.

### HYG-2 — Hive result cache key collapses non-Latin and order-sensitive tasks

**Severity:** medium · **Stage:** 2 · **Labels:** bug · **Status:** open

**Where:** `src/hive/cache/taskResultCache.ts` — `hashTask()` L76-86: `.replace(/[^\w\s]/g, ' ')` (no `u` flag), `.sort()`, `.join(' ')`.

**What happens:** Two effects. (a) `\w` without the `u` flag matches ASCII only, so a non-Latin task normalizes to the empty string and *every* such task shares one cache key — a cached result for one task is returned for any other. (b) Sorting the words discards order and direction: "move A to B" and "move B to A" hit the same entry.

**Reproduce:** (a) `hashTask('Исправить баг') === hashTask('Добавить тест')`. (b) The two English phrases above.

**Expected:** Unicode-aware normalization (`\p{L}\p{N}` with `u`) and no word sorting; if fuzzy matching is wanted, do it at lookup time with a similarity threshold, not by destroying the key.

**Acceptance test:** Both pairs above produce distinct hashes.

### HYG-3 — Shell command built by string interpolation

**Severity:** low · **Stage:** 3 · **Labels:** enhancement, good first issue · **Status:** open

**Where:** `src/hive/context/fileSearcher.ts` L44: `` `grep -r -c -i "${keyword}" ... "${projectPath}"` `` passed to `exec`; `keyword` is sanitized upstream by `src/hive/context/keywordExtractor.ts` L71 (`[^a-z0-9_\-\s]` stripped); `projectPath` comes from the process environment.

**What happens:** Both interpolated values are controlled by the server's own configuration, so there is no demonstrated path for an outside party to influence them. It is still a shell string assembled by hand, which is the kind of code that becomes a problem the first time someone adds a new input to it.

**Expected:** `execFile('grep', [args...])` with an argument array, no shell.

**Acceptance test:** A project path containing a space and a double quote is searched correctly.

### HYG-4 — Debug tool prints API key prefixes

**Severity:** low · **Stage:** 3 · **Labels:** enhancement, good first issue · **Status:** open

**Where:** `src/test-tool.ts` L32-33: `openaiKey.substring(0, 15)` and `anthropicKey.substring(0, 15)` in the tool response.

**What happens:** `mcp_m7_test_tool` returns the first 15 characters of two API keys to whoever calls it. The caller is the owner of the environment those keys live in, so this is not a disclosure to a third party; it is an early debugging aid that should not be in a release.

**Expected:** Remove the tool, or reduce the output to present/absent.

**Acceptance test:** Tool list does not contain `mcp_m7_test_tool`, or its output contains no substring of the key values.

### HYG-5 — README describes rule re-injection as counting "tool calls"

**Severity:** low · **Stage:** 3 · **Labels:** documentation, good first issue · **Status:** open

**Where:** `README.md` L24 and L129 ("after N tool calls", `M7_RULE_REINJECTION_THRESHOLD`); `src/core/orchestrator/ruleReinjection.ts` L1-4 counts `mcp_m7_cycle` calls only.

**What happens:** An MCP server only sees calls to its own tools; it cannot count calls the client makes to other servers or to built-in tools. The code is correct about this. The README wording suggests otherwise.

**Expected:** README says "after N `mcp_m7_cycle` calls in the same phase".

**Acceptance test:** Documentation change; no test.

### HYG-6 — `M7CodeInterceptor` is dead code

**Severity:** low · **Stage:** 3 · **Labels:** enhancement, good first issue · **Status:** open

**Where:** `src/core/enforcement/codeInterceptor.ts` L31: `export class M7CodeInterceptor`; no other file under `src/` references it.

**What happens:** The class is exported and never instantiated. Its presence has been read as a promise of server-side code enforcement that the server does not and cannot provide (an MCP server does not see the client's file writes).

**Expected:** Remove the file, or move it to an `experimental/` location with a one-line note in its header about why it is not wired in.

**Acceptance test:** `tsc` passes after removal; no tool behavior changes.

## Not on this list

A few things from the same review are deliberately not here, so that nobody spends time on them expecting a merge.

- **Making the adversarial review gate blocking.** It is a soft warning by design (`src/core/orchestrator/adversarialGate.ts` L63-66 says so in the text it emits). The thing worth fixing in that area is GATE-2.
- **Renaming the grounding gate** because it checks reference existence rather than claim truth. The name stays; the behavior gap worth fixing is GATE-1.
- **Server-side enforcement of what the client writes to disk.** The MCP protocol does not give a server visibility into the client's tool calls or file writes. Anything that reads as a promise of that in the docs is a documentation issue (HYG-5, HYG-6), not a missing feature.
- **Cycle-ID collision for Latin descriptions.** Six clock digits plus a 20-character slug would need two cycles with the same slug started in the same millisecond modulo 10⁶. The real issue in that function is the empty slug for non-Latin input (HYG-1), and the real collision is GRAPH-2.

## Maintaining this file

- A PR that fixes an item changes its `Status` in both the summary table and the item heading block to `fixed in #NN`. Items are not removed.
- If you find a new confirmed defect, add it under the matching root with the same template, and add a row to the summary table. "Confirmed" means: a reproduction that someone else can run.
- When line numbers have drifted far enough to be unhelpful, update the commit hash in the header and the numbers together, in one PR that changes nothing else.
