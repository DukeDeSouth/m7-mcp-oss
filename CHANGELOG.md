# 📝 Changelog

All notable changes to M7 MCP Server will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Public snapshot - 2026-10

This is the open-source snapshot of M7 MCP. Compared to the internal tree it
drops the self-update/licensing client, the private-beta access check and one
unfinished experimental module, and telemetry upload is now opt-in (no default
endpoint; set `M7_TELEMETRY_ENDPOINT` to use your own collector). Entries below
that mention those pieces describe history, not what ships here.

## [Unreleased]

## [3.22.2] - 2026-10-30

### Fixed
- **HYG-11:** `require()` in three ES modules threw `ReferenceError` (the package is `"type": "module"`) and the surrounding `catch` hid it: joining the mesh never wrote the presence file, the knowledge-graph cache was never read, and `createTSISystem()` threw. Replaced with static imports; the acceptance suite scans the TypeScript AST of `src/` for `require(...)` calls.

### Tests
- **MEM-7:** The ordering test holds the first file write and counts concurrent writes instead of waiting 2.5 s, so the "no write queue" mutant is killed on every run (it survived some runs before).

## [3.22.1] - 2026-10-30

Found by the deep scan acceptance suites (`tests/deepScanAcceptance.test.mjs`, `tests/deepScanE2E.test.mjs`, `tests/deepScanTraceability.test.mjs`) — see [docs/COMMUNITY_SPRINT.md](docs/COMMUNITY_SPRINT.md) (batch 6).

### Security
- **HYG-7:** Architecture context search (`mcp_m7_analyze_task`) ran backticked task text through a shell (`exec('rg "<kw>" …')`); a `"` in the keyword executed the rest as commands when `rg` was not on `PATH`. Now `execFile('rg', argv)` with `--fixed-strings -e <kw> -- .`; with `rg` present the search no longer blocks on stdin until the 2 s timeout, so it actually returns results.

### Fixed
- **STATE-3:** Task sessions created less than 500 ms before exit were lost (debounced write not drained on shutdown); a debounced write after a project switch went to the new project; the first tool call after start could report a persisted session as "not found". `TaskOrchestrator.flushPersist()` is a shutdown contributor, the sessions file path is fixed at construction, and tool/resource entry points await `ready()`.
- **STATE-4:** Cross-session knowledge was stored in `<cwd>/.m7/cross-session/` instead of the active project, with one process-wide instance pinned to the first project and save errors logged at debug level only. Storage now follows `getProjectPath()`, `getCrossSessionLearning()` keeps one instance per project, and save failures log at warn. Arch advisor, visualizer, mesh, telemetry exporters, hook telemetry, retro classifier and git capture also use the active project instead of cwd; git capture runs `git` via `execFileSync` with an argument list.
- **GRAPH-3:** Transfer rollback restores the whole source node (`restoreTask`), not only `status`; `outcome` and `completed` no longer survive a failed transfer.
- **CYC-2:** A client retry of an accepted reflection is replayed by content hash instead of being accepted as the next phase's artifact.
- **HYG-1:** `generateSlug` keeps letters of any script and falls back to a hash, so CJK/emoji/punctuation-only cycles no longer write artifacts into the `m7-cycles/` root.
- **HYG-3:** `grep` argv passes the keyword after `-e` and ends options with `--`.
- **HYG-4:** `mcp_m7_hive_coordinator` debug block (also saved into the hive report file), its debug log, and the `M7_DEBUG` startup log show key presence only, not a prefix.
- **HYG-8:** `serverInfo.version` and `m7://status` report the package version (`PACKAGE_VERSION`) instead of `2.0.0`.
- **HYG-9:** `mcp_m7_analyze_task` no longer runs `docker compose up -d` on a compose file from the server's working directory when ChromaDB is offline (and no longer waits up to 15 s for it). The offline hint names `CHROMA_URL` and the local JSON fallback.
- **HYG-10:** Removed unreachable code that repeated already-fixed defects: `src/core/verification/` (`execSync` with interpolated `grep`), the unregistered auto-memory tool with its `memory/auto` modules and the `PersistentMemory` wrapper (`importance || 0.7`, RAM-only `deleteBySource`), and `invalidateDependents` / `updateWithInvalidation` (RAM only, confidence 0 → 0.56). `projectScanner` git info uses `execFile` and no longer loses branch and last commit in repos without an `origin` remote.
- **CYC-10:** Cycles with the same description shared one artifact folder: the second cycle's INTAKE was appended to the first one's as a resubmission and its registry row replaced the first one's. Artifact folders are now `m7-cycles/<slug>-<id suffix>/`; a start reserves the ID and creates the folder exclusively, tries another suffix when either is taken, and fails rather than share. Cycles created earlier keep their folders. Old-cycle cleanup runs in the project of the cycle being started.
- **STATE-5:** `mcp_m7_contracts` answered "registered successfully" when nothing was saved, and `list` returned nothing even right after a registration. Each call read the registry before its load finished, only functions were loaded, IDs changed on every load, and a failed write was swallowed. The handler now awaits the load, all four sections are read with their IDs and dates, registrations are serialized, and a failed write returns `success: false` naming `PROJECT_SCHEMA.yaml` and `mcp_m7_init_project`.
- **MEM-5:** Long-term memory past 2000 records, conceptual past 1000, fog of war past 500 entries and tombstones past 5000 lost their oldest entries on disk, because the bounded working map was written whole. Persisted collections are no longer bounded; L0/L1 (RAM only) keep their limits.
- **MEM-6:** Every `analyze_task` (and every other schema read) stored another full copy of `PROJECT_SCHEMA.yaml` in long-term memory at confidence 1.0. Reading the schema no longer writes anything. Copies from earlier versions are not removed; see KNOWN_ISSUES MEM-6.
- **MEM-7:** From 50 pending writes on, memory flushes ran concurrently and unawaited, so an older snapshot could be written last and `shutdown()` returned while writes were still in flight (120 stores then exit → 50 on disk). All writes of one memory instance now go through one queue, `shutdown()` waits for it, a core replaced by a project switch is drained before exit, and tombstone writes are queued the same way.

### Changed
- KNOWN_ISSUES has a "Review findings" table mapping every numbered finding of the October 2026 review to its items; the traceability test checks it. The "Not on this list" entry about cycle-ID collisions was wrong (see CYC-10) and is gone.
- README: new "What is stored and for how long" section; the grounding gate's scope is listed under known limitations; the note about tests writing into `.m7/` in the repo is replaced by the isolation rule.
- `npm run build` removes `dist/` first (`prebuild`), so deleted sources no longer leave stale modules behind (`dist/test-tool.js`, `dist/core/enforcement/codeInterceptor.js` were still present).
- `scripts/run-tests.sh` runs every `tests/*.test.mjs` and `tests/reliability/*.test.mjs` and fails if a test run leaves files in the repository.
- README: escaped backticks around `mcp_m7_cycle` rendered literally (HYG-5 wording).

## [3.22.0] - 2026-10-30

### Fixed
- **GATE-3:** Reflection gate template rendered once in `formatCycleResponse`; removed duplicate embed in instruction/artifact template; dropped misleading cumulative error banner in hints.
- **HYG-3:** Hive file search uses `execFile('grep', argv[])` instead of shell string interpolation.
- **HYG-4:** Removed `mcp_m7_test_tool` (API key prefix leak).
- **HYG-6:** Removed unused `M7CodeInterceptor` dead code.

### Changed
- **HYG-5:** README clarifies rule re-injection counts `mcp_m7_cycle` calls only (MCP-visible tools).

## [3.21.1] - 2026-10-30

### Fixed
- **CYC-8:** `registerSummary` replaces an existing registry row for the same cycle folder instead of appending duplicates; summary includes `[status]`.
- **HYG-1:** `generateTaskId` uses SHA-1 slug fallback for non-Latin descriptions and `randomBytes(3)` suffix (KNOWN_ISSUES HYG-1).

## [3.21.0] - 2026-10-30

### Fixed
- **GATE-2:** Irreversible grounding steps with empty `premise_ids` emit one **strong** warning (KNOWN_ISSUES GATE-2).
- **GRAPH-1:** Depth-limited subgraph traversal re-expands nodes when reached with greater remaining depth (`bestDepth` map).
- **GRAPH-2:** Transfer task IDs use random suffix; `createTask` refuses duplicate IDs.
- **GRAPH-3:** Failed transfer rolls back new task and restores source status (`deleteTask`).
- **HYG-2:** Hive task result cache keys preserve word order and Unicode letters (`hashTask`).

## [3.20.1] - 2026-10-30

### Fixed
- **GATE-1:** Grounding `path:` premise refs verify filesystem under project root (with traversal guard); Fog of War enriches when present (KNOWN_ISSUES GATE-1).

## [3.20.0] - 2026-10-30

### Fixed
- **MEM-0:** Unified memory read path — `resolveRecord` / `iterateRecords`, persisted tombstones (`.m7/memory-tombstones.json`), mirror provenance with capped confidence, L4 records durably stored keyed in longterm; `getActiveConflicts()` async (KNOWN_ISSUES MEM-0a–d).

## [3.19.0] - 2026-10-30

Stage 1 remainder + Stage 2 cycle protocol — see [docs/COMMUNITY_SPRINT.md](docs/COMMUNITY_SPRINT.md) (batch 2).

### Fixed
- MEM-1: `invalidate_bulk` / `UnifiedMemoryCore.invalidate()` persist STALE state to L2/L3; L0/L1 fail closed without RAM mutation (KNOWN_ISSUES MEM-1).
- MEM-2: `convertToRecord` preserves stored `confidence` / `metadata.importance` of `0` on reload (KNOWN_ISSUES MEM-2).
- MEM-4: `BoundedMap` capacity grows when loading large longterm/conceptual files; persist guard when in-memory count would truncate loaded data (KNOWN_ISSUES MEM-4).
- CYC-7: Re-submitting a phase artifact appends with a timestamp separator; failed artifact write returns `Artifact not persisted` (KNOWN_ISSUES CYC-7).
- CYC-9: `cleanupOldCycles` skips active cycles; archives old completed state under `.m7/cycles/archive/` (KNOWN_ISSUES CYC-9).
- CYC-2: Per-task serialized submit; idempotent replay via `lastAccepted` sha256 (KNOWN_ISSUES CYC-2).
- CYC-3: Terminal `completed` / `aborted` cycles reject further submits (KNOWN_ISSUES CYC-3).
- CYC-4: Cycle I/O uses `projectPath` captured at `startCycle` (KNOWN_ISSUES CYC-4).
- CYC-6: Carry-forward uses the latest reflection per phase after rewind (KNOWN_ISSUES CYC-6).

### Changed
- CYC-5: Separate `shortArtifactAttempts` and `rewindCount`; third consecutive short artifact returns phase-stuck instead of force-accepting (KNOWN_ISSUES CYC-5). **Breaking:** clients that relied on a third short submit to advance must submit a valid artifact or abort.

## [3.18.1] - 2026-10-29

Stage 1 community fix sprint (batch 1) — see [docs/COMMUNITY_SPRINT.md](docs/COMMUNITY_SPRINT.md).

### Fixed
- CYC-1, STATE-1, STATE-2, MEM-3 (details in entries below under prior Unreleased)

## [Unreleased — prior epistemic work]

### Added
- Epistemic status view layer: `getEpistemicStatus()` / `getEpistemicView()` over memory records (KNOWN, ASSUMED, STALE, UNKNOWN, HUMAN_CONFIRMED)
- MCP memory search, fog query, and get responses show epistemic labels alongside stored/effective confidence
- `source: human` supported on memory store actions
- Frontier-driven discovery gate (Sprint 2): `boundary_status` on FogOfWar entries (explored / frontier / unknown), frontier report injected at discovery reflection gate, blocking unknowns spawn recon tasks via TaskGraphManager
- `discover_technical` MCP action writes to `fog_of_war.json` (via `discoverTechnical`) with optional `blocking` and `critical_path` params
- Discovery phase template: unknown-unknowns checklist and Fable5 rule (unrecognized entity on critical path → fog UNKNOWN, not guess)
- Epistemic Grounding Gate (Sprint 3): solution artifact `grounding` JSON verified against `getEpistemicStatus`; warnings in solution/simulation reflection gates; reversible vs irreversible step tiers
- Typed memory dependency edges (Sprint 4): optional `dependency_specs` / `dependencyRelations` (`supports`, `contradicts`, `refines`, `derived_from`); explicit `contradicts` downgrades confidence on both records and surfaces conflicts in memory/fog reports
- Adversarial Review gate (Sprint 4): mandatory `## Adversarial Review` section in solution artifact template; gate extension at solution phase with reframing signal (Fable 5)
- Epistemic quality metrics (Sprint 5): `grounded-ratio`, `frontier-shrink-rate`, `hypothesis-refutation-rate` computed at M7 cycle completion; appended to `.m7/epistemic-metrics.jsonl`; optional `m7_session.outcome.epistemic` telemetry payload
- Promotion consolidation (Sprint 6): L1→L2 split-record promotion with `needs_consolidation`; host-mediated `consolidate` MCP action; structural validation (Decision Rationale + Citations); original retained at lower tier per §3.8.4.6
- Control-channel integrity (Sprint 7): shared `CONTROL_CHANNEL_NOTICE` in gate templates and carry-forward; `gateInstructionId` nonce issued on artifact submit, validated in `submitReflection`; legacy cycles without nonce skip layer 2
- Long-session rule reinjection (Sprint 8): `phaseMcpCallCount` per phase; after `cycle.rule_reinjection_threshold` (default 18) MCP appends compact rule summary from state; counter resets after inject and on phase change; env override `M7_RULE_REINJECTION_THRESHOLD`

## [3.17.0] - 2026-03-02

### Added — Cycle Orchestrator v2
- Reflection Gates between phases: continue / pivot / rewind / abort decisions
- Carry-forward context: previous phases summarized in table for cross-session continuity
- Template headers auto-prepended to artifacts for human readability
- Artifact file links in every phase instruction and carry-forward table
- Brief auto-summary (blockquote) shown after each artifact submission
- Behavioral Equivalence checklist in IMPACT and SIMULATION templates

### Added — Enforcement System v0.3
- Automatic AI behavior control via code interceptor
- Production gate and scope guard
- Enhanced lock system

### Added — Knowledge Hub v1.0
- TypeScanner, AutoSyncTriggers, backup utilities
- Knowledge graph integration

### Changed
- Hive AI models updated (GPT-5, Claude Sonnet 4.5)
- Simplified tool registry — removed deprecated tools (locks, versioning, navigation, enterprise dashboard)
- Improved logger, schema converter, import scanner

---

## [3.16.0] - 2026-02-07

### Added - Mesh File Exchange (v10.1)

**Push/pull files between workstations** via Mesh Relay — no git required.

| Action | Description |
|--------|-------------|
| `push-file` | Read local file, upload to relay, notify all peers |
| `pull-file` | Download file from relay, save to local disk |
| `list-files` | List all shared files on relay with metadata |

- Path traversal protection (realpath + prefix check)
- Blocked extensions: `.env`, `.key`, `.pem`, `.p12`, `.pfx`, `.jks`, `.credentials`
- No client-side file size limit (relay-side 1MB HTTP body limit)
- **Files:** `src/mesh/tools/meshTool.ts` (+3 actions, ~120 lines)

### Added - Codex Martianus Tools

Two new MCP tools based on the Codex Martianus — ritual enforcement of M7 methodology.

**`mcp_m7_repentance`** — AI confession tool for M7 deviations:
| Action | Description |
|--------|-------------|
| `confess` | Record heresy: what happened, mistake type, how M7 would have helped |
| `wall_of_shame` | View all recorded confessions |
| `stats` | Heresy statistics and patterns |

- 7 heresy types from Codex Martianus (guesswork, haste, false_certainty, severed_chain, surface_healing, premature_closure, hollow_gesture)
- **File:** `src/core/tools/repentanceTool.ts` (new)

**`mcp_m7_litany`** — sacred text recitation before work:
| Action | Description |
|--------|-------------|
| `recite` | Full Inner Litany of the Enlightened Mind |
| `section` | Specific section (purification, adherence, mechanism, fidelity, completion) |
| `rite` | Rite of Activation for major tasks |
| `invoke` | Specific invocation by name |
| `sevenfold` | The Sevenfold Rite — full M7 cycle as ritual |

- **File:** `src/core/tools/litanyTool.ts` (new)

### Added - Codex Martianus Documentation

- `docs/CODEX_MARTIANUS.md` — Prima Formularis doctrine, Sevenfold Rite, heresies, procedural rules
- `docs/LITANY_FOR_CHATS.md` — System instruction version of the Litany for AI chats without M7 context

### Fixed - Warmup Tool 60s Hang (Critical)

**Root cause:** `server.server.listRoots()` awaited MCP SDK default 60-second timeout when client doesn't support roots capability.

**Fix (`src/core/tools/warmupTool.ts`):**
- `ROOTS_TIMEOUT_MS = 3000` — SDK-native timeout option instead of 60s default
- `rootsUnavailable` negative cache — skip listRoots entirely after first failure
- `lastKnownWorkspace` positive cache — instant return after successful listRoots
- Performance: first call 65s → 3s (21x), subsequent calls 65s → 200ms (326x)

### Fixed - PROJECT_SCHEMA.yaml Corruption (Critical)

**Root cause:** AI double-encodes JSON as string → `{ ...current, ...stringValue }` spreads characters into numeric keys (`'0': '{'`, `'1': '\n'`).

**Fix (defense in depth):**
- `src/index.ts`: auto-parse string `changes` into object + runtime type guard
- `src/schema/schemaSystem.ts`: `stripNumericKeys()` sanitizer in `saveSchema()` and `loadSchema()`
- `saveSchema()`: runtime validation — schema must be non-null object with `project` property
- Auto-cleanup of corrupted files on load

### Fixed - BoundedMap Overwrite on Memory Load

**Root cause:** `loadPersistedMemory()` replaced `BoundedMap` instances with plain `Map` via `new Map(entries)`, losing LRU eviction and capacity limits.

**Fix (`src/memory/memorySystem.ts`):** Clear existing BoundedMap + repopulate with `.set()` calls, preserving eviction behavior.

### Changed - Graph Store Hot Path Optimization

- Removed `touch()` (TTL timer reset) from `getNode()` — called thousands of times in graph traversals
- TTL reset retained only in coarse-grained entry points: `build()`, `getMetrics()`, `getDependencies()`, `getDependents()`, `getAllNodes()`
- **File:** `src/knowledge-graph/graph-store.ts`

### Changed - TypeScript Compilation Cleanup

- Removed stale `this.memory` arguments from 10 tool handler calls in `src/index.ts`
- All handlers now obtain memory via `getMemoryCore()` internally (v5.0 UnifiedMemoryCore migration)
- Clean `npx tsc` with 0 errors

## [3.15.0] - 2026-02-10

### Added - Real LLM-Powered Hive Debates (v7.0)

**New system:** Hive agents now conduct real debates using flagship LLM calls instead of fake keyword-based consensus. Each round: agents critique each other → refine proposals → convergence check — all via actual AI reasoning.

- **DebateEngine** — orchestrates multi-round LLM debates between Hive agents
- **CritiqueGenerator** — calibrated critique prompts (CONFIRM/REFINE/CONTEST/INSUFFICIENT verdicts)
- **ProposalRefiner** — agents revise positions based on peer critiques
- **ConvergenceChecker** — LLM-based convergence assessment with fallback
- **Cross-provider debates** — Anthropic (Claude Opus 4.6) for critiques/convergence, OpenAI (GPT-5.2) for refinement
- **Budget tracking** — configurable cost cap as multiplier of initial proposal cost

**Files:**
- `src/hive/debate/types.ts` — DebateConfig, LLMCritique, DebateRoundResult, DebateResult
- `src/hive/debate/debateEngine.ts` — core debate orchestration (546 lines)
- `src/hive/debate/index.ts` — barrel exports

### Added - Hive Report Persistence (v7.1)

Every Hive analysis now automatically saves a full Markdown report to `docs/hive/`.

- Reports include: expert team, all proposals, synthesis, debate critiques, refined positions, metrics
- Filename format: `YYYY-MM-DD_HHMM_slug.md`
- Works for all modes: dynamic, planned, fixed

### Added - Hive History Tool (v7.1)

**New MCP Tool: `mcp_m7_hive_history`** — browse and load past Hive reports.

| Action | Description |
|--------|-------------|
| `list` | Show all saved reports with date, topic, size |
| `load` | Return full report content into chat context |

- Strict filename validation (regex allowlist)
- Path traversal prevention (realpath + prefix check)
- Async I/O throughout
- Fuzzy filename matching
- 200KB truncation safety cap

### Changed - Compact Hive Summary (v7.2)

Hive coordinator now returns a compact ~3KB summary to chat instead of the full 40KB report.
Solves the problem of Cursor IDE hiding large MCP tool outputs behind "Run Everything" button.

- Summary includes: team, synthesis, consensus points, disagreements, debate verdicts, open questions
- Russian UI labels (Итог, Консенсус, Разногласия, Дебаты, Открытые вопросы)
- Full report always available in `docs/hive/` and via `mcp_m7_hive_history load`

### Changed - Agent Prompt Calibration

Recalibrated all Hive agent prompts to eliminate "performative contrarianism" (agents opposing for the sake of opposition).

- Verdicts now reward accuracy, not finding flaws
- Agents instructed: "If the proposal is better than yours in some aspects, say so"
- Four calibrated verdict levels: CONFIRM, REFINE, CONTEST, INSUFFICIENT

### Fixed - Telemetry Stubs

- Created stub files for `FreestyleDetector` and `DiscoveryTracker` to resolve compilation errors in `src/core/telemetry/`

## [3.14.0] - 2026-02-10

### Added - M7 Mesh: Multi-Instance Communication (v8.0)

**New system:** Multiple M7 MCP instances running in separate Cursor windows can now discover each other, share context, and coordinate tasks.

- **MeshManager** — singleton lifecycle manager with auto-discovery, heartbeat (30s), stale PID cleanup
- **MeshDatabase** — SQLite WAL wrapper with 5 tables (instances, shared_context, intents, event_log, resource_locks)
- **MeshSignals** — filesystem-based IPC via `fs.watch()` on `~/.m7/mesh/signals/`
- **Intent Protocol** — propose → acknowledge → commit → release for conflict resolution
- **Advisory Locks** — atomic resource locking via SQLite for coordinated file edits
- **Hive Integration** — mesh_aware mode injects peer contexts into Hive task descriptions automatically
- **Graceful Shutdown** — instances deregister on SIGTERM/SIGINT
- **Opt-in** — zero overhead when mesh not initialized; user must run `mesh init` to activate

**New MCP Tool: `mcp_m7_mesh`** with 8 actions:
| Action | Description |
|--------|-------------|
| `init` | Create mesh network, join as new instance |
| `status` | Health overview — peers, intents, locks |
| `announce` | Publish server role or context |
| `request_context` | Query peer contexts |
| `task_lock` | Acquire/release advisory resource locks |
| `peers` | Detailed peer information |
| `propose_intent` | Propose modification intent |
| `events` | Recent mesh event log |

**New dependency:** `better-sqlite3` ^11.0.0

**Files:**
- `src/mesh/types.ts` (98 lines)
- `src/mesh/MeshDatabase.ts` (262 lines)
- `src/mesh/MeshSignals.ts` (108 lines)
- `src/mesh/MeshManager.ts` (380 lines)
- `src/mesh/tools/meshTool.ts` (346 lines)
- Modified: `src/index.ts` (+12 lines), `src/hive/tools/hiveCoordinator.ts` (+22 lines)

## [Unreleased]

### Planned
- Full ChromaDB file watching (when available)
- Config migrations (OpenClaw)
- Dual-Lane Concurrency (OpenClaw)

### Added - OpenClaw Contribution Modules

**Standalone contribution modules** in `openclaw-contributions/src/` — production-ready code for OpenClaw PRs:

- **Error Classifier** (`error-classifier.ts`, 295 lines) — classifies errors into 6 categories (retryable/auth/billing/rate_limit/fatal/unknown), extracts Retry-After headers, supports Axios/fetch/undici/Node.js error formats
- **Plugin Output Scanner** (`plugin-output-scanner.ts`, 285 lines) — 12 prompt injection detection patterns sourced from OWASP LLM Top 10, supports block/warn/strip/pass actions with configurable severity thresholds
- **TOFU Plugin Pinning** (`tofu-plugin-pinning.ts`, 260 lines) — Trust-On-First-Use for plugin manifests with SHA-256 hashing, granular tool-level diff, approve/revoke workflow
- **Doctor Auto-Repair** (`doctor-auto-repair.ts`, 230 lines) — automatic recovery of corrupted config/data files from .bak.N rotation backups
- **Hook Priority Ordering** (`hook-priority.ts`, 200 lines) — deterministic priority-based hook execution with SECURITY(1)/CORE(10)/PLUGIN(50)/LOGGING(90) tiers

**Test suite**: 59 tests covering all 5 modules + security patterns — all passing

## [3.11.0] - 2026-02-06

### Added - Reflection Gates (M7 Cycle v2)
- **Reflection Gates** between M7 cycle phases — structured checkpoints with 4 decisions: CONTINUE, PIVOT, REWIND, ABORT
- Gate weight varies by phase transition: HEAVY (discovery→architecture), STANDARD, LIGHT (simulation→implementation)
- `REFLECTION_LOG.jsonl` — machine-readable audit trail per cycle
- Reflection sections auto-appended to phase artifact files
- REWIND support with loop prevention (max 2 per phase)
- Backward compatible — old format auto-continues
- **Files:** `types/cycle.ts`, `cycleOrchestrator.ts`, `templates/phases.ts`, `cycleTool.ts`

### Added - Defensive Programming Category (validate_implementation)
- New `defensive` category in `mcp_m7_validate_implementation` tool
- 4 OSIL rules: regex lastIndex leak, JSON.stringify hashing, sort without tie-breaker, NaN in Math.max/min
- **Files:** `safetyValidator.ts`, `validateImplementation.ts`, `types.ts`, `tsi/index.ts`

### Changed - Lazy Loading (Performance)
- **Knowledge Graph** — no longer loads 28MB JSON at startup; loads on first tool call only
- **TSI System** — initializes on first tool use instead of server startup
- **Unified Memory** — already lazy via `getMemoryCore()`, removed eager init call
- **KG File Watcher** — disabled (KG is lazy now)
- **.m7/ reduced from 32MB to 3.9MB** — deleted knowledge-graph.json cache + old feature backups

### Resource Investigation
- Full audit of M7 resource consumption: 40+ singletons, 15+ unbounded Maps, append-only files
- Root cause: knowledge-graph.json = 28.15MB (87.5% of .m7/), 8 Maps with zero eviction
- Action plan documented in `docs/debug/m7-resource-consumption-investigation/`

## [3.10.5] - 2026-02-06

### Fixed - Session Persistence Bug

**Critical bug:** Sessions created by `analyze_task` were lost on MCP server restart, causing `session mark_complete` to fail with "Session not found."

**Root cause:** `TaskOrchestrator.activeSessions` was a pure in-memory `Map<string, TaskSession>` with zero disk persistence.

**Fix (`src/core/orchestrator/taskOrchestrator.ts`):**
- Sessions now persist to `.m7/orchestrator-sessions.json` via `atomicWriteJSON`
- Auto-loaded from disk on orchestrator construction via `safeReadJSON`
- `ensureSessionsLoaded()` guard on all public methods that read sessions
- `schedulePersist()` debounced (500ms) to avoid excessive writes
- Automatic cleanup: sessions >7 days old and completed sessions >1 day old are skipped on load
- Full Date serialization/deserialization (ISO strings on disk, Date objects in memory)

**Test:** `tests/test-session-persistence.mjs` — 8 tests covering serialization, deserialization, debounce, and build verification.

## [3.10.4] - 2026-02-06

### Added - Phase 5: Advanced Features

**🗜️ Memory Auto-Compaction**

New compaction engine for memory records (`src/memory/auto/compaction.ts`):

- **Automatic compression** when records exceed level limits
- **Similarity-based merging** (Jaccard on words) for duplicate reduction
- **Confidence-based pruning** removes low-value records
- **Smart preservation** of high-confidence and recent records
- Configurable limits per level (L0: 100, L1: 200, L2: 500, L3: 1000, L4: 2000)

**🔄 Transform Pipeline**

Composable middleware for tool calls (`src/core/pipeline/transformPipeline.ts`):

```javascript
const pipe = getPipeline();

// Add middlewares
pipe.use('logging', createLoggingMiddleware());
pipe.use('timing', createTimingMiddleware());
pipe.use('cache', createCacheMiddleware(60000));
pipe.use('rate-limit', createRateLimitMiddleware(10, 1000));

// Execute through pipeline
const result = await pipe.execute('tool_name', args, handler);

// Stats
pipe.getStats(); // { totalCalls, avgDurationMs, byTool: {...} }
```

Built-in middlewares:
- `createLoggingMiddleware()` — log all tool calls
- `createTimingMiddleware()` — add duration to context
- `createRateLimitMiddleware(max, windowMs)` — rate limiting
- `createCacheMiddleware(ttlMs)` — result caching
- `createValidationMiddleware(validator)` — argument validation

Features:
- Priority-based ordering (onion model)
- Tool name filtering (string or regex)
- Error propagation
- Per-tool statistics

**🔒 TOFU (Trust-On-First-Use) Pinning**

Security layer for memory records (`src/core/security/tofuPinning.ts`):

- **Pin verification** — hash-based trust anchoring on first use
- **Prompt injection detection** — 7 suspicious patterns:
  - Instruction override
  - Role injection
  - System prompt leakage
  - Hidden instruction markers
  - Base64 payload execution
  - Data exfiltration attempts
  - Permission escalation
- **User verification** — manual trust confirmation
- **Batch checking** for bulk validation

```javascript
import { getTOFUManager, scanForInjection } from './core/security/tofuPinning.js';

// Quick scan
const { safe, threats } = scanForInjection(content);

// Full TOFU workflow
const tofu = getTOFUManager();
await tofu.pin(recordId, content, source);
const { trusted, risk, reason } = await tofu.check(recordId, content);
```

### Tests

New test file `tests/phase5/test-advanced-features.mjs` with 30 tests:
- 8 Compaction tests
- 10 Pipeline tests
- 12 TOFU Pinning tests

## [3.10.3] - 2026-02-06

### Added - Phase 4: Extensibility

**🔌 Extension API (Pi-style)**

New extension system for extending M7 without forking (`src/core/extensions/extensionSystem.ts`):

```javascript
// .m7/extensions/my-ext.js
export default function(m7) {
  // Register custom tool
  m7.registerTool({
    name: 'check_code',
    description: 'Custom code checker',
    handler: async (args) => 'Code OK'
  });
  
  // Subscribe to events
  m7.on('task:analyzed', (ctx) => {
    m7.log.info('Task analyzed:', ctx.data);
  });
  
  // Replace existing tool
  m7.replaceTool('mcp_m7_analyze_task', async (args) => {
    return 'Custom analysis';
  });
  
  // Access memory
  await m7.memory.store('Pattern learned', 'L1');
  const results = await m7.memory.search('patterns');
  
  // Get config
  const config = m7.getConfig();
}
```

Discovery order:
1. `~/.m7/extensions/` - global extensions
2. `.m7/extensions/` - project extensions

Features:
- Auto-prefixed tool names (`ext_{extName}_{toolName}`)
- Tool replacement (override built-in tools)
- Event subscription via Phase 3 Event System
- Memory API (store/search)
- Error isolation (broken extension doesn't crash M7)
- Unload/reload support

**🌳 Session Tree Branching**

New session branching system for non-linear workflows (`src/core/session/sessionTree.ts`):

```typescript
const tree = new SessionTreeManager();
tree.create('session_001');

// Linear workflow
tree.addNode('discovery', 'Research auth patterns');
tree.addNode('architecture', 'JWT vs Sessions');

// Branch to try alternative
tree.fork('try-sessions');
tree.addNode('solution', 'Session-based approach');

// Switch back to main
tree.switchBranch('main');
tree.addNode('solution', 'JWT approach');

// Visualize
console.log(tree.visualize());
// ▶ Branch: "main" (active)
//   ├─ 🔍 discovery: Research auth patterns
//   ├─ 🏗️ architecture: JWT vs Sessions
//   └─ 📋 solution: JWT approach
// ○ Branch: "try-sessions"
//   ├─ 🔍 discovery: Research auth patterns
//   ├─ 🏗️ architecture: JWT vs Sessions
//   └─ 📋 solution: Session-based approach
```

Features:
- JSONL format with parentId for tree structure
- Multiple branches from same node
- Fork from current tip
- Switch between branches
- Path-to-root traversal
- Save/load with atomicWriteJSON
- Tree visualization with phase icons

### Tests

New test file `tests/phase4/test-extensions-sessions.mjs` with 22 tests:
- 10 Extension API tests
- 12 Session Tree tests

## [3.10.2] - 2026-02-06

### Added - Phase 3: Doctor + Events

**🩺 M7 Doctor Tool**

New diagnostic tool for health check and auto-repair of `.m7/` directory:

```bash
@m7 doctor check    # Only check
@m7 doctor fix      # Check + auto-repair
@m7 doctor report   # Full detailed report
```

Checks performed (10 total):
| # | Check | Auto-fixable |
|---|-------|--------------|
| 1 | `.m7/` directory exists | ✅ |
| 2 | `memory/` files valid JSON | ✅ |
| 3 | Core JSON files valid | ✅ |
| 4 | Warmup state freshness | ✅ |
| 5 | File sizes under 10MB | ❌ |
| 6 | Backup availability | ❌ |
| 7 | Manifest integrity | ✅ |
| 8 | Config file validation | ❌ |
| 9 | Cross-session data | ✅ |
| 10 | Total `.m7/` size | ❌ |

**📡 M7 Event System**

New hook system for lifecycle events (`src/core/events/eventSystem.ts`):

```typescript
import { on, emit, once } from './core/events/eventSystem.js';

// Subscribe to events
on('task:analyzed', (ctx) => {
  console.log(`Task analyzed: ${ctx.data.description}`);
});

// One-time handler
once('session:completed', (ctx) => {
  saveMetrics(ctx.data);
});

// Emit events
await emit('phase:entered', { phase: 'discovery' }, {
  sessionId: 'session_123'
});
```

Available events:
- **Task lifecycle**: `task:analyzed`, `task:routed`, `task:started`, `task:completed`, `task:failed`
- **Phase lifecycle**: `phase:entered`, `phase:completed`, `phase:skipped`
- **Hive events**: `hive:started`, `hive:agent:response`, `hive:consensus`, `hive:conflict`, `hive:completed`
- **Memory events**: `memory:stored`, `memory:retrieved`, `memory:promoted`, `memory:invalidated`
- **Error events**: `error:captured`, `error:recovered`
- **Session events**: `session:started`, `session:completed`
- **Warmup events**: `warmup:started`, `warmup:completed`
- **Doctor events**: `doctor:check:passed`, `doctor:check:failed`, `doctor:fixed`
- **Custom events**: `custom:your-plugin-event`

Features:
- Priority-based handler ordering (lower = earlier)
- Once handlers (auto-remove after first call)
- Pause/resume with event queue
- Event metrics tracking
- Handler error isolation

### Tests

New test file `tests/phase3/test-doctor-events.mjs` with 20 tests:
- 8 Doctor Tool tests
- 12 Event System tests

### Changed

- Tools Registry updated: 29 tools (was 28)
- Added `mcp_m7_doctor` to registry

## [3.10.1] - 2026-02-06

### Added - Phase 2: Smart Context

**🧠 Dependency Graph for Memory**

Memory records now track dependencies for intelligent cache invalidation:

- **Dependency tracking** - Records can declare dependencies on other records
- **Cascade invalidation** - When a record updates, all dependents are marked stale
- **Content hashing** - SHA-256 hashes detect actual content changes
- **Validation timestamps** - Track when records were last validated

New methods in `UnifiedMemoryCore`:
```typescript
await memory.invalidateDependents(recordId);  // Cascade invalidation
await memory.updateWithInvalidation(id, content);  // Update + invalidate
memory.getDependencyGraph(recordId);  // Get deps/dependents
await memory.getStaleRecords(maxAgeMs);  // Find stale records
```

**📁 Incremental Warmup with Manifest**

New `ManifestManager` (`src/core/utils/manifest.ts`) enables 3-5x faster warmup:

- **File tracking** - SHA-256 hashes for each project file
- **Diff computation** - Detect added/modified/removed/unchanged files
- **Warmup savings** - Skip unchanged files, only process changes
- **Statistics** - Track average warmup times for estimates

```typescript
const manifest = getManifestManager(projectPath);
const diff = await manifest.computeDiff(files);
// diff.added, diff.modified, diff.removed, diff.unchanged

const savings = manifest.getWarmupSavings(diff);
// { filesSkipped: 48, speedupFactor: 5.2, ... }
```

**Integration with Reliability MVP**

- WarmupManager uses `atomicWriteJSON` for crash-safe state persistence
- WarmupManager uses `safeReadJSON` with automatic recovery from backups
- Manifest operations wrapped in retry for reliability

### Tests

- 26 new tests for Phase 2 in `tests/phase2/test-smart-context.mjs`
- Dependency Graph tests (8 tests)
- Manifest tests (10 tests)
- Integration tests (5 tests)
- Performance tests (3 tests)

## [3.10.0] - 2026-02-06

### Added - Reliability MVP Sprint

**🛡️ Production-Grade Reliability**

The Reliability MVP transforms M7 from "works for author" to "reliably works for users" with four core improvements:

#### 1. Atomic Write System (`src/core/utils/atomicWrite.ts`)
- **Crash-safe file operations** using temp→rename pattern
- **Automatic backup rotation** (configurable, default 5 backups)
- **Safe read with recovery** from backups if main file corrupted
- Integrated into: MemorySystem, JournalSystem, SelfLearning, KnowledgeGraph

#### 2. Retry with Exponential Backoff (`src/core/utils/retry.ts`)
- **Intelligent retry** with configurable attempts (default 3)
- **Exponential backoff** with jitter to prevent thundering herd
- **Error classification** into retryable (RATE_LIMIT, TIMEOUT, etc.) and fatal (AUTH, BILLING, etc.)
- **Metrics tracking** of retry attempts and delays

#### 3. Provider Cooldown & Failover (`src/hive/api/providerManager.ts`)
- **Provider health tracking** with states: healthy, degraded, cooldown, failed
- **Automatic cooldown** on rate limits (60s base, exponential up to 5min)
- **Automatic failover** to alternate provider (anthropic ↔ openai)
- **Health score calculation** (0-100%) for each provider
- **Auto-recovery** from failed state after timeout

#### 4. Context Window Guard (`src/hive/context/contextGuard.ts`)
- **Token estimation** (~4 chars/token with code/URL adjustments)
- **Model-aware limits** for GPT-4o (128k), Claude (200k), etc.
- **Smart truncation strategies**: tail, head, middle, smart
- **Automatic truncation** when context exceeds safe limits
- **Warning system** at 80%+ utilization

### Configuration (`config/m7-config.yaml`)
```yaml
reliability:
  backup:
    max_count: 5
    enabled: true
  retry:
    max_attempts: 3
    initial_delay_ms: 500
    backoff_multiplier: 2
  cooldown:
    base_cooldown_ms: 60000
    failures_before_cooldown: 2
  context_guard:
    warning_threshold: 80
    auto_truncate: true
```

### Tests
- **144 unit tests** across all components (29 + 49 + 35 + 31)
- **22 integration tests** verifying cross-component behavior

## [3.9.4] - 2026-01-26

### Changed - Centralized Logging System
- **Full Logger Centralization**: Replaced 437 `console.*` calls across 85 files with centralized `createLogger()` system
- All logging now controlled by `M7_DEBUG` environment variable
- Eliminates "Unexpected token" errors in MCP client logs
- Logging levels: debug, info, warn, error
- Each module has scoped logger with prefix (e.g., `[ProjectIndex]`, `[Hive]`, `[TSI]`)

### Fixed
- **MCP JSON Protocol**: No more stdout/stderr pollution when `M7_DEBUG` is not set
- **Cursor IDE Logs**: Clean logs without false `[error]` markers

## [3.9.3] - 2026-01-26

### Fixed
- **Dotenv Banner**: Added `quiet: true` to suppress dotenv 17 banner that broke MCP JSON protocol
- Fixes "Unexpected token" error in MCP client logs

## [3.9.2] / [3.9.1] - 2026-01-26

- Fixes to the (now removed) update client only

## [3.9.0] - 2026-01-26

### Added - Performance Optimization (Sprint 1-4)

**🚀 Sprint 1: Core Performance**

- **analyzeTask Parallel Execution**
  - 6 sequential async operations → parallel with `Promise.all`
  - Latency: ~1500ms → ~600ms (-60%)

- **Memory System Lazy Init**
  - Promise caching for `loadPersistedMemory()`
  - Eliminates race condition on startup

- **Router Regex Optimization**
  - 7 separate regex → 1 compiled combined pattern
  - ~5x faster complexity analysis

**🧠 Sprint 2: Intelligence**

- **CrossSession Learning Indexing**
  - Inverted index for tag/keyword search
  - O(n) → O(k) where k << n

- **TSI Validation Cache**
  - Content-addressable cache with TTL 5min
  - 70-90% cache hit rate for repeated validations

- **Intent Classifier Local-First**
  - Pattern-based local classification first
  - LLM fallback only for ambiguous cases
  - 80% requests without LLM call

**💾 Sprint 3: I/O Optimization**

- **Project Index Incremental** (`src/core/tools/projectIndex/fileHashCache.ts`)
  - File hash cache (mtime, size, content hash)
  - Skip full rescan when key files unchanged
  - TTL 5min for cache freshness

- **Knowledge Hub Diff Sync**
  - Content hash cache (djb2 algorithm)
  - Skip document generation if content unchanged
  - TTL 1min for hash cache

- **Memory Batched Writes**
  - Debounce 1s + batch flush (max 50 pending)
  - Multiple writes → single disk operation
  - `shutdown()` method for graceful flush

**✨ Sprint 4: Polish**

- **Scope Scanner Tiered Caching** (`src/core/scope/scopeCache.ts`)
  - 3-tier scanning: cache → quick → full
  - TTL 60s, LRU eviction (max 50 entries)
  - Cache hit: <1ms vs ~50ms full scan

- **Error Formatter Template Literals** (`src/core/utils/errorFormatter.ts`)
  - Pre-defined structure/example templates
  - `formatQuickError()`, `formatSuccess()` helpers
  - ~10x faster than string concatenation

- **Journal Async Buffer** (`src/journal/journalSystem.ts`)
  - Debounce 1s + batch flush (max 20 pending)
  - `shutdown()` for graceful flush on exit
  - 10 writes → 1 disk operation

### Technical

- All optimizations work automatically after update
- No configuration required
- Backward compatible with existing projects
- Full optimization roadmap: `docs/sprints/M7_OPTIMIZATION_ROADMAP.md`

### Performance Metrics

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| `analyze_task` latency | ~1500ms | <600ms | -60% |
| Scope Scanner (cache hit) | ~50ms | <1ms | -98% |
| Error formatting | ~0.1ms | <0.01ms | -90% |
| Memory writes | Sync each | Batched 1s | -90% I/O |
| Journal writes | Sync each | Batched 1s | -90% I/O |

---

## [3.8.0] - 2026-01-26

### Added - Planner/Supervisor System (Hive v3.0)

**📋 Contract-Net Protocol (CNP) Coordination**

- **Planner Agent** (`src/hive/planner/plannerAgent.ts`)
  - Decomposes high-level goals into subtasks using Claude Opus
  - Creates task dependency graph for optimal execution order
  - Supports review and fix task types

- **Auctioneer Supervisor** (`src/hive/planner/auctioneerSupervisor.ts`)
  - Market-based task allocation using CNP auctions
  - Configurable bid scoring weights (cost, time, confidence, fairness, trust)
  - Fairness constraints to prevent agent monopolies
  - Bid accuracy tracking for learning

- **Gatekeeper Manager** (`src/hive/planner/gatekeepers.ts`)
  - Quality validation checkpoints before accepting results
  - Pattern-based style and architecture checks
  - Security vulnerability pattern detection
  - Blocking/non-blocking validation modes

- **Planner Orchestrator** (`src/hive/orchestrator/plannerOrchestrator.ts`)
  - Full CNP coordination flow: decompose → auction → execute → validate
  - Parallel execution of independent tasks
  - Synthesis of all task results

- **CNP Types** (`src/hive/planner/types.ts`)
  - Complete type definitions for CNP messages
  - Task state machine: CREATED → ANNOUNCED → BIDDING → AWARDED → IN_PROGRESS → SUBMITTED → VALIDATING → ACCEPTED/REJECTED
  - Scoring weight presets for different task types

### Changed

- **Model Updates (Context7 Verified)**
  - OpenAI: Updated to chat-compatible `gpt-5.2-2025-12-11`, `gpt-5.2-chat-latest`
  - Anthropic: Updated to `claude-opus-4-5-20251101`, `claude-sonnet-4-5-20250929`
  - Fixed `max_tokens` → `max_completion_tokens` for GPT-5.2 models
  - Removed deprecated `claude-3-opus-20240229`, `claude-3-5-sonnet-20241022`

- **hive_coordinator Tool**
  - New `mode: "planned"` for CNP auction-based coordination
  - Added `plannerOptions` for customizing planner behavior
  - Documentation updated for all three modes

- **HiveTask Type**
  - Added `mode: 'planned'` option
  - Added `plannerOptions` for planner configuration

- **Knowledge Graph Types**
  - Added CNP node types: `cnp_task`, `cnp_agent`, `cnp_artifact`, `cnp_decision`
  - Added CNP relation types: `cnp_depends_on`, `cnp_assigned_to`, `cnp_produces`, etc.

- **Telemetry Types**
  - Added CNP event types for full audit trail
  - `CNPTelemetryEvent` with correlation ID support

### Technical

- New `src/hive/planner/` module with 4 files (~1000 lines)
- Extended `src/hive/index.ts` with planner exports
- Updated `impact-analyzer.ts` for CNP relations
- No new external dependencies

---

## [3.7.0] - 2026-01-22

### Added - Dynamic Intelligence System

**🧬 Hive v2.0 - Dynamic Agent Generation**

- **Hive Architect** (`src/hive/intelligence/hiveArchitect.ts`)
  - AI dynamically creates optimal expert team for each task
  - No fixed agent types - agents are generated based on task requirements
  - Example: "Fintech API Architect", "PCI DSS Specialist" instead of generic "Security Agent"
  - Uses Claude Opus 4.5 for intelligent team composition

- **Model Selector** (`src/hive/intelligence/modelSelector.ts`)
  - Selects best LLM model for each agent based on task domain
  - Uses LiveBench benchmark data for model scoring
  - Domain categories: coding, reasoning, math, data, security, architecture
  - Automatic model matching: coding tasks → GPT-5.2 Codex, security → Claude Opus

- **LiveBench Baseline** (`src/hive/intelligence/benchmarkData.ts`)
  - Hardcoded benchmark data from https://livebench.ai (2026-01-08)
  - OpenAI models: GPT-5.2, GPT-5.2 Codex, GPT-5.1, GPT-5 Mini
  - Anthropic models: Claude Opus 4.5, Sonnet 4.5, Haiku 4.5
  - Scores by category: reasoning, coding, math, data, language

- **Self-Learning System** (`src/hive/intelligence/selfLearning.ts`)
  - Logs agent executions in `.m7/hive-learning.jsonl`
  - Learns from results to improve model selection
  - Adjustments based on: success rate, latency, user ratings
  - Stored in `.m7/hive-adjustments.json`

- **Dynamic Orchestrator** (`src/hive/orchestrator/dynamicOrchestrator.ts`)
  - New orchestrator for dynamic mode
  - Parallel agent execution with synthesized results
  - Full metrics tracking and cost calculation

### Changed

- **hive_coordinator Tool**
  - New `mode` parameter: `"dynamic"` (default) or `"fixed"` (legacy)
  - Dynamic mode creates AI-generated expert teams
  - Fixed mode uses predefined 7 agents for backward compatibility

- **HiveTask Type**
  - Added `mode?: 'dynamic' | 'fixed'` field

### Technical

- Using Node.js built-in `crypto.randomUUID()` instead of external uuid package
- New module structure: `src/hive/intelligence/`
- Type-safe exports from `src/hive/index.ts`

## [3.6.3] - 2026-01-26

### Added
- **Auto Model Discovery** (`src/hive/api/modelDiscovery.ts`)
  - Automatic detection of best available models from OpenAI and Anthropic APIs
  - Dynamic agent configuration based on discovered models
  - Support for GPT-5.2, Claude Opus 4.5 and other flagship models
  - 24-hour cache for discovery results

### Changed
- **Hive Agent Models Updated**:
  - Research Agent: Sonnet → **Opus 4.5** (deeper analysis)
  - Implementation Agent: GPT-5 → **GPT-5.2** (latest)
  - Architecture Agent: GPT-5 → **GPT-5.2** (latest)
  - Security Agent: Sonnet → **Opus 4.5** (critical security)
  - TechSafety Agent: Sonnet → **Opus 4.5** (risk assessment)

### Improved
- Cost calculation updated for 2026 models
- Model tier classification (flagship/standard/economy)

## [3.6.2] - 2026-01-25

- Private-beta access control (not part of the public snapshot)

## [3.6.1] - 2026-01-24

### Added
- **Auto-Migration System** (`src/core/migration/`)
  - Automatic detection of legacy projects (no `.m7/`)
  - Silent infrastructure initialization on startup
  - Version-aware component upgrades
  - `infrastructure.json` state tracking

### Fixed
- Legacy projects now auto-initialize without user action
- Backward compatibility for projects created before v3.6

## [3.6.0] - 2026-01-24

### Added - M7 Auto-Systems 🚀

- **File Watcher System** (`src/core/watchers/`)
  - Centralized file watching with chokidar
  - Debounced events (500ms)
  - 4 subscribers: KG, ChromaDB, ProjectIndex, StyleGuardian

- **Knowledge Graph Auto-Build**
  - Automatic build on MCP server startup
  - 24-hour cache in `.m7/knowledge-graph.json`
  - ~100ms build time for 1000+ files

- **Architecture Context Analyzer** (`src/core/architecture/`)
  - Automatic keyword extraction from task descriptions
  - Similar code search via Knowledge Graph or ripgrep
  - Integrated into `analyzeTask` output

- **ChromaDB Auto-Reindex**
  - `reindexFile()` and `removeFromIndex()` in MemoryManager
  - Automatic reindexing on file changes
  - Graceful degradation when ChromaDB unavailable

- **Project Index Auto-Update**
  - Throttled updates (max 1 per 5 minutes)
  - Triggers on: add/unlink files, package.json, tsconfig.json changes
  - `ThrottleManager` utility (`src/core/utils/throttle.ts`)

- **Style Guardian Auto-Check**
  - `quickCheck()` method for lightweight validation
  - Checks: long lines, console.*, TODO/FIXME, any types, empty catch
  - Automatic warnings on file changes

### Dependencies
- Added `chokidar@3.5.3` for file watching

## [3.1.0] - 2025-10-15

### Added
- Code Telemetry System (opt-in)
- Context Visualizer for debugging

## [2.0.0] - 2025-08-30

### Added
- 🤖 **Multiagent Hive System** - 7 specialized AI agents
  - Research Agent (Anthropic Claude)
  - Implementation Agent (OpenAI GPT-4)
  - Architecture Agent (OpenAI GPT-4)
  - Security Agent (Anthropic Claude)
  - Testing Agent (OpenAI GPT-4)
  - Performance Agent (Anthropic Claude)
  - TechSafety Agent (Anthropic Claude)
- 🧠 **Enhanced Memory System** with 5 levels
- 🔒 **Advanced Lock System** for critical operations
- 📊 **Enterprise Dashboard** with AI insights
- 🎯 **Scope Management** with budget tracking
- 📋 **API Contracts Registry** to prevent duplicates
- 🔄 **Version Control Integration**
- 📈 **Impact Analysis** tools
- 🖥️ **Console Monitoring** system

### Enhanced
- All 17 MCP tools now fully integrated
- Improved error handling and validation
- Better TypeScript type safety
- Enhanced debugging capabilities

### Fixed
- TypeScript compilation errors in production deployment
- Memory leaks in pattern matching
- Session management edge cases
- Tool registration conflicts

## [1.1.0] - 2025-08-15

### Added
- 🎼 **Task Orchestrator** with M7 session management
- 🛡️ **Scope Guard** to prevent scope creep
- 📊 **Schema System** with PROJECT_SCHEMA.yaml
- 🧠 **Memory Bank** with pattern storage
- 📝 **Journal System** for error tracking
- 🎯 **Navigation System** for complex tasks

### Enhanced
- Improved task analysis with risk assessment
- Better integration with Cursor IDE
- Enhanced error prevention mechanisms

## [1.0.0] - 2025-07-20

### Added
- 🚀 **Initial M7 MCP Server** release
- 📋 **Core MCP Tools** (11 tools)
  - analyze_task
  - memory operations
  - session management
  - validation tools
  - project initialization
- 🧠 **Basic Memory System**
- 📊 **PROJECT_SCHEMA.yaml** support
- 🔍 **Error Prevention** system
- 📖 **M7 IDEAL Methodology** implementation

### Features
- Model Context Protocol (MCP) integration
- Cursor IDE compatibility
- TypeScript implementation
- Zod schema validation
- Anti-chaos protection

## [0.9.0] - 2025-07-01

### Added
- 🧪 **Beta Release** for testing
- Basic MCP tool structure
- Initial methodology framework
- Cursor integration prototype

## [0.1.0] - 2025-06-15

### Added
- 🎯 **Project Initialization**
- Basic TypeScript setup
- MCP SDK integration
- Initial documentation

---

## Version Numbering

- **Major** (X.0.0): Breaking changes, major new features
- **Minor** (x.Y.0): New features, backward compatible
- **Patch** (x.y.Z): Bug fixes, small improvements

## Release Process

1. Update version in `package.json`
2. Update this CHANGELOG.md
3. Create git tag: `git tag v2.0.0`
4. Push changes: `git push origin main --tags`
5. Build and test: `npm run build && npm test`
6. Publish: `npm publish`

## Support

- **Current Version**: 2.0.0 (Full support)
- **Previous Version**: 1.1.0 (Security fixes only)
- **Legacy Versions**: 1.0.0 and below (No support)

---

*Maintained by M7 MCP Team* 📝
