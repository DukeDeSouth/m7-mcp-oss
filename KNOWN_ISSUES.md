# Known issues and fix roadmap

This is the list of confirmed defects in m7-mcp-oss, each tied to a specific place in the code, with a suggested order for fixing them. It exists so that anyone who wants to contribute can pick something concrete without first re-discovering the problem.

Line numbers refer to commit `72a7640` (the initial public release). After a fix lands, the numbers will drift; the function and symbol names next to them should still be enough to find the spot.

Most items come from "Deep Scan M7", an independent source-level review of the `72a7640` snapshot by [@DiadkoShmek](https://github.com/DiadkoShmek) (October 28, 2026). Every item was re-verified against the code before being listed here, and a few came from running the server rather than reading it. "Review findings" near the end maps every numbered finding of the review to the items that cover it. Parts of findings that describe design choices rather than defects are not on this list; "Not on this list" explains each of them. Review context and the first response sprint: [docs/COMMUNITY_SPRINT.md](docs/COMMUNITY_SPRINT.md) (community review triage; implementation by [DukeDeSouth/m7-mcp-oss](https://github.com/DukeDeSouth/m7-mcp-oss) maintainers; [DiadkoShmek](https://github.com/DiadkoShmek) on GitHub).

## How to pick one up

1. Open a GitHub issue with the item ID in the title (for example `CYC-1: unparseable reflection auto-continues`). That is how we avoid two people working on the same thing.
2. Follow [CONTRIBUTING.md](CONTRIBUTING.md): a bug fix needs a test that fails before the change and passes after it. The "Acceptance test" line under each item is the minimum that test should cover. A suggested approach for each item — which functions to touch, which test file, what to watch out for — is in [docs/FIX_PLAN.md](docs/FIX_PLAN.md).
3. In the PR, change the item's status in this file (`open` → `fixed in #NN`). Keep the item; do not delete it.

Items marked `good first issue` are self-contained and need no knowledge of the rest of the system. Items marked `help wanted` are larger or touch shared code and benefit from a design note in the issue before coding.

## Severity scale

- **high** — silent loss or corruption of persisted data, the server reports success for something it did not do, or tool input can run commands on the host.
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
| CYC-8 | Registry append never deduplicates | low | 3 | bug, good first issue | fixed (local v3.21.1) |
| CYC-9 | Cleanup deletes cycle state by age alone | high | 1 | bug | fixed in #6 |
| CYC-10 | Cycles with the same description share one artifact folder | medium | 1 | bug | fixed (local v3.22.1) |
| STATE-1 | Failed state write is reported as success; backups are never consulted for corrupt files | high | 1 | bug, help wanted | fixed in #5 |
| STATE-2 | `complete_session` has no phase guard | high | 1 | bug | fixed in #5 |
| STATE-3 | Task sessions are lost on exit and invisible right after start | high | 1 | bug | fixed (local v3.22.1) |
| STATE-4 | Cross-session knowledge and other project state follow `process.cwd()` | high | 1 | bug | fixed (local v3.22.1) |
| STATE-5 | The contract registry reports success and keeps almost nothing | high | 1 | bug | fixed (local v3.22.1) |
| MEM-0 | Tracking: one read path for memory | medium | 2 | bug, help wanted | fixed (local v3.20.0) |
| MEM-1 | `invalidate_bulk` mutates in memory only | high | 1 | bug, good first issue | fixed in #6 |
| MEM-2 | Confidence `0` becomes `0.5` on load | high | 1 | bug, good first issue | fixed in #6 |
| MEM-3 | Pending memory writes are dropped on shutdown | high | 1 | bug | fixed in #5 |
| MEM-4 | Loading more than 2000 long-term records evicts and then rewrites the file | high | 1 | bug | fixed in #6 |
| MEM-5 | Runtime eviction from bounded collections deletes records from disk | high | 1 | bug | fixed (local v3.22.1) |
| MEM-6 | Every schema read stores another copy of the schema in long-term memory | high | 1 | bug, good first issue | fixed (local v3.22.1) |
| MEM-7 | Memory flushes overlap and are not awaited, so writes are lost | high | 1 | bug, help wanted | fixed (local v3.22.1) |
| GRAPH-1 | Depth-limited DFS marks nodes visited at the wrong depth | medium | 2 | bug, good first issue | fixed (local v3.21.0) |
| GRAPH-2 | Transfer task IDs can collide and overwrite | low | 2 | bug, good first issue | fixed (local v3.21.0) |
| GRAPH-3 | Failed transfer leaves an orphan task | medium | 2 | bug | fixed (local v3.22.1) |
| GATE-1 | Grounding treats `path:` references as memory lookups, not file checks | medium | 2 | bug | fixed (local v3.20.1) |
| GATE-2 | Irreversible steps with no premises raise no warning | medium | 2 | bug, good first issue | fixed (local v3.21.0) |
| GATE-3 | Response noise: gate prompt repeated, error banner without a source | low | 3 | enhancement, good first issue | fixed (local v3.22.0) |
| HYG-1 | Task IDs: non-Latin descriptions produce an empty slug | low | 3 | bug, good first issue | fixed (local v3.22.1) |
| HYG-2 | Hive result cache key collapses non-Latin and order-sensitive tasks | medium | 2 | bug | fixed (local v3.21.0) |
| HYG-3 | Shell command built by string interpolation | low | 3 | enhancement, good first issue | fixed (local v3.22.0) |
| HYG-4 | Debug tool prints API key prefixes | low | 3 | enhancement, good first issue | fixed (local v3.22.1) |
| HYG-5 | README describes rule re-injection as counting "tool calls" | low | 3 | documentation, good first issue | fixed (local v3.22.0) |
| HYG-6 | `M7CodeInterceptor` is dead code | low | 3 | enhancement, good first issue | fixed (local v3.22.0) |
| HYG-7 | Architecture context search runs task text through a shell | high | 2 | bug | fixed (local v3.22.1) |
| HYG-8 | Server reports version 2.0.0 regardless of the package version | low | 3 | bug, good first issue | fixed (local v3.22.1) |
| HYG-9 | `analyze_task` runs `docker compose up -d` on a compose file from the working directory | medium | 2 | bug | fixed (local v3.22.1) |
| HYG-10 | Unreachable modules keep defects that the live paths no longer have | low | 3 | enhancement, good first issue | fixed (local v3.22.1) |
| HYG-11 | `require()` in ES modules throws, and the surrounding `catch` hides it | low | 3 | bug, good first issue | fixed (local v3.22.2) |

## Roadmap

The order below is driven by dependencies more than by severity. Each stage has a one-line "done when".

### Stage 1 — nothing is lost silently

Done when: every write the server reports as successful is on disk, and the server never advances state on input it could not understand.

Order: STATE-1 → MEM-3 → STATE-3 → STATE-4 → STATE-5 → MEM-1 → MEM-2 → CYC-1 → STATE-2 → CYC-9 → CYC-7 → CYC-10 → MEM-4 → MEM-5 → MEM-6 → MEM-7.

STATE-1 and MEM-3 share one principle: write, then respond. Fixing STATE-1 first gives you the error path that MEM-3 and CYC-7 then reuse. STATE-3 is MEM-3 for task sessions: it plugs into the shutdown flush MEM-3 introduces. STATE-4 right after it: both are about which project a write belongs to. STATE-5 is STATE-1 for the contract registry. CYC-1 changes a tested behavior (see the item), so the test change should be part of the PR, not a follow-up. CYC-10 after CYC-7: once a resubmission is kept, the only way left to lose a cycle's history is another cycle writing into the same folder. MEM-4 → MEM-5 → MEM-6 → MEM-7 go together: MEM-4 and MEM-5 are the same bound seen at load and at run time, MEM-6 removes the largest source of writes, and MEM-7 makes the remaining writes land in order.

### Stage 2 — the server does what it says

Done when: the cycle protocol has one state per call, one call per state, and memory reads return the same record regardless of how it was loaded.

Order: HYG-7 → HYG-9 → CYC-2 → CYC-3 → CYC-5 → CYC-6 → CYC-4 → MEM-0 → GATE-1 → GATE-2 → GRAPH-1 → GRAPH-3 → GRAPH-2 → HYG-2.

HYG-7 first: it is the only item where tool input reaches a shell, and it is independent of everything else. HYG-9 next for the same reason: a normal tool call should not start anything on the host. CYC-2 before CYC-3: once submissions are serialized and deduplicated, a terminal status field is a small addition; the other way round you end up guarding the status field against races. MEM-0 is a tracking item: its four sub-points have one root and should be fixed by one change to the read path, not by four patches.

### Stage 3 — hygiene and documentation

Done when: no dead code paths, no misleading output, README matches behavior.

Order: HYG-1, HYG-3, HYG-4, HYG-5, HYG-6, HYG-8, HYG-10, HYG-11, GATE-3, CYC-8 — independent of each other, any order.

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

**Notes:** One option is a per-task promise chain plus a hash of the last accepted content stored in state. Do this before CYC-3; a terminal status is easier to guard once submissions are serialized. Follow-up in 3.22.1: the replay check also required the same phase and kind, but after an accepted reflection the phase has moved on and `cycleTool` routes the retried JSON to `submitArtifact`, so a retried reflection became the next phase's artifact. Replay now matches on the content hash alone.

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

**Severity:** low · **Stage:** 3 · **Labels:** bug, good first issue · **Status:** fixed (local v3.21.1)

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

**Notes:** The cleanup itself still ran in the directory captured by the constructor, so after a project switch (CYC-4) archiving happened in the old project only. Since 3.22.1 it runs in the project of the cycle being started (found with CYC-10).

### CYC-10 — Cycles with the same description share one artifact folder

**Severity:** medium · **Stage:** 1 · **Labels:** bug · **Status:** fixed (local v3.22.1)

**Where:** `src/core/orchestrator/cycleOrchestrator.ts` — `startCycle()` L101-102 derives the task ID (`generateTaskId()` L931) and the folder name (`generateSlug()` L941) from the description independently; L143-144 and L186 build `m7-cycles/<taskSlug>` with `mkdir({ recursive: true })`, which succeeds on an existing folder; `submitArtifact()` L195 writes the phase file by its fixed name; nothing checks whether the ID is already in use.

**What happens:** The ID has a random part, the folder name does not. Two cycles with the same description (a retried task, two agents given the same instruction, a template) get different IDs and one folder. At 72a7640 the second cycle's `INTAKE.md` replaced the first one's. After CYC-7 it is appended to the first cycle's file as a "resubmission", and after CYC-8 the second cycle's registry row replaces the first one's, because rows are matched by folder. Each cycle's state is intact; its evidence is mixed with another cycle's.

**Reproduce:** `startCycle('Fix the parser')` twice, submit INTAKE to both: one folder, one `INTAKE.md` containing both texts, one registry row after both complete. Twenty parallel starts with one description: twenty IDs, one folder.

**Expected:** The folder is derived from the cycle's identity: `m7-cycles/<slug>-<ID suffix>/`. Starting a cycle reserves the ID and creates the folder exclusively; a taken ID or folder means another suffix is tried, and when none is free the start fails instead of sharing. A cycle whose state predates the suffix keeps its folder.

**Acceptance test:** Two cycles with one description → two folders, each `INTAKE.md` with its own text only, two registry rows; 20 parallel starts → 20 folders; a pre-existing folder or an ID in use is skipped; all suffixes taken → start rejects and leaves no state behind; a legacy state without the suffix still writes to its folder; a start whose state cannot be written leaves no folder.

**Notes:** This is review finding F07. Our first response rated F07 as overstated ("needs the clock forced"), and this file listed it under "Not on this list" as a Latin-only collision. Both were wrong: the review's sequential scenario needs no clock at all, and HYG-1 fixed only the ID. The folder name keeps the readable slug and gains the last six characters of the ID, which are already random (HYG-1).

## Persisted state (`STATE-*`)

### STATE-1 — Failed state write is reported as success; backups are never consulted for corrupt files

**Severity:** high · **Stage:** 1 · **Labels:** bug, help wanted · **Status:** fixed in #5

**Where:** `src/core/orchestrator/cycleOrchestrator.ts` — `saveState()` L968-977 catches every error and logs at `warn`; `src/core/utils/atomicWrite.ts` — `safeRead()` L335-358 falls back to `.bak` files only when the main file cannot be *read*; `safeReadJSON()` L364-378 returns an error on parse failure without trying backups.

**What happens:** (a) If writing `.m7/cycles/<id>.json` fails (permissions, full disk, path from CYC-4 not existing), the in-memory map is still updated and the client receives a normal success response. The next server start has no record of the cycle. (b) If the state file exists but is truncated or corrupt, parse fails and the existing backups are not tried, so the backup mechanism never helps in the case it was built for.

**Reproduce:** (a) Make `cyclesDir` read-only, submit an artifact, observe `success: true`, restart, observe "not found". (b) Truncate a state file to half its length with a valid `.bak.1` next to it; load fails.

**Expected:** (a) `saveState` propagates the error; the tool response reports that state was not persisted and the in-memory state is not advanced. (b) A parse error on the main file triggers the same backup walk as a read error.

**Acceptance test:** (a) `submitArtifact` with an unwritable directory returns `success: false` and `completedPhases` is unchanged. (b) `safeReadJSON` on a corrupt main file with a valid backup returns the backup's data with `recoveredFrom` set.

**Notes:** This is the "write, then respond" principle. MEM-3 and CYC-7 should reuse whatever error type this introduces. The README promises durable state; this item is what makes that promise true.

### STATE-2 — `complete_session` has no phase guard

**Severity:** high · **Stage:** 1 · **Labels:** bug · **Status:** fixed in #5

**Where:** `src/core/orchestrator/taskOrchestrator.ts` — `completeSession()` L812-818 sets `currentPhase = 'completed'` unconditionally; `isPhaseCompleted()` L506-509 uses `every()` over `getPhaseRequirements()`, which returns `[]` for phases other than discovery/architecture/planning, so `every([])` is `true`; `src/core/tools/unified/sessionTool.ts` L252-258 exposes this as `mcp_m7_session action="complete_session"`.

**What happens:** This is the session tool, not the cycle tool, but it is public and its completion is the stronger of the two. Any session can be marked complete from any phase with no requirements checked; and for phases with no declared requirements, the "is this phase done" check is vacuously true.

**Reproduce:** Create a session, immediately call `complete_session`. Response: "Session Completed Successfully".

**Expected:** `completeSession` refuses unless the session's current phase is the last one and its requirements are met, or an explicit `force` flag is passed and recorded in the session. `isPhaseCompleted` returns `false` for phases with no declared requirements, or those phases get requirements.

**Acceptance test:** `completeSession` on a fresh session returns `false`; with `force: true` it returns `true` and the session records `forcedCompletion`.

### STATE-3 — Task sessions are lost on exit and invisible right after start

**Severity:** high · **Stage:** 1 · **Labels:** bug · **Status:** fixed (local v3.22.1)

**Where:** `src/core/orchestrator/taskOrchestrator.ts` — `schedulePersist()` L144-150 (500 ms debounce, nothing drains it), `getSessionsFilePath()` L86-89 (resolves `getProjectPath()` on every call), constructor L77 (`loadSessions()` started and not awaited), `getSessionStatus()` / `getAllActiveSessions()` L659-669 (synchronous reads of the in-memory map); `src/index.ts` L173 and L181-188 (orchestrator created, then replaced on project switch without a flush); synchronous readers on tool paths: `src/core/tools/unified/sessionTool.ts` L61-129, `src/core/tools/analyzeTask.ts` L486.

**What happens:** Three effects, one root: session persistence is asynchronous on both ends and nobody waits for it. (a) `mcp_m7_analyze_task` reports a new session; the write is debounced, MEM-3's shutdown flush does not know about it, so an exit within 500 ms drops the session. (b) The sessions file path is recomputed on each write, so a debounced write that fires after a project switch lands in the new project. (c) After a start, the first tool call can run before the constructor's `loadSessions()` has read the file; `status` then reports a persisted session as "not found", and the reuse check in `analyze_task` sees no sessions.

**Reproduce:** (a) Real server: `analyze_task`, SIGTERM at once, `.m7/orchestrator-sessions.json` is absent. (b) Create a session in project A, switch the active project to B before the debounce fires, the file appears under B. (c) Write a sessions file, construct a `TaskOrchestrator` and call `unifiedSessionTool.handler({ action: 'status', session_id })` without awaiting anything: "not found".

**Expected:** (a) Every debounced store registers a shutdown contributor that drains it. (b) The file path is fixed when the orchestrator is created; the server flushes the old orchestrator before replacing it. (c) Readers on tool paths wait for the initial load before reading.

**Acceptance test:** Real server: `analyze_task`, SIGTERM, file present, `status` after restart finds the session; `m7://session` read as the first request after restart lists it. In-process: fresh orchestrator over an existing file answers `status` correctly on the first call; an orchestrator built for A still writes to A after the active project changes.

**Notes:** Found by the deep scan acceptance suite, not by the review. Fixed by `flushPersist()` registered via `registerShutdownContributor`, a `sessionsFilePath` field set in the constructor, and a public `ready()` awaited at the tool entry points.

### STATE-4 — Cross-session knowledge and other project state follow `process.cwd()`

**Severity:** high · **Stage:** 1 · **Labels:** bug · **Status:** fixed (local v3.22.1)

**Where:** `src/cross-session/knowledge-accumulator.ts` L39 (`basePath` from `process.cwd()`), L555 (save errors logged at debug level); `src/cross-session/session-analyzer.ts` L35 and `extractProjectId()` L129-130 (project ID from cwd); `src/cross-session/index.ts` L314-316 (one process-wide instance); `src/core/tools/v3/cross-session-tool.ts` L70 and L170-171 (a second module-level cache of that instance). Same pattern, smaller blast radius: `src/core/tools/v3/arch-advisor-tool.ts` L123, `src/core/tools/v3/visualizer-tool.ts` L164, `src/mesh/MeshManager.ts` L189 and `src/mesh/tools/meshTool.ts` L119, `src/telemetry/exporters.ts` L24, `src/core/telemetry/index.ts` L297, `src/telemetry/retroClassifier.ts` L526, `src/telemetry/gitCapture.ts` L52-53 and L292.

**What happens:** The server resolves the active project with `getProjectPath()` (explicit path, MCP roots, `CURSOR_WORKSPACE`, …, cwd last), but these modules skip it and use the working directory of the process. Clients do not have to start the server in the project: a desktop client often starts it from `/` or the home directory. Every `analyze_task` and every completed session writes cross-session insights, guidelines, heuristics and stats to `<cwd>/.m7/cross-session/`. If cwd is not writable the write fails and the error goes to the debug log only, so the knowledge is silently lost. If it is writable, all projects share one store outside any of them. The singleton and the tool's own cache also pin the store to the first project seen, so after a project switch knowledge keeps going to the old place. The other sites read or write the wrong project in the same way (architecture advice, graphs, mesh registration, telemetry exports, git diff capture).

**Reproduce:** Start the server with cwd ≠ project (`CURSOR_WORKSPACE` set to the project), run `analyze_task`, then `complete_session` with `force: true`. `.m7/cross-session/stats.json` appears under cwd, not under the project. The acceptance suite hit this as repository pollution: running the tests from the repo root wrote `./.m7/cross-session/` into the repo.

**Expected:** Project state is always resolved through `getProjectPath()`. Cross-session learning is cached per project, not per process. Save failures are logged at warn level.

**Acceptance test:** In-process: with cwd ≠ project, a forced session completion writes `stats.json` under the project and leaves cwd untouched; `getCrossSessionLearning()` returns different instances for different projects and the same one on return; staged-diff capture with no `cwd` argument reads the bound project. Real server started from another directory: state lands in the project. A static check fails if `process.cwd()` appears in `src/` outside an explicit allowlist.

**Notes:** Found by the deep scan acceptance suite, not by the review. The allowlist has three entries: the resolver's own fallback (`projectPath.ts`), the diagnostic printout in `doctorTool.ts`, and the standalone relay process (`mesh/relay/server.ts`). The Docker auto-start in `health/healthCheck.ts` also used cwd; it is HYG-9 and was removed. `gitCapture.ts` also moved from `execSync` with a command string to `execFileSync` with an argument list: the interpolated values were constants, so this was not an injection, but the exclude pathspecs relied on shell quoting.

### STATE-5 — The contract registry reports success and keeps almost nothing

**Severity:** high · **Stage:** 1 · **Labels:** bug · **Status:** fixed (local v3.22.1)

**Where:** `src/core/tools/critical/contracts.ts` — the handler creates a new `ContractRegistry` on every call (L418-422); its constructor starts `loadExistingContracts()` without awaiting it (L55); the loader reads only `api_contracts.functions` and generates a new `id`, `createdAt` and `lastModified` for each entry (L105-137); `updateSchema()` L345-366 catches every error and logs it; `registerContract()` returns `success: true` regardless (L174); `contracts = new BoundedMap(500)` L47.

**What happens:** `mcp_m7_contracts` is meant to stop duplicate methods by remembering every registered contract. With `PROJECT_SCHEMA.yaml` present, `list` right after three registrations returns nothing, because each call builds a fresh registry and reads before the load has finished. The next `register` writes the registry it has, which is that one contract, so `PROJECT_SCHEMA.yaml` ends up holding only the last function and empty endpoint, method and class lists. Without a schema file, every registration answers "registered successfully" and nothing is written anywhere.

**Reproduce:** Real server, project with `PROJECT_SCHEMA.yaml`: register a function, an endpoint and a class, then `list` → 0; restart, `list` → 0; register another function → the YAML has one contract. Without the file: `register` → `✅ … registered successfully`, no file.

**Expected:** Every call works on the registry as it is on disk: the load is awaited, all four sections are read and IDs and creation times survive. A registration that could not be written returns `success: false` with the reason, and the in-memory registry is rolled back. Concurrent registrations in one process do not overwrite each other.

**Acceptance test:** Function, endpoint, method and class registered → all four listed in the same session and after a restart, with the same IDs; one more registration adds a fifth; re-registering a name keeps its ID and creation time; without `PROJECT_SCHEMA.yaml` register fails with a message naming the file and `mcp_m7_init_project`, and nothing is created; with an unparseable file register fails and the file is unchanged.

**Notes:** Found while checking §33 of the review ("success only after the write"); not a numbered finding. Severity follows the scale: the server reports success for something it did not do.

## Memory (`MEM-*`)

### MEM-0 — Tracking: one read path for memory

**Severity:** medium · **Stage:** 2 · **Labels:** bug, help wanted · **Status:** fixed (local v3.20.0)

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

**Severity:** high · **Stage:** 1 · **Labels:** bug · **Status:** fixed in #5

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

**Notes:** The first fix raised the bound to the size of the loaded file. That covered loading only; the same bound evicted records during normal work, which is MEM-5. Since 3.22.1 the persisted levels have no bound, and the refusal to write a map smaller than what was loaded stays as a guard.

### MEM-5 — Runtime eviction from bounded collections deletes records from disk

**Severity:** high · **Stage:** 1 · **Labels:** bug · **Status:** fixed (local v3.22.1)

**Where:** `src/memory/memorySystem.ts` — `longterm: new BoundedMap(2000)` L66, `conceptual: new BoundedMap(1000)` L67, `fogOfWar = new BoundedMap(500)` L70; `persistLevel()` L435 and `persistFogOfWar()` L456 write the whole collection. Later: the tombstone set in `src/memory/auto/unified-memory-core.ts` (`deletedIds = new BoundedSet(5000)`, written whole to `.m7/memory-tombstones.json`).

**What happens:** The bounded map is both the working set and the source of the file. The 2001st long-term record evicts the oldest one from the map, and the next flush writes the map, so the oldest record is gone from disk and a fresh process cannot read it. The same happens to conceptual memory after 1000 records, to fog-of-war entries after 500 (a larger file was also cut at load), and to tombstones after 5000 deletions; a lost tombstone lets a deleted record come back from the registry mirror (MEM-0). MEM-4's guard does not fire, because the count it compares against is updated after every write.

**Reproduce:** The review's trace: store a record, then 2000 more, draining every 49; `longterm.json` holds 2000 entries without the first, and a new instance returns `null` for it.

**Expected:** A collection that is persisted by writing it whole is not bounded. Bounds stay on the RAM-only levels (L0 surface 100, L1 working 500) and on caches whose misses fall through to the store.

**Acceptance test:** First record plus 2000 more → 2001 on disk, the first readable after a restart, both through `MemorySystem` and through the public `store` path; 1001 conceptual records → 1001; a 600-entry fog file survives load and update, and 501 runtime fog entries keep the first; 5001 tombstones plus one delete → all 5002 on disk.

**Notes:** Review §31. `recordStore` in `unified-memory-core.ts` stays bounded: it is a cache over `MemorySystem`, and a miss reads the record from there. README "What is stored and for how long" lists the limits that remain.

### MEM-6 — Every schema read stores another copy of the schema in long-term memory

**Severity:** high · **Stage:** 1 · **Labels:** bug, good first issue · **Status:** fixed (local v3.22.1)

**Where:** `src/schema/schemaSystem.ts` — `loadSchema()` L88-104 stores `JSON.stringify(schema)` as a new L2 record with confidence 1.0 on every call; callers include `analyze_task` (`src/core/tools/analyzeTask.ts` L328), the schema resource (`src/index.ts` L275, L312) and the contract registry.

**What happens:** `store` does not deduplicate, so every `analyze_task` in a project with `PROJECT_SCHEMA.yaml` adds one more identical copy at full confidence. Nothing reads them by key. With the 2000 bound (MEM-5) these copies pushed real records out of long-term memory; without the bound they would grow without limit. The copy also went to the memory core of the active project rather than of the schema's own directory.

**Reproduce:** Real server, `PROJECT_SCHEMA.yaml` present: three `analyze_task` calls → three identical schema records in `.m7/memory/longterm.json`.

**Expected:** Reading the schema has no memory side effects. `PROJECT_SCHEMA.yaml` is the only copy.

**Acceptance test:** Three `loadSchema()` calls return the schema and leave the record count and `longterm.json` unchanged; through the server, three `analyze_task` calls leave no schema copy.

**Notes:** Copies already written by earlier versions are not removed automatically. They are L2 records with `source: code_analysis` whose content starts with `{"project":`; `mcp_m7_memory` with `action: "delete_bulk"` and their IDs removes them.

### MEM-7 — Memory flushes overlap and are not awaited, so writes are lost

**Severity:** high · **Stage:** 1 · **Labels:** bug, help wanted · **Status:** fixed (local v3.22.1)

**Where:** `src/memory/memorySystem.ts` — `scheduleFlush()` L89-104 calls `flushPendingWrites()` without `await` once 50 writes are pending; `flushPendingWrites()` L109 clears the queue and then writes; `delete()` calls `persistLevel()` directly (L405); nothing orders `persistLevel()` calls, and each writes a snapshot taken when it started; `shutdown()` L149 drains only the queue; `store()` L293 does not wait for the initial load. `src/memory/auto/unified-memory-core.ts` — `getMemoryCore()` L1289-1294 and the project-change hook L1277-1279 drop the previous core without draining it.

**What happens:** At 50 pending writes a flush starts and the queue is emptied. Later stores start more flushes while the first is still writing; whichever snapshot is renamed last wins, and it can be an older one. `shutdown()` then finds an empty queue and returns while those writes are in flight, so exiting right after the stores leaves fewer records on disk than were acknowledged. Measured with a worker that exits right after storing: 49 stores → 49, 50 → 0, 120 → 50, 2000 → 0. In a process that keeps running, 500 stores left 450 on disk and 2000 left 1650, and `shutdown()` did not repair it. Separately, writes made in project A less than a second before a switch to B were lost: the old core was dropped with its queue.

**Reproduce:** `store` 120 L2 records, call `flushAllWithTimeout()` and exit: `longterm.json` has 50 entries.

**Expected:** One write queue per file: every write of a `MemorySystem` runs after the previous one, and at most one flush is queued, so later stores join it. `shutdown()` resolves after every write issued before it. A core replaced by a project switch is drained, and the server's shutdown waits for it. Writes wait for the initial load.

**Acceptance test:** 50, 120 and 2000 stores followed by exit → all on disk; 500 stores without shutdown → 500 once the debounce has passed, still 500 after shutdown; a delete issued while flushes are in flight stays deleted and nothing else is lost; a store in project A, a switch to B, then `flushAllWithTimeout()` → the record is in A; a store issued before the load finished survives the load.

**Notes:** MEM-3 made the server drain the queue on exit; it did not cover writes already in flight or their order. Tombstone writes in `unified-memory-core.ts` share the same problem when deletes run concurrently and use the same kind of queue.

## Task graph and transfer (`GRAPH-*`)

### GRAPH-1 — Depth-limited DFS marks nodes visited at the wrong depth

**Severity:** medium · **Stage:** 2 · **Labels:** bug, good first issue · **Status:** fixed (local v3.21.0)

**Where:** `src/core/task-graph/taskGraphManager.ts` — `getSubgraph()` L300-302: `if (depth < 0 || visited.has(nodeId)) return; visited.add(nodeId);`.

**What happens:** Classic depth-limited traversal bug. A node first reached at the depth limit is marked visited with no remaining budget; when the same node is reached later via a shorter path, it is skipped, and its children are never expanded. The returned subgraph misses nodes that are within the requested depth.

**Reproduce:** Graph `A→B→C`, `A→C`, depth 1 from A with edges ordered so `A→B→C` is walked first: `C` is visited at depth 0, then skipped on the direct edge; any children of `C` are missing at depth 2.

**Expected:** Track the best depth at which each node was seen (`Map<nodeId, depth>`), and re-expand if reached with more remaining depth; or use BFS.

**Acceptance test:** The diamond graph above returns all reachable nodes within depth.

### GRAPH-2 — Transfer task IDs can collide and overwrite

**Severity:** low · **Stage:** 2 · **Labels:** bug, good first issue · **Status:** fixed (local v3.21.0)

**Where:** `src/core/task-transfer/transferManager.ts` L192: ``task_${slugify(description)}_${Date.now().toString().slice(-4)}``.

**What happens:** The suffix is the last four digits of the millisecond clock, so it repeats every ten seconds. Two transfers with the same description within that window produce the same ID, and `createTask` does not check for existence, so the second overwrites the first in the graph. (The cycle ID in HYG-1 uses six digits and is much less exposed; this one is the real collision.)

**Reproduce:** Two transfers with the same description where `Date.now() % 10000` matches (easy to force in a test with a clock stub).

**Expected:** IDs that cannot collide in practice (random suffix or a counter), and `createTask` refusing to overwrite an existing ID.

**Acceptance test:** Two transfers with identical descriptions and a frozen clock produce two distinct tasks.

### GRAPH-3 — Failed transfer leaves an orphan task

**Severity:** medium · **Stage:** 2 · **Labels:** bug · **Status:** fixed (local v3.22.1)

**Where:** `src/core/task-transfer/transferManager.ts` L196-215: `createTask` → `updateTaskStatus(from, 'transferred')` → `createLink`; the `catch` at the end returns `success: false` without undoing earlier steps.

**What happens:** If any step after `createTask` throws, the new task exists in the graph with no link and the old one may or may not be marked transferred. There is no rollback. The graph ends up describing a transfer that did not happen.

**Reproduce:** Stub `createLink` to throw; inspect the graph.

**Expected:** Either the steps are applied as one atomic graph update, or the catch block removes the new task and restores the old status.

**Acceptance test:** With `createLink` throwing, the graph after the call equals the graph before it.

**Notes:** The 3.21.0 rollback deleted the new task and restored only the source `status`; `updateTaskStatus('transferred')` had also set `outcome` and `completed`, so the graph still differed. 3.22.1 snapshots the source node and restores it whole (`restoreTask`). The acceptance test compares the full graph JSON for a throwing `createLink` and a throwing `updateTaskStatus`.

## Gates and output (`GATE-*`)

### GATE-1 — Grounding treats `path:` references as memory lookups, not file checks

**Severity:** medium · **Stage:** 2 · **Labels:** bug · **Status:** fixed (local v3.20.1)

**Where:** `src/core/orchestrator/groundingGate.ts` — `resolveRef()` L154-160: a `path:` prefix is looked up in fog-of-war entries only.

**What happens:** A premise like `{ "ref": "path:src/foo.ts" }` is reported NOT_FOUND whenever the file has not been recorded in fog-of-war, regardless of whether it exists on disk. In practice, every `path:` premise that refers to a file the model read directly (rather than through a memory action) is flagged, so the "soft warning" is permanently on and stops carrying information.

**Reproduce:** Submit a solution with a `path:` premise pointing at an existing file that has no fog entry; the grounding report shows NOT_FOUND.

**Expected:** `path:` references check the filesystem (relative to the project path) and report FOUND/NOT_FOUND on that basis; fog-of-war adds freshness information on top, if available.

**Acceptance test:** Premise with `path:` to an existing file and no fog entry → FOUND; to a nonexistent file → NOT_FOUND.

### GATE-2 — Irreversible steps with no premises raise no warning

**Severity:** medium · **Stage:** 2 · **Labels:** bug, good first issue · **Status:** fixed (local v3.21.0)

**Where:** `src/core/orchestrator/groundingGate.ts` — step loop L229-230 iterates `step.premise_ids`; an empty array produces no iterations and therefore no warning.

**What happens:** The gate's stated purpose is to require grounded premises for irreversible steps. A step declared `reversibility: "irreversible"` with `premise_ids: []` passes with zero warnings.

**Reproduce:** Solution artifact with one irreversible step and an empty `premise_ids`.

**Expected:** An irreversible step with no premises is a strong warning on its own.

**Acceptance test:** The above artifact produces one `strong` warning naming the step.

### GATE-3 — Response noise: gate prompt repeated, error banner without a source

**Severity:** low · **Stage:** 3 · **Labels:** enhancement, good first issue · **Status:** fixed (local v3.22.0)

**Where:** Gate text is generated at `src/core/orchestrator/cycleOrchestrator.ts` L563 (goal), L580 (instruction body), and again in `src/core/tools/cycleTool.ts` L168-174 (`gateSection`), so the full gate prompt appears up to three times in one response. `src/core/utils/hintGenerator.ts` L83-95 appends "Runtime errors increasing - add more error handling" whenever `recentErrors[0].count > 2`, with no indication of which errors or where.

**What happens:** A typical gate response is several hundred lines, most of it repeated; the actionable part (the gate ID and the JSON shape) appears three times. The error banner appears on every response once the counter is tripped and never says what to look at.

**Expected:** Gate prompt rendered once. The banner either names the error category and a count with a pointer to the error database, or is dropped.

**Acceptance test:** Response for one gate contains the string `Gate-ID:` exactly once; banner, if present, includes the source.

## Hygiene and documentation (`HYG-*`)

### HYG-1 — Task IDs: non-Latin descriptions produce an empty slug

**Severity:** low · **Stage:** 3 · **Labels:** bug, good first issue · **Status:** fixed (local v3.22.1)

**Where:** `src/core/orchestrator/cycleOrchestrator.ts` — `generateTaskId()` L933-938: `.replace(/[^a-z0-9\s-]/g, '')` then `slice(0, 20)` plus six clock digits.

**What happens:** For a description with no Latin letters (Cyrillic, CJK, …) the slug is empty and the ID is `cycle__123456`. All such cycles differ only in the six-digit clock suffix, which repeats every ~17 minutes. The same slug feeds the artifact directory name, so unrelated cycles can share a folder.

**Reproduce:** `startCycle('Исправить баг')` → ID `cycle__NNNNNN`.

**Expected:** Transliterate or hash the description for the slug, and use a suffix that does not depend on the clock alone.

**Acceptance test:** Two non-Latin descriptions produce distinct, non-empty slugs.

**Notes:** 3.21.1 fixed `generateTaskId`, but the artifact folder name comes from a second function, `generateSlug`, which kept the Latin/Cyrillic-only filter: CJK, emoji and punctuation-only descriptions gave an empty folder name, so their artifacts went straight into `m7-cycles/` and overwrote each other. 3.22.1 keeps letters of any script (`\p{L}\p{M}\p{N}`) and falls back to a short hash when nothing is left.

### HYG-2 — Hive result cache key collapses non-Latin and order-sensitive tasks

**Severity:** medium · **Stage:** 2 · **Labels:** bug · **Status:** fixed (local v3.21.0)

**Where:** `src/hive/cache/taskResultCache.ts` — `hashTask()` L76-86: `.replace(/[^\w\s]/g, ' ')` (no `u` flag), `.sort()`, `.join(' ')`.

**What happens:** Two effects. (a) `\w` without the `u` flag matches ASCII only, so a non-Latin task normalizes to the empty string and *every* such task shares one cache key — a cached result for one task is returned for any other. (b) Sorting the words discards order and direction: "move A to B" and "move B to A" hit the same entry.

**Reproduce:** (a) `hashTask('Исправить баг') === hashTask('Добавить тест')`. (b) The two English phrases above.

**Expected:** Unicode-aware normalization (`\p{L}\p{N}` with `u`) and no word sorting; if fuzzy matching is wanted, do it at lookup time with a similarity threshold, not by destroying the key.

**Acceptance test:** Both pairs above produce distinct hashes.

### HYG-3 — Shell command built by string interpolation

**Severity:** low · **Stage:** 3 · **Labels:** enhancement, good first issue · **Status:** fixed (local v3.22.0)

**Where:** `src/hive/context/fileSearcher.ts` L44: `` `grep -r -c -i "${keyword}" ... "${projectPath}"` `` passed to `exec`; `keyword` is sanitized upstream by `src/hive/context/keywordExtractor.ts` L71 (`[^a-z0-9_\-\s]` stripped); `projectPath` comes from the process environment.

**What happens:** Both interpolated values are controlled by the server's own configuration, so there is no demonstrated path for an outside party to influence them. It is still a shell string assembled by hand, which is the kind of code that becomes a problem the first time someone adds a new input to it.

**Expected:** `execFile('grep', [args...])` with an argument array, no shell.

**Acceptance test:** A project path containing a space and a double quote is searched correctly.

**Notes:** Follow-up in 3.22.1: with an argument array there is no shell, but a keyword starting with `-` was still read by `grep` as an option. The argv now passes the keyword after `-e` and ends options with `--` before the path.

### HYG-4 — Debug tool prints API key prefixes

**Severity:** low · **Stage:** 3 · **Labels:** enhancement, good first issue · **Status:** fixed (local v3.22.1)

**Where:** `src/test-tool.ts` L32-33: `openaiKey.substring(0, 15)` and `anthropicKey.substring(0, 15)` in the tool response. The same 15-character prefix appears in `src/hive/tools/hiveCoordinator.ts` L231 (the `mcp_m7_hive_coordinator` "Debug Info" block, which is also written into the saved hive report file) and L199 (debug log), and in `src/index.ts` L213-214 (startup log when `M7_DEBUG=true`).

**What happens:** `mcp_m7_test_tool` returns the first 15 characters of two API keys to whoever calls it. The caller is the owner of the environment those keys live in, so this is not a disclosure to a third party; it is an early debugging aid that should not be in a release.

**Expected:** Remove the tool, or reduce the output to present/absent.

**Acceptance test:** Tool list does not contain `mcp_m7_test_tool`, or its output contains no substring of the key values.

**Notes:** 3.22.0 removed `mcp_m7_test_tool` but left the other three sites; 3.22.1 reduces them to present/absent. Tests: no `substring(0, …)` / `slice(0, …)` on a key variable anywhere under `src/`, and a real server with `M7_DEBUG=true` writes no 8-character piece of either key to stderr.

### HYG-5 — README describes rule re-injection as counting "tool calls"

**Severity:** low · **Stage:** 3 · **Labels:** documentation, good first issue · **Status:** fixed (local v3.22.0)

**Where:** `README.md` L24 and L129 ("after N tool calls", `M7_RULE_REINJECTION_THRESHOLD`); `src/core/orchestrator/ruleReinjection.ts` L1-4 counts `mcp_m7_cycle` calls only.

**What happens:** An MCP server only sees calls to its own tools; it cannot count calls the client makes to other servers or to built-in tools. The code is correct about this. The README wording suggests otherwise.

**Expected:** README says "after N `mcp_m7_cycle` calls in the same phase".

**Acceptance test:** Documentation change; no test.

### HYG-6 — `M7CodeInterceptor` is dead code

**Severity:** low · **Stage:** 3 · **Labels:** enhancement, good first issue · **Status:** fixed (local v3.22.0)

**Where:** `src/core/enforcement/codeInterceptor.ts` L31: `export class M7CodeInterceptor`; no other file under `src/` references it.

**What happens:** The class is exported and never instantiated. Its presence has been read as a promise of server-side code enforcement that the server does not and cannot provide (an MCP server does not see the client's file writes).

**Expected:** Remove the file, or move it to an `experimental/` location with a one-line note in its header about why it is not wired in.

**Acceptance test:** `tsc` passes after removal; no tool behavior changes.

### HYG-7 — Architecture context search runs task text through a shell

**Severity:** high · **Stage:** 2 · **Labels:** bug · **Status:** fixed (local v3.22.1)

**Where:** `src/core/architecture/architecture-context-analyzer.ts` — `searchWithRipgrep()` L127-133: `` exec(`rg "${escapedKeyword}" --type ts … --max-filesize 100K`) ``; the escape at L127 covers regex metacharacters, not `"`. Keywords come from `mcp_m7_analyze_task`'s `task_description` via `src/core/tools/analyzeTask.ts` L400 and `src/core/architecture/keyword-extractor.ts` (text in backticks is taken as-is, L118-121).

**What happens:** Two effects. (a) A backticked word containing `"` closes the quoted argument, and the rest runs as shell commands with the server's privileges: a description like ``Fix handler `zzq";id>PWNED;echo"` `` creates `PWNED` in the project when `rg` is not on `PATH`. (b) When `rg` is on `PATH`, the command has no path argument and the server's stdin is the MCP pipe, so `rg` reads stdin until the 2000 ms timeout kills it: every `analyze_task` waits two seconds per keyword and the architecture context is always empty.

**Reproduce:** (a) `PATH=/usr/bin:/bin`, `analyze()` with the description above, look for `PWNED`. (b) A project with `src/marker.ts` exporting `zzqMarker`; `analyze('Fix \`zzqMarker\` usage')` returns no implementations after ~2 s.

**Expected:** `execFile('rg', argv)` with the keyword as one argument (`--fixed-strings -e <kw>`), `--` and an explicit search path; exit code 1 (no matches) is an empty result.

**Acceptance test:** (a) produces no file; (b) finds the marker in well under the timeout; the argv keeps the keyword as one element and ends with `--`, `.`.

**Notes:** Found by the deep scan acceptance suite while checking HYG-3, which fixed the same pattern in a different file. The review did not list this call site.

### HYG-8 — Server reports version 2.0.0 regardless of the package version

**Severity:** low · **Stage:** 3 · **Labels:** bug, good first issue · **Status:** fixed (local v3.22.1)

**Where:** `src/index.ts` L142 (`McpServer({ name, version: '2.0.0' })`, sent to clients as `serverInfo` in the `initialize` response) and L640 (`version` in the `m7://status` resource).

**What happens:** Every release tells the client it is 2.0.0. A user reporting a bug from the client's server list, or a script reading `m7://status`, gets a version that matches no release.

**Expected:** Both read the version from the package's own `package.json`, from one place.

**Acceptance test:** Real server: `client.getServerVersion().version` and `m7://status` `version` equal `package.json` `version`.

### HYG-9 — `analyze_task` runs `docker compose up -d` on a compose file from the working directory

**Severity:** medium · **Stage:** 2 · **Labels:** bug · **Status:** fixed (local v3.22.1)

**Where:** `src/core/health/healthCheck.ts` — `tryStartDocker()` L135-206 (looks for `docker-compose.yml` / `compose.yml` in `process.cwd()` L139-142, runs `docker info`, then `docker compose up -d` L170 and waits up to 15 s), `checkSystemHealth()` L215-219 (`autoStartDocker` defaults to `true`), offline hints L71/L79/L86; `src/core/tools/analyzeTask.ts` L232 (`checkSystemHealth({ autoStartDocker: true })` on every call).

**What happens:** ChromaDB is optional (README: memory falls back to local JSON), so for most users it is offline. On every `analyze_task` the health check then looks for a compose file in the server's working directory and, if Docker is running, starts it. The package ships no compose file, so what gets started is whatever the user's own project (or whatever directory the client launched the server from) defines. The call also blocks for up to 15 s waiting for ChromaDB, and the response tells the user to run `docker compose up -d` themselves.

**Reproduce:** Put a `compose.yml` and a stub `docker` that logs its arguments on `PATH` in a directory, start the server from there with `CHROMA_URL` pointing at a closed port, call `analyze_task`: the stub logs `info` and `compose up -d`, and the call takes ~16 s.

**Expected:** A health check reports; it does not start anything. The offline hint names `CHROMA_URL` and the local fallback.

**Acceptance test:** Real server started from a directory with a compose file and a stub `docker` on `PATH`: `analyze_task` returns, the stub is never called, the response names the configured `CHROMA_URL` and does not mention docker. In-process: `checkSystemHealth()` with ChromaDB offline has no docker fields and the hint names `CHROMA_URL`.

**Notes:** Found while checking the STATE-4 allowlist (it was the last remaining `process.cwd()` that was not about project state). Removed rather than put behind a flag: there is no compose file in the package for it to start.

### HYG-10 — Unreachable modules keep defects that the live paths no longer have

**Severity:** low · **Stage:** 3 · **Labels:** enhancement, good first issue · **Status:** fixed (local v3.22.1)

**Where:** `src/core/verification/` (`index.ts`, `symbolVerifier.ts`, `gordianKnotDetector.ts`) — never imported; `symbolVerifier.ts` L199-202 and L245-248 build `grep … -E "${pattern}" "${searchPath}"` and run it with `execSync`. `src/core/tools/v3/auto-memory-tool.ts` L33 — never registered; it is the only importer of `src/memory/auto/index.ts`, `project-registry.ts`, `context-injector.ts`, `types.ts`. `src/memory/auto/unified-memory-core.ts` — `PersistentMemory` / `createPersistentMemory` L1338-1413 (used only by those modules: a second `UnifiedMemoryCore` outside the project-bound singleton L1350, `importance || 0.7` L1362, `deleteBySource` L1381 deletes from RAM only); `invalidateDependents()` L456-483 and `updateWithInvalidation()` L488-531 (never called; RAM only, `(confidence || 0.8) * 0.7` turns 0 into 0.56 L472, recursion without a visited set). `src/core/tools/projectIndex/projectScanner.ts` `scanGitInfo()` L136-161: four git commands as shell strings in one `try`, so a repo without an `origin` remote loses branch and last commit too.

**What happens:** Nothing today for the unreachable code — that is the point of the item. Each of those modules repeats a defect fixed elsewhere in this list (HYG-3/HYG-7 shell strings, MEM-2 `||` for confidence, MEM-1 RAM-only mutation, STATE-4 a store outside the bound project). Wiring any of them back in brings the defect back with it. `scanGitInfo()` is reachable (`mcp_m7_project_index`) and drops git info for local-only repos.

**Expected:** Unreachable modules are removed, like HYG-6. `src/` imports only `execFile` / `execFileSync` from `child_process`, so the rule from HYG-3 and HYG-7 is checkable. `scanGitInfo()` reads each field independently.

**Acceptance test:** The removed modules are absent from `src/` and `dist/`; `UnifiedMemoryCore` has no `invalidateDependents` / `updateWithInvalidation` and the module exports no `PersistentMemory`; a static scan finds no `child_process` import other than `execFile` / `execFileSync` and no `shell: true` in `src/`; `scanGitInfo()` on a repo without `origin` returns the branch, the last commit (subject with quotes and `$` intact) and the author.

**Notes:** Found by the deep scan acceptance work, in a pass over the remaining `child_process` call sites and the code around MEM-1/MEM-2. `src/memory/auto/compaction.ts` is also unimported but has no known defect, so it stays. `tests/phase2/test-smart-context.mjs` (not part of `npm test`) lost its four cases for the removed cascade methods.

### HYG-11 — `require()` in ES modules throws, and the surrounding `catch` hides it

**Severity:** low · **Stage:** 3 · **Labels:** bug, good first issue · **Status:** fixed (local v3.22.2)

**Where:** `src/knowledge-graph/index.ts` L422-424 (`getKnowledgeGraph()` lazy cache load: `require('../core/utils/projectPath.js')`, `require('fs')`, `require('path')` inside `try`), `src/mesh/MeshManager.ts` L560 (`writePresence()`: `hostname: require('os').hostname()` inside `try { … } catch { /* non-fatal */ }`), `src/tsi/index.ts` L34 (`createTSISystem()`: `require('./tsiSystem.js')`). The package is `"type": "module"`, so `require` is not defined at run time.

**What happens:** Each call throws `ReferenceError: require is not defined`. In `getKnowledgeGraph()` the `catch` logs "KG lazy load failed" and the cache at `.m7/knowledge-graph.json` is never read. In `writePresence()` the `catch` is silent and the presence file `~/.m7/mesh/presence/instance_<id>.json` is never written. `createTSISystem()` has no `catch` and throws to its caller. TypeScript does not report any of it because `require` is declared by `@types/node`.

**Reproduce:** Call `getMeshManager().init(dir)` and `join()`: `dir/presence/` stays empty. Call `createTSISystem()`: `ReferenceError`.

**Expected:** Static `import` (or `await import()`) everywhere in `src/`; the presence file is written on join with the host name; `createTSISystem()` returns a `TSISystem`.

**Acceptance test:** A TypeScript-AST scan of `src/` finds no `require(...)` call; `createTSISystem()` returns a `TSISystem`; `MeshManager` `init` + `join` in a temp directory writes one presence file whose `hostname` is `os.hostname()`, and `leave` removes it.

**Notes:** Found by a static scan for `require()` added after the acceptance suites. A regex scan is not enough: `require(` also appears in strings, regular expressions and code samples in `src/` (for example `tsi/tsiSystem.ts`, `core/scope/patterns.ts`). Nothing writes `.m7/knowledge-graph.json` today, so the knowledge-graph part has no visible effect yet; `KnowledgeGraph.loadFromFile()` also starts an async load without awaiting it, which matters once something writes the cache.

## Review findings

Where each numbered finding of the October 2026 review went. A finding can map to several items, and part of a finding can be declined; the last column names the entry in "Not on this list" that explains which part.

| Finding | Review title | Items | Not on this list |
|---|---|---|---|
| §04 | Architecture: the boundary of effect | HYG-6 | Server-side enforcement |
| F01 | Meaning is skipped, not order | CYC-1 | |
| F02 | A request changes its own meaning | CYC-2 | |
| F03 | Completion is not terminal | CYC-3 | |
| F04 | Two admissions of one phase | CYC-2 | |
| F05 | Sessions have a second path to success | STATE-2 | |
| F06 | A project switch splits the owner | CYC-4 | |
| F07 | Different cycles share evidence | CYC-10, HYG-1 | |
| F08 | Success without saved state | STATE-1 | |
| F09 | Distrust does not survive a reload | MEM-1 | |
| F10 | Deleted knowledge returns as a copy | MEM-0 | |
| F11 | A contradiction depends on a warm cache | MEM-0 | |
| F12 | Zero confidence raises itself | MEM-2 | |
| F13 | A side copy bypasses the search filter | MEM-0 | |
| F14 | Storage does not keep the record's address | MEM-0 | |
| F15 | The "exact" cache erases direction | HYG-2 | |
| F16 | A path turns into shell code | HYG-3 | |
| F17 | Grounding does not tie a claim to a fact | GATE-2 | Claim support |
| F18 | Diagnostics print part of the keys | HYG-4 | |
| F19 | The reminder does not see every call | HYG-5 | Server-side enforcement |
| F20 | A warning is not expertise | CYC-5 | Adversarial review is advisory |
| F21 | The summary picks an old reflection | CYC-6 | |
| F22 | Length errors use up the right to rewind | CYC-5 | |
| F23 | Edge order changes the graph found | GRAPH-1 | |
| F24 | A transfer overwrites a finished task | GRAPH-2 | |
| F25 | A failed transfer leaves a task behind | GRAPH-3 | |
| F26 | MCP confirmed a write, closing lost it | MEM-3 | |
| §31 | Operational limits | MEM-4, MEM-5, CYC-9 | |

Items that do not come from a numbered finding: CYC-7, CYC-8, GATE-1 and GATE-3 came from running the server through an MCP client while checking the review; STATE-3, STATE-4, STATE-5, HYG-7, HYG-8, HYG-9, HYG-10, HYG-11, MEM-6 and MEM-7 were found by the acceptance suites and the work around them.

## Not on this list

A few things from the same review are deliberately not here, so that nobody spends time on them expecting a merge.

- **Adversarial review is advisory.** Making the adversarial review gate blocking is not planned. It is a soft warning by design (`src/core/orchestrator/adversarialGate.ts` L63-66 says so in the text it emits). The parts of F20 that are defects are CYC-5 (a short artifact accepted on the third try) and GATE-2.
- **Claim support.** The grounding gate checks that the references in a step exist (files, memory records); it does not check that they support the claim, and the review asks for the latter. That needs a judgment the server cannot make reliably, so the gate keeps its narrower meaning and the README says so. The part of F17 that is a defect is GATE-2; GATE-1, found while running the server, is the same gate failing even at the narrower check.
- **Server-side enforcement.** Enforcing what the client writes to disk or which tools it calls is not possible: the MCP protocol does not give a server visibility into the client's tool calls or file writes. Anything that reads as a promise of that in the docs is a documentation issue (HYG-5, HYG-6), not a missing feature.

## Maintaining this file

- A PR that fixes an item changes its `Status` in both the summary table and the item heading block to `fixed in #NN`. Items are not removed.
- If you find a new confirmed defect, add it under the matching root with the same template, and add a row to the summary table. "Confirmed" means: a reproduction that someone else can run.
- When line numbers have drifted far enough to be unhelpful, update the commit hash in the header and the numbers together, in one PR that changes nothing else.
