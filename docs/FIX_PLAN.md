# Fix plan

A short suggested approach for every item in [KNOWN_ISSUES.md](../KNOWN_ISSUES.md). Same IDs, same order. This file says *how one could fix it*; KNOWN_ISSUES says *what counts as fixed*. If your PR takes a different route and the acceptance test from KNOWN_ISSUES passes, that is fine — the plans here are a starting point, not a spec.

Symbol names and line numbers refer to commit `72a7640`. Symbols marked *(new)* do not exist yet.

**Size** is a rough indication of scope, not hours: **S** — one function plus a test; **M** — several functions or a new field/type, touches more than one file; **L** — changes a shared path, worth a short design note in the issue before coding.

## Shared building blocks

Several plans rely on the same primitive. Whoever lands the first PR in each group effectively defines it for the others.

**B1 — A failed write is a failed call.** `saveState()` and the memory persist path stop swallowing errors. The caller mutates a *copy* of the state, writes it, and only then replaces the in-memory record; on write failure the tool returns `{ success: false, error }` and nothing in memory changes. Introduced by STATE-1; reused by MEM-1, MEM-3, CYC-7.

**B2 — Serialized submissions with a status field.** `CycleOrchestrator` keeps `Map<taskId, Promise<void>>` and chains every `submitArtifact`/`submitReflection` for one task onto the previous one. `CycleState` gains `status: 'active' | 'completed' | 'aborted'` and `lastAccepted?: { phase, kind: 'artifact' | 'reflection', sha256 }`. Introduced by CYC-2; reused by CYC-3, CYC-8, CYC-9.

**B3 — One record resolver.** In `unified-memory-core.ts`, a private `resolveRecord(id)` *(new)* that checks `recordStore`, then every `MemorySystem` level including `project`, then returns `null`; and an `iterateRecords(filter)` *(new)* that `search()`/`contradicts` use instead of touching `recordStore` directly. Mirror-indexed records carry `source: 'mirror'`; deleted IDs go to a persisted tombstone set. Introduced by MEM-0.

---

## Cycle contract

### CYC-1 — Unparseable reflection is treated as `continue` with confidence 1.0

**Size:** S · **Depends on:** — · **Uses:** —

**Change**
1. `parseReflection()` returns `{ ok: true, reflection } | { ok: false, reason }` instead of falling back to `defaultReflection`.
2. `validateDecision()` returns `null` for anything outside the four known values; the caller treats `null` as `ok: false`.
3. `submitReflection()` on `ok: false` returns `{ success: false, error: reason }` and leaves `state` untouched (still `awaitingReflection`, same gate ID).

**Touches:** `src/core/orchestrator/cycleOrchestrator.ts` → `parseReflection`, `validateDecision`, `submitReflection`.

**Test:** `tests/cycleOrchestrator.test.mjs` — rewrite `invalid JSON in reflection → auto-continue` to assert rejection and unchanged phase; add a case with `decision: "proceed"`.

**Watch out:** Do not add a retry/attempt counter here; that belongs to CYC-5. Check that `rewindToPhase` does not depend on the default reflection shape.

### CYC-2 — Artifact submission is neither idempotent nor serialized

**Size:** M · **Depends on:** — · **Uses:** B2 (introduces it)

**Change**
1. Add `private queues = new Map<string, Promise<unknown>>()`; wrap the bodies of `submitArtifact` and `submitReflection` in `enqueue(taskId, fn)` *(new)* that chains on the previous promise and clears the entry when done.
2. Add `lastAccepted` to `CycleState`; compute `sha256(content)` at the top of each submit.
3. If `lastAccepted.sha256` matches, return the stored last response (keep `lastResponse` in state or regenerate via `getCurrentInstruction`) without mutating anything. Match on the hash alone, not on `{ phase, kind }`: after an accepted reflection the phase has moved on, and `cycleTool` routes the retried reflection JSON to `submitArtifact` (3.19.0 matched all three and missed this).

**Touches:** `src/core/orchestrator/cycleOrchestrator.ts` → `submitArtifact`, `submitReflection`, `enqueue` *(new)*; `src/core/orchestrator/types/cycle.ts` → `CycleState`.

**Test:** `tests/cycleOrchestrator.test.mjs` — `Promise.all` of two identical submits → `completedPhases.length === 1`; sequential duplicate → second response equals first, state unchanged.

**Watch out:** `migrateState()` must default the new fields for states written before this change. The queue must also cover `rewindToPhase` and `registerSummary`, or they can interleave with a submit.

### CYC-3 — A finished or aborted cycle is not terminal

**Size:** S · **Depends on:** CYC-2 · **Uses:** B2

**Change**
1. Set `state.status = 'completed'` on the last-phase path in `transitionToNextPhase()` and in `submitArtifact()`'s completion branch; `'aborted'` in the `abort` case of `submitReflection()`.
2. At the top of both submit methods: if `status !== 'active'`, return ``{ success: false, error: `Cycle is ${status}` }``.
3. `formatCompletionResponse()` takes `(taskId, status, lastPhase)` and renders different text for completed vs aborted.

**Touches:** `src/core/orchestrator/cycleOrchestrator.ts` → `transitionToNextPhase`, `submitArtifact`, `submitReflection`; `src/core/tools/cycleTool.ts` → `formatCompletionResponse`.

**Test:** `tests/cycleOrchestrator.test.mjs` — abort at intake → response lacks "7 phases"; further submit → `success: false` with `aborted`.

**Watch out:** `registerSummary()` should still work on a `completed` cycle; make the guard apply to submits only.

### CYC-4 — Cycle state and artifact files can land in different projects

**Size:** S · **Depends on:** — · **Uses:** —

**Change**
1. Add `projectPath: string` to `CycleState`; set it once in `startCycle()` from `getProjectPath()`.
2. Replace the `getProjectPath()` call in `submitArtifact()` (artifact dir) and any other per-call lookups with `state.projectPath`.
3. Derive `cyclesDir` per state (`path.join(state.projectPath, '.m7', 'cycles')`) rather than from the constructor field; keep the constructor field only for `cleanupOldCycles`/listing.

**Touches:** `src/core/orchestrator/cycleOrchestrator.ts` → `startCycle`, `submitArtifact`, `saveState`, `getState`; `src/core/orchestrator/types/cycle.ts`.

**Test:** `tests/projectPath.test.mjs` or a new case in `cycleOrchestrator.test.mjs` with a stubbed `getProjectPath` returning A then B; both files under A.

**Watch out:** `getState()` looks on disk under `this.cyclesDir`; after the change it needs the task's project path, which it does not know before loading. Keep an index (`taskId → projectPath`) in memory, or keep state files under the constructor dir and only move artifacts — the acceptance test accepts either as long as both halves agree.

### CYC-5 — One attempt counter serves two unrelated limits

**Size:** S · **Depends on:** — · **Uses:** —

**Change**
1. Add `shortArtifactAttempts: Record<PhaseType, number>` and `rewindCount: Record<PhaseType, number>` to `CycleState`; keep `phaseAttempts` only for migration.
2. In `submitArtifact()`, increment `shortArtifactAttempts`; when it reaches the limit, return `{ success: false, error: 'Phase stuck: 3 short artifacts' }` — do not force-accept.
3. In `rewindToPhase()`, use `rewindCount` only.

**Touches:** `src/core/orchestrator/cycleOrchestrator.ts` → `submitArtifact`, `rewindToPhase`, `migrateState`; `src/core/orchestrator/types/cycle.ts`.

**Test:** `tests/cycleOrchestrator.test.mjs` — three short submits → third still `success: false`; two rewinds then a short submit → counter for short artifacts is 1.

**Watch out:** Some existing tests may rely on the forced transition after three attempts; they are testing the bug.

### CYC-6 — Carry-forward picks the first reflection, not the latest

**Size:** S · **Depends on:** — · **Uses:** —

**Change**
1. In `buildCarryForward()`, replace `find` with a reverse search (`[...state.reflections].reverse().find(...)` or `findLast`).
2. Same for any other `reflections.find(r => r.phase === ...)` in the file (check `generateInstruction` and the artifact link builder).

**Touches:** `src/core/orchestrator/cycleOrchestrator.ts` → `buildCarryForward`.

**Test:** `tests/cycleOrchestrator.test.mjs` — two reflections for one phase; the generated instruction contains the second summary.

**Watch out:** `Array.prototype.findLast` needs Node 18+; the project targets 22, so it is fine, but keep `tsconfig` `lib` in mind.

### CYC-7 — Re-submitting an artifact overwrites the previous file without trace

**Size:** S · **Depends on:** — · **Uses:** B1

**Change**
1. In `submitArtifact()`, before `fs.writeFile`, check whether the artifact file exists.
2. If it does, append `\n\n---\n<!-- resubmitted <ISO timestamp> -->\n\n` plus the new content instead of overwriting (or write `<NAME>.v<N>.md` and keep the latest under the plain name — append is simpler because four places call `getArtifactFilename`).
3. Propagate write errors per B1.

**Touches:** `src/core/orchestrator/cycleOrchestrator.ts` → `submitArtifact`, `ensureTemplateHeader`.

**Test:** new case in `tests/cycleOrchestrator.test.mjs` — submit, rewind, submit different text; read the file; both texts present.

**Watch out:** `ensureTemplateHeader()` prepends a header; on append, skip the header for the second block or the file gets two.

### CYC-8 — Registry append never deduplicates

**Size:** S · **Depends on:** CYC-3 (for status) · **Uses:** B2

**Change**
1. In `registerSummary()`, after reading the registry, look for an existing row whose last cell equals the task folder.
2. If found, replace that row in place (keep its number); otherwise append as today.
3. Include `state.status` in the summary cell or a new column, so an aborted cycle is visible.

**Touches:** `src/core/orchestrator/cycleOrchestrator.ts` → `registerSummary`.

**Test:** new `tests/cycleRegistry.test.mjs` — temp dir with a registry file; two completions → one row; row text updated.

**Watch out:** The regex that finds `max + 1` assumes `| N |` at line start; rows edited by hand may break it. Parse rows with a stricter pattern and ignore the ADR section.

### CYC-9 — Cleanup deletes cycle state by age alone

**Size:** S · **Depends on:** CYC-3 (nice to have) · **Uses:** B2

**Change**
1. In `cleanupOldCycles()`, read each candidate file and parse it before deciding; skip if `status === 'active'` (before CYC-3 lands: skip if `completedPhases.length < 7`).
2. Move eligible files to `cyclesDir/archive/` instead of `unlink`; log at `info`.
3. Unreadable files: log at `warn`, leave in place.

**Touches:** `src/core/orchestrator/cycleOrchestrator.ts` → `cleanupOldCycles`.

**Test:** new case in `tests/cycleOrchestrator.test.mjs` — two state files with old mtime (`fs.utimes`), one active, one completed; after `startCycle`, the active one is still there.

**Watch out:** `cleanupOldCycles` runs on every `startCycle`; parsing every file each time is fine for dozens, not thousands — cap the scan or run it once per process.

### CYC-10 — Cycles with the same description share one artifact folder

**Size:** M · **Depends on:** CYC-4, CYC-7, HYG-1 · **Uses:** B1

**Change**
1. `allocateCycleIdentity(description, projectPath)` *(new)*: draw one random suffix, build the task ID from it (`generateTaskId(description, suffix)`) and the folder name `<generateSlug(description)>-<suffix>`. Skip a suffix whose ID is in `this.cycles`, in a set of IDs reserved by starts still in progress, or has a state file; create the folder with a non-recursive `mkdir` and treat `EEXIST` as taken. Give up after a few attempts with an error instead of sharing.
2. `startCycle()` uses it, commits state, and removes the folder again if the state write fails; the reservation is released either way.
3. `cleanupOldCycles(projectPath)` takes the project of the cycle being started instead of the directory captured by the constructor.
4. Folder paths keep coming from `state.taskSlug` everywhere, so cycles created before the change keep their folders.

**Touches:** `src/core/orchestrator/cycleOrchestrator.ts` → `startCycle`, `generateTaskId`, `cleanupOldCycles`, `allocateCycleIdentity` *(new)*, `nextIdSuffix` *(new)*.

**Test:** `tests/deepScanAcceptance.test.mjs` `[CYC-10]` — two cycles with one description, 20 parallel starts, taken ID or folder (stub `nextIdSuffix`), all suffixes taken, legacy slug, unwritable `.m7/cycles`, cleanup after a project switch. `tests/deepScanE2E.test.mjs` — two cycles through the server.

**Watch out:** The suffix check and the folder creation must happen before the first `await` that could let a parallel start in, or the reservation set has to cover the gap; `mkdir({ recursive: true })` succeeds on an existing folder and hides the collision.

## Persisted state

### STATE-1 — Failed state write is reported as success; backups are never consulted for corrupt files

**Size:** M · **Depends on:** — · **Uses:** B1 (introduces it)

**Change**
1. `saveState()` no longer catches; it throws. Callers (`submitArtifact`, `submitReflection`, `rewindToPhase`, `startCycle`) work on `structuredClone(state)`, call `saveState(copy)`, and only then `this.cycles.set(taskId, copy)`.
2. The tool layer catches and returns `{ success: false, error: 'State not persisted: …' }`.
3. In `safeReadJSON()`, when `JSON.parse` of the main file fails, run the same backup loop `safeRead()` uses on read failure (factor the loop into `readBackups()` *(new)*).

**Touches:** `src/core/orchestrator/cycleOrchestrator.ts` → `saveState` and its callers; `src/core/utils/atomicWrite.ts` → `safeRead`, `safeReadJSON`, `readBackups` *(new)*.

**Test:** `tests/cycleOrchestrator.test.mjs` — unwritable `cyclesDir` (`chmod 0o500` on a temp dir) → `success: false`, `completedPhases` unchanged. `tests/reliability/` — corrupt main file + valid `.bak.1` → data returned with `recoveredFrom`.

**Watch out:** `getState()` currently writes through `this.cycles` directly; make sure the clone-then-commit pattern is applied everywhere state is mutated, or the in-memory copy drifts from disk again. Windows: `chmod` tests need a skip.

### STATE-2 — `complete_session` has no phase guard

**Size:** S · **Depends on:** — · **Uses:** —

**Change**
1. `completeSession(sessionId, notes?, options?: { force?: boolean })`: if `!force` and (`currentPhase` is not the final phase or `!isPhaseCompleted(session, currentPhase)`), return `false` and set `session.lastError` with the reason.
2. `isPhaseCompleted()` returns `false` when `getPhaseRequirements(phase)` is empty, or give the remaining phases real requirements — pick one and say which in the PR.
3. `sessionTool` passes `force` from the tool params and shows the refusal reason.

**Touches:** `src/core/orchestrator/taskOrchestrator.ts` → `completeSession`, `isPhaseCompleted`, `getPhaseRequirements`; `src/core/tools/unified/sessionTool.ts` → `complete_session` case.

**Test:** `tests/test-session-persistence.mjs` or a new `tests/taskOrchestrator.test.mjs` — fresh session → `false`; with `force: true` → `true` and `forcedCompletion` recorded.

**Watch out:** Other callers of `isPhaseCompleted` (line 596, phase advancement) will change behavior for phases with no requirements; check they do not get stuck.

### STATE-3 — Task sessions are lost on exit and invisible right after start

**Size:** M · **Depends on:** MEM-3 · **Uses:** —

**Change**
1. `TaskOrchestrator.flushPersist()` *(new)*: clear the pending debounce timer and write now. Register it with `registerShutdownContributor` where the server creates the orchestrator, and call it on the old orchestrator before `onProjectPathChange` replaces it.
2. Resolve the sessions file path once in the constructor (`sessionsFilePath` field); `getSessionsFilePath()` returns the field.
3. Keep the promise of the constructor's `loadSessions()`; `ensureSessionsLoaded()` awaits it instead of starting a second load. Add a public `ready()` and await it before every synchronous read on a tool or resource path (`sessionTool` handler, `analyzeTask` reuse check, `taskTransferTool`, `scopeTool`, `m7://status`, `m7://session`, the hint block in the tool wrapper, `healthCheck`).

**Touches:** `src/core/orchestrator/taskOrchestrator.ts` → constructor, `getSessionsFilePath`, `schedulePersist`, `ensureSessionsLoaded`, `flushPersist` *(new)*, `ready` *(new)*; `src/index.ts` → orchestrator creation, `onProjectPathChange`, resources, tool wrapper; the four tool files above.

**Test:** `tests/deepScanE2E.test.mjs` — real server, `analyze_task`, SIGTERM at once, file present, `status` and `m7://session` after restart. `tests/deepScanAcceptance.test.mjs` — fresh orchestrator over an existing file answers the first `status` call; an orchestrator built for A keeps writing to A after the active project changes.

**Watch out:** A new synchronous reader added later reintroduces (c) silently; the in-process race test only covers `status`, so keep `ready()` at the entry of any new tool that reads sessions.

### STATE-4 — Cross-session knowledge and other project state follow `process.cwd()`

**Size:** M · **Depends on:** — · **Uses:** —

**Change**
1. `KnowledgeAccumulator` takes `projectPath` (default `getProjectPath()`) and builds `basePath` from it; save failures go to `log.warn`. `SessionAnalyzer` derives its project ID from `getProjectPath()`; `extractProjectId()` goes away.
2. `CrossSessionLearning` takes `projectPath` and passes it down. `getCrossSessionLearning()` keeps one instance per resolved project (a `Map`), and `cross-session-tool.ts` drops its own module-level cache and asks for the instance on every call.
3. Every other `process.cwd()` that stands for "the project" becomes `getProjectPath()`: arch advisor default, visualizer graph root, mesh join/registration (and the tool description), telemetry exporters, hook telemetry fallback, retro classifier, git capture.
4. `gitCapture.ts`: `git(args: string[], cwd?)` via `execFileSync('git', args)`; `buildExcludeArgs()` returns an argv array of `:(exclude)<pattern>` entries.

**Touches:** `src/cross-session/knowledge-accumulator.ts`, `session-analyzer.ts`, `index.ts`; `src/core/tools/v3/cross-session-tool.ts`, `arch-advisor-tool.ts`, `visualizer-tool.ts`; `src/mesh/MeshManager.ts`, `src/mesh/tools/meshTool.ts`; `src/telemetry/exporters.ts`, `retroClassifier.ts`, `gitCapture.ts`; `src/core/telemetry/index.ts`.

**Test:** `tests/deepScanAcceptance.test.mjs` — static `process.cwd()` allowlist over `src/`; forced session completion with cwd ≠ project writes `stats.json` under the project only; per-project instances; staged-diff capture in a temp git repo, with and without the `cwd` argument, excludes `yarn.lock`. `tests/deepScanE2E.test.mjs` — server started from another directory.

**Watch out:** Code that captures `getCrossSessionLearning()` once and keeps it outlives a project switch. `TaskOrchestrator` is fine (it is replaced on switch), the hive orchestrators are created per call; a new long-lived holder would bring the bug back. The allowlist in the static test is the place to justify any new `process.cwd()`.

### STATE-5 — The contract registry reports success and keeps almost nothing

**Size:** S · **Depends on:** STATE-1 · **Uses:** B1

**Change**
1. `ContractRegistry` keeps the load promise (`ready()`); the handler awaits it before any action.
2. `loadExistingContracts()` reads all four `api_contracts` sections and keeps the stored `id`, `createdAt` and `lastModified`.
3. `updateSchema()` rethrows after logging. `registerContract()` restores the previous entry on failure and returns `{ success: false, error }`; re-registering a name keeps its `id` and `createdAt`.
4. Registrations run one at a time per process (load → modify → write of one file). The map is unbounded, because it is written whole.

**Touches:** `src/core/tools/critical/contracts.ts` → `ContractRegistry` constructor, `ready` *(new)*, `loadExistingContracts`, `registerContract`, `updateSchema`, handler `register`.

**Test:** `tests/deepScanAcceptance.test.mjs` `[STATE-5]` — four kinds survive a restart with their IDs, re-register, no schema, unparseable schema. `tests/deepScanE2E.test.mjs` — the same through the server.

**Watch out:** `SchemaSystem.updateSection()` replaces arrays and merges objects; if the stored shape becomes a map keyed by name, the merge rules change with it. Other writers of `PROJECT_SCHEMA.yaml` are not in the registry's queue.

## Memory

### MEM-0 — Tracking: one read path for memory

**Size:** L · **Depends on:** — · **Uses:** B3 (introduces it)

**Change**
1. Add `resolveRecord(id)` *(new)*: `recordStore.get(id)` → loop over all five `MemorySystem` levels including `project` → `null`. Make `get()` call it.
2. Add `iterateRecords(filter)` *(new)* that yields from `recordStore` *and* from `MemorySystem` levels not yet cached, applying `levels`/`confidenceThreshold` once. `search()` and the `contradicts` path use it.
3. `searchReferenceFiles()` tags records with `source: 'mirror'` and confidence ≤ 0.6; `applyConfidenceDecay` treats mirrors as lower-trust.
4. `delete()` appends the ID to a persisted `tombstones` set; `searchReferenceFiles()` and `convertToRecord()` skip IDs in it.

**Touches:** `src/memory/auto/unified-memory-core.ts` → `get`, `search`, `delete`, `searchReferenceFiles`, `convertToRecord`, `resolveRecord` *(new)*, `iterateRecords` *(new)*.

**Test:** new `tests/unifiedMemoryReadPath.test.mjs` with four cases (MEM-0a–d), each: do X, construct a fresh core over the same data dir, assert same answer.

**Watch out:** This touches every memory read. Open the issue with the proposed signatures before coding. Keep the `recordStore` cap in mind (MEM-4).

### MEM-1 — `invalidate_bulk` mutates in memory only

**Size:** S · **Depends on:** — · **Uses:** B1

**Change**
1. Add a public `invalidate(id, factor = 0.3)` *(new)* on `UnifiedMemoryCore` that mutates and calls the existing private `persistRecord()`.
2. `invalidate_bulk` in the tool calls it instead of mutating the fetched record.
3. Count only successful persists in the response.

**Touches:** `src/memory/auto/unified-memory-core.ts` → `invalidate` *(new)*, `persistRecord`; `src/core/tools/unified/memoryTool.ts` → `invalidate_bulk` case.

**Test:** `tests/memoryRelations.test.mjs` or new — invalidate, re-open core, `get` → reduced confidence and `invalidatedAt` set.

**Watch out:** `persistRecord` goes through the debounced `MemorySystem.store`; the test must flush (or wait > `FLUSH_DELAY_MS`) before re-opening — which is MEM-3's territory.

### MEM-2 — Confidence `0` becomes `0.5` on load

**Size:** S · **Depends on:** — · **Uses:** —

**Change**
1. `convertToRecord()`: `confidence: data.confidence ?? 0.5`.
2. Audit the same block for other `||` defaults where `0`/`''`/`false` are valid (`accessCount`, flags).

**Touches:** `src/memory/auto/unified-memory-core.ts` → `convertToRecord`.

**Test:** `tests/epistemicStatus.test.mjs` — store with confidence 0, reload, still 0 and status reflects it.

**Watch out:** Anything that *relied* on 0 being bumped (unlikely, but grep for callers that store 0 as "unset").

### MEM-3 — Pending memory writes are dropped on shutdown

**Size:** S · **Depends on:** — · **Uses:** B1

**Change**
1. `gracefulExit()` becomes `async`: `await Promise.race([flushAll(), sleep(2000)])` then `process.exit(0)`.
2. `flushAll()` *(new)* calls the existing `MemorySystem.shutdown()` on both instances — `this.memory` in `index.ts` and the one inside `getMemoryCore()` (expose `shutdown()` on `UnifiedMemoryCore` that forwards).
3. Keep `_shutdownRequested` so a second signal during the flush does not re-enter.

**Touches:** `src/index.ts` → `gracefulExit`, `flushAll` *(new)*; `src/memory/auto/unified-memory-core.ts` → `shutdown` *(new)*; `src/memory/memorySystem.ts` → `shutdown` (exists).

**Test:** new `tests/reliability/shutdownFlush.test.mjs` — spawn the server, store, send SIGTERM, start again, record present.

**Watch out:** `process.exit` inside a `stdin 'close'` handler while the flush awaits — make sure the event loop stays alive (the pending promise does that). Do not flush on `uncaughtException`.

### MEM-4 — Loading more than 2000 long-term records evicts and then rewrites the file

**Size:** S · **Depends on:** — · **Uses:** —

**Change**
1. For persisted levels (`longterm`, `conceptual`), use a plain `Map` or a `BoundedMap` whose cap is `Math.max(default, loadedCount * 1.5)` set after `loadPersistedMemory()`.
2. In `flushPendingWrites()`, before writing a level file, compare entry counts: if the map holds fewer entries than were loaded and no explicit delete happened, log at `error` and skip the write.
3. Record `loadedCounts[level]` in `loadPersistedMemory()`.

**Touches:** `src/memory/memorySystem.ts` → constructor, `loadPersistedMemory`, `flushPendingWrites`; `src/core/utils/boundedMap.ts` (optional `setMaxSize`).

**Test:** new `tests/memorySystem.test.mjs` — 2100-entry `longterm.json`, load, store one more, flush, file still has ≥ 2100 entries.

**Watch out:** The in-process memory ceiling this bound was protecting against still matters for long sessions; the guard in step 2 is what keeps the fix from becoming "no limit at all".

Done differently in the end: the bound was raised at load time first, which left runtime eviction in place (MEM-5). The persisted levels are now plain maps; the guard from step 2 stays.

### MEM-5 — Runtime eviction from bounded collections deletes records from disk

**Size:** S · **Depends on:** MEM-4 · **Uses:** —

**Change**
1. `longterm`, `conceptual` and `fogOfWar` become plain `Map`s; `surface` and `working` keep their bounds (RAM only).
2. Drop `resizeStorageCap()` and the default caps; keep `loadedEntryCount` / `explicitDeletes` and the refusal to persist a map smaller than what was loaded.
3. `deletedIds` in `unified-memory-core.ts` becomes a plain `Set`.

**Touches:** `src/memory/memorySystem.ts` → constructor, `loadPersistedMemory`; `src/memory/auto/unified-memory-core.ts` → `deletedIds`.

**Test:** `tests/deepScanAcceptance.test.mjs` `[MEM-5]` — the review's 1 + 2000 trace, conceptual 1001, the public `store` path, fog 600 + 501, tombstones 5001 + 1, an early write before the load.

**Watch out:** `recordStore` stays bounded on purpose: it is a cache, and a miss falls through to `MemorySystem`. Anything new that is both bounded and written whole repeats this item.

### MEM-6 — Every schema read stores another copy of the schema in long-term memory

**Size:** S · **Depends on:** — · **Uses:** —

**Change**
1. Remove the `memoryCore.store(...)` block from `SchemaSystem.loadSchema()`, with the `memoryCore` field and the import.

**Touches:** `src/schema/schemaSystem.ts` → `loadSchema`.

**Test:** `tests/deepScanAcceptance.test.mjs` `[MEM-6]` — three `loadSchema()` calls, record count unchanged. `tests/deepScanE2E.test.mjs` — three `analyze_task` calls leave no copy.

**Watch out:** Copies written by older versions stay in users' `longterm.json`; KNOWN_ISSUES says how to find them.

### MEM-7 — Memory flushes overlap and are not awaited, so writes are lost

**Size:** M · **Depends on:** MEM-3 · **Uses:** —

**Change**
1. `MemorySystem` gets one write chain: `serializeWrite(task)` runs a write after the previous one. `flushPendingWrites()` queues at most one flush (later stores join it) and returns its promise; level, fog and project writes and `delete()` all go through the chain.
2. `shutdown()` awaits the queued flush and then the chain.
3. `store()`, `discoverTechnicalDetail()` and `updateProjectMemory()` await `ensureLoaded()`.
4. `getMemoryCore()` and the project-change hook retire the previous core: call its `shutdown()` and keep the promise; `shutdownMemoryCore()` awaits the current core and every retiring one.
5. Tombstone writes in `UnifiedMemoryCore` get the same kind of chain, reading the set when the write starts.

**Touches:** `src/memory/memorySystem.ts` → `scheduleFlush`, `flushPendingWrites`, `serializeWrite` *(new)*, `shutdown`, `store`, `delete`, `discoverTechnicalDetail`, `updateProjectMemory`; `src/memory/auto/unified-memory-core.ts` → `getMemoryCore`, `retireMemoryCore` *(new)*, `shutdownMemoryCore`, `persistTombstones`, `shutdown`.

**Test:** `tests/deepScanAcceptance.test.mjs` `[MEM-7]` — 50 / 120 / 2000 stores then exit, 500 stores without shutdown, a delete during flushes, a store right before a project switch.

**Watch out:** A write task that awaits `flushPendingWrites()` from inside the chain waits for itself; keep writes inside the chain free of calls back into it.

## Task graph and transfer

### GRAPH-1 — Depth-limited DFS marks nodes visited at the wrong depth

**Size:** S · **Depends on:** — · **Uses:** —

**Change**
1. Replace `visited: Set<string>` with `bestDepth: Map<string, number>`.
2. `if (depth < 0) return; const seen = bestDepth.get(id); if (seen !== undefined && seen >= depth) return; bestDepth.set(id, depth);`
3. Or rewrite `traverse` as BFS with a `(node, depth)` queue — simpler to reason about.

**Touches:** `src/core/task-graph/taskGraphManager.ts` → `getSubgraph`.

**Test:** new `tests/taskGraph.test.mjs` — diamond graph `A→B→C`, `A→C`, `C→D`, depth 2 from A: `D` is included regardless of edge order.

**Watch out:** Edge order in the stored JSON determines whether the bug shows; the test must set it explicitly.

### GRAPH-2 — Transfer task IDs can collide and overwrite

**Size:** S · **Depends on:** — · **Uses:** —

**Change**
1. ``newTaskId = `task_${slug}_${randomBytes(3).toString('hex')}` `` (or a monotonic counter persisted in the graph).
2. `createTask()` throws if `graph.nodes[id]` exists.

**Touches:** `src/core/task-transfer/transferManager.ts` → ID generation in `transfer`; `src/core/task-graph/taskGraphManager.ts` → `createTask`.

**Test:** `tests/taskGraph.test.mjs` — frozen `Date.now`, two transfers with the same description → two nodes.

**Watch out:** Folder name `docs/debug/<id>` is derived from the ID; keep it filesystem-safe.

### GRAPH-3 — Failed transfer leaves an orphan task

**Size:** M · **Depends on:** GRAPH-2 (for the throw) · **Uses:** —

**Change**
1. Add `deleteTask(id)` *(new)* to `TaskGraphManager` (removes node and its links, saves).
2. In `transfer()`, snapshot the source node (`structuredClone`) before the first mutation and wrap `createTask` → `updateTaskStatus` → `createLink` in `try`; on failure, `deleteTask(newTaskId)` and `restoreTask(snapshot)` *(new)*, then report the error. Restoring only `status` is not enough: `updateTaskStatus('transferred')` also sets `outcome` and `completed` (this is what 3.21.0 missed).
3. Alternative: add `applyBatch(mutations)` *(new)* that mutates a clone of `graph` and calls `save()` once — one write, no partial state.

**Touches:** `src/core/task-transfer/transferManager.ts` → `transfer`; `src/core/task-graph/taskGraphManager.ts` → `deleteTask` *(new)* or `applyBatch` *(new)*, `save`.

**Test:** `tests/taskGraph.test.mjs` — stub `createLink` to throw; graph JSON before equals graph JSON after.

**Watch out:** `saveTaskMeta()` also writes files under `docs/debug/<id>`; the rollback has to remove those too, or document that they are left behind. (As of 3.22.1 `executeTransfer` never creates that folder, so `saveTaskMeta` fails with a warning and nothing is left on disk; the acceptance test asserts that.)

## Gates and output

### GATE-1 — Grounding treats `path:` references as memory lookups, not file checks

**Size:** S · **Depends on:** — · **Uses:** —

**Change**
1. In `resolvePremiseRef()`, for `path:` refs: `fs.access(path.resolve(projectPath, p))` → if it exists, return a synthetic record `{ status: 'KNOWN', source: 'filesystem', confidence: 0.8 }`; if a fog entry also exists, merge its confidence/freshness on top.
2. Nonexistent file → `null` as today.
3. Pass `projectPath` into the gate (it already has access to the memory core; take the path from there or from `getProjectPath()`).

**Touches:** `src/core/orchestrator/groundingGate.ts` → `resolvePremiseRef`, `runGroundingCheck` (merges results into the report).

**Test:** `tests/groundingGate.test.mjs` — premise `path:` to a temp file with no fog entry → FOUND; to a missing file → NOT_FOUND.

**Watch out:** Paths with `..` escaping the project should be treated as NOT_FOUND, not resolved.

### GATE-2 — Irreversible steps with no premises raise no warning

**Size:** S · **Depends on:** — · **Uses:** —

**Change**
1. Before the `premise_ids` loop: `if (step.reversibility === 'irreversible' && step.premise_ids.length === 0) warnings.push({ level: 'strong', step: step.id, reason: 'irreversible step with no premises' })`.
2. Same for a missing `premise_ids` field.

**Touches:** `src/core/orchestrator/groundingGate.ts` → step loop inside `runGroundingCheck` (L226-240).

**Test:** `tests/groundingGate.test.mjs` — one irreversible step, empty premises → exactly one `strong` warning naming the step.

**Watch out:** Reversible steps with no premises should stay a soft warning at most, or the gate becomes noisy.

### GATE-3 — Response noise: gate prompt repeated, error banner without a source

**Size:** S · **Depends on:** — · **Uses:** —

**Change**
1. Render the gate prompt in exactly one place — `formatCycleResponse()` in `cycleTool.ts`. Remove the copies from `goal` (orchestrator L563) and the instruction body (L580); keep `gate.prompt` as data.
2. In `hintGenerator.ts`, either drop the `recentErrors` banner or change the condition to a delta over a time window and include `category` and `count` in the text. `journal.getErrorsByType()` returns cumulative counts, so "increasing" is not something the current data can support.

**Touches:** `src/core/orchestrator/cycleOrchestrator.ts` → `generateInstruction` (L563, L580); `src/core/tools/cycleTool.ts` → `formatCycleResponse`; `src/core/utils/hintGenerator.ts` → error-hint block; `src/index.ts` L796-806 (what feeds it).

**Test:** `tests/cycleOrchestrator.test.mjs` — formatted response contains `Gate-ID:` exactly once. Hint: unit test on `generateIntelligentHints` with cumulative counts → no banner.

**Watch out:** Some tests may grep the response for gate text that currently appears in `goal`; update them to look in the rendered section.

## Hygiene and documentation

### HYG-1 — Task IDs: non-Latin descriptions produce an empty slug

**Size:** S · **Depends on:** — · **Uses:** —

**Change**
1. In `generateTaskId()` / `generateSlug()`: if the Latin slug is empty, use the first 8 hex chars of `sha1(description)`.
2. Replace the clock suffix with `randomBytes(3).toString('hex')`.
3. `generateSlug()` names the artifact folder; give it a Unicode filter (`[^\p{L}\p{M}\p{N}\s-]` with `u`) plus the same hash fallback. 3.21.1 changed only `generateTaskId`, so CJK, emoji and punctuation-only descriptions still wrote artifacts into the `m7-cycles/` root.

**Touches:** `src/core/orchestrator/cycleOrchestrator.ts` → `generateTaskId`, `generateSlug`.

**Test:** `tests/cycleOrchestrator.test.mjs` — two Cyrillic descriptions → distinct, non-empty slugs; ID matches `/^cycle_[a-z0-9-]+_[0-9a-f]{6}$/`.

**Watch out:** Artifact folders are named from the slug; existing folders keep working because old IDs are not regenerated.

### HYG-2 — Hive result cache key collapses non-Latin and order-sensitive tasks

**Size:** S · **Depends on:** — · **Uses:** —

**Change**
1. `hashTask()`: `.replace(/[^\p{L}\p{N}\s]/gu, ' ')`, no `.sort()`.
2. If fuzzy reuse is wanted, keep an exact hash as the key and add a separate similarity check at lookup (e.g. Jaccard over word sets with a threshold) rather than folding it into the key.

**Touches:** `src/hive/cache/taskResultCache.ts` → `hashTask`, `get`.

**Test:** new `tests/hiveCache.test.mjs` — Cyrillic pair distinct; `"move A to B"` vs `"move B to A"` distinct.

**Watch out:** Existing cache files become misses after the change; acceptable, but say so in the PR.

### HYG-3 — Shell command built by string interpolation

**Size:** S · **Depends on:** — · **Uses:** —

**Change**
1. Replace `execAsync(cmd)` with `execFile('grep', ['-r', '-c', '-i', '-e', keyword, ...excludeArgs, ...includeArgs, '--', projectPath])` (promisified). `-e` and `--` keep a keyword or path that starts with `-` from being read as an option.
2. Handle exit code 1 (no matches) as empty output rather than an error.

**Touches:** `src/hive/context/fileSearcher.ts` → the search function around L44.

**Test:** new `tests/fileSearcher.test.mjs` — temp project dir with a space and a quote in its name; a known keyword is found.

**Watch out:** `--include`/`--exclude-dir` need to be separate array elements, not one quoted string.

### HYG-4 — Debug tool prints API key prefixes

**Size:** S · **Depends on:** — · **Uses:** —

**Change**
1. Delete `src/test-tool.ts` and its registration in the tool list.
2. If a diagnostic is still wanted, fold "key present: yes/no" into `mcp_m7_doctor`.
3. Reduce the other prefix sites to present/absent: the `mcp_m7_hive_coordinator` "Debug Info" block and debug log, and the `M7_DEBUG` startup log in `src/index.ts`.

**Touches:** `src/test-tool.ts` (remove); the tool registry that imports it; `docs/TOOLS_REGISTRY.md`; `src/hive/tools/hiveCoordinator.ts`; `src/index.ts`.

**Test:** tool list does not contain `mcp_m7_test_tool`; `npm run build` passes.

**Watch out:** README or docs that mention the tool.

### HYG-5 — README describes rule re-injection as counting "tool calls"

**Size:** S · **Depends on:** — · **Uses:** —

**Change**
1. README L24: "after N `mcp_m7_cycle` calls in the same phase". L129: same wording for `M7_RULE_REINJECTION_THRESHOLD`.
2. Add one sentence: an MCP server only observes calls to its own tools.

**Touches:** `README.md`.

**Test:** none.

**Watch out:** —

### HYG-6 — `M7CodeInterceptor` is dead code

**Size:** S · **Depends on:** — · **Uses:** —

**Change**
1. Delete `src/core/enforcement/codeInterceptor.ts`; remove the directory if it becomes empty.
2. Grep docs for "interceptor"/"enforcement level" and adjust wording so nothing promises server-side interception.

**Touches:** `src/core/enforcement/codeInterceptor.ts` (remove); any `docs/*.md` mentioning it.

**Test:** `npm run build` passes; `npm test` unchanged.

**Watch out:** —

### HYG-7 — Architecture context search runs task text through a shell

**Size:** S · **Depends on:** — · **Uses:** —

**Change**
1. `buildRipgrepArgs(keyword)` *(new, exported)*: `['--json', '-C', '1', '--max-count', '3', '--max-filesize', '100K', '--type', 'ts', '--type', 'js', '--fixed-strings', '-e', keyword, '--', '.']`. `--fixed-strings` replaces the hand-written regex escape; the explicit `.` stops `rg` from reading the server's stdin.
2. `searchWithRipgrep` calls `execFile('rg', buildRipgrepArgs(kw), { cwd: projectPath, timeout, maxBuffer })`; exit code 1 is "no matches", anything else is logged.
3. Strip a leading `./` from `data.path.text` so result paths look the same as before.

**Touches:** `src/core/architecture/architecture-context-analyzer.ts` → `searchWithRipgrep`, `buildRipgrepArgs` *(new)*.

**Test:** `tests/deepScanAcceptance.test.mjs` — the injection payload with `PATH=/usr/bin:/bin` creates no file; with `rg` installed, a marker identifier is found in well under the 2000 ms timeout; the argv keeps the keyword as one element.

**Watch out:** The "found" test needs `rg`; it skips when `rg` is missing, the injection test does not.

### HYG-8 — Server reports version 2.0.0 regardless of the package version

**Size:** S · **Depends on:** — · **Uses:** —

**Change**
1. `src/core/utils/packageVersion.ts` *(new)*: `PACKAGE_VERSION` read once from `new URL('../../../package.json', import.meta.url)` (same depth from `src/` and `dist/`).
2. Use it for `McpServer({ version })` and the `m7://status` resource; replace the private `getM7Version()` in `src/telemetry/collector.ts` with it.

**Touches:** `src/index.ts`, `src/telemetry/collector.ts`, `src/core/utils/packageVersion.ts` *(new)*.

**Test:** `tests/deepScanE2E.test.mjs` — `client.getServerVersion().version` and `m7://status` `version` equal `package.json`.

**Watch out:** Per-tool `version` fields in `src/core/registry/toolsRegistry.ts` are tool versions, not the package version; leave them.

### HYG-9 — `analyze_task` runs `docker compose up -d` on a compose file from the working directory

**Size:** S · **Depends on:** — · **Uses:** —

**Change**
1. Delete `tryStartDocker()`, the `autoStartDocker` option and the `dockerStartAttempted` / `dockerStartSuccess` fields and their output block; drop the export from `src/core/health/index.ts`.
2. ChromaDB offline hint: `optional: start ChromaDB at <CHROMA_URL> or set CHROMA_URL; memory uses local JSON until then`. Command-style hints carry their own backticks; the formatter prints the hint as is.
3. `analyzeTask.ts` calls `checkSystemHealth()` without options.

**Touches:** `src/core/health/healthCheck.ts`, `src/core/health/index.ts`, `src/core/tools/analyzeTask.ts`.

**Test:** `tests/deepScanE2E.test.mjs` — server started from a directory with `compose.yml` and a stub `docker` on `PATH`, `CHROMA_URL` at a closed port: stub never called, response names the URL and does not mention docker. `tests/deepScanAcceptance.test.mjs` — `checkSystemHealth()` result and hint; `tryStartDocker` not exported.

**Watch out:** Pin `CHROMA_URL` in the tests; a ChromaDB running on the developer's machine at the default port makes the health block "healthy" and the assertions about the hint vacuous.

### HYG-10 — Unreachable modules keep defects that the live paths no longer have

**Size:** S · **Depends on:** HYG-3, HYG-7 · **Uses:** —

**Change**
1. Delete `src/core/verification/`, `src/core/tools/v3/auto-memory-tool.ts`, and the modules only it imports: `src/memory/auto/{index,project-registry,context-injector,types}.ts`.
2. In `unified-memory-core.ts`, delete `PersistentMemory`, `createPersistentMemory`, `IndexReport`, `invalidateDependents()`, `updateWithInvalidation()`. Keep `getDependencyGraph()` / `getStaleRecords()` and the `dependencies` / `dependents` fields: `mcp_m7_memory store` still accepts `dependencies`.
3. `projectScanner.scanGitInfo()`: `execFile('git', argv)`, each field read independently.

**Touches:** the files above; `tests/phase2/test-smart-context.mjs` (drop the cascade cases).

**Test:** `tests/deepScanAcceptance.test.mjs` — removed files absent from `src/` and `dist/`; removed exports and methods undefined; static scan of `child_process` imports in `src/` (only `execFile` / `execFileSync`, no `shell: true`); `scanGitInfo()` on a temp repo without `origin`.

**Watch out:** `npm run build` must clean `dist/` first (it does, via `prebuild`), otherwise the removed modules survive in the build and the absence test passes or fails depending on build history.

### HYG-11 — `require()` in ES modules throws, and the surrounding `catch` hides it

**Size:** S · **Depends on:** — · **Uses:** —

**Change**
1. `knowledge-graph/index.ts`: static imports of `existsSync`, `statSync`, `join`, `getProjectPath` (no import cycle: `projectPath.ts` does not import the graph).
2. `mesh/MeshManager.ts`: `import { homedir, hostname } from 'os'`.
3. `tsi/index.ts`: `createTSISystem()` uses the `TSISystemClass` import already at the bottom of the file.

**Touches:** the three files.

**Test:** `tests/deepScanAcceptance.test.mjs` — TypeScript-AST scan of `src/` for `require(...)` calls; `createTSISystem()`; mesh `init` + `join` + `leave` in a temp directory.

**Watch out:** Scan the AST, not the text: `require(` occurs in strings and regexes in `src/`. Pass a temp directory to `init()`; the default is `~/.m7/mesh`.

---

## Suggested PR grouping

Items that go well together in one PR: CYC-2 + CYC-3; CYC-5 + CYC-6; MEM-1 + MEM-2; GRAPH-2 + GRAPH-3; HYG-4 + HYG-6.

Items that should stay alone: CYC-1 (changes a tested policy), STATE-1 (defines B1 for everyone else), MEM-0 (shared read path), MEM-4 (data-loss guard — easy to review on its own, hard inside a larger diff).

When a PR lands, update the item's status in [KNOWN_ISSUES.md](../KNOWN_ISSUES.md); if the approach differed from the plan here, replace the plan with one line saying what was done and why, so the next reader does not follow a stale sketch.
