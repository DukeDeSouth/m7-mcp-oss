# CYC-4: Pin projectPath on CycleState

**KNOWN_ISSUES:** CYC-4 · **Fixed in:** 3.19.0

## Root cause

`CycleOrchestrator` captured `this.cyclesDir` from the first `getProjectPath()` in the constructor, while artifacts, reflection logs, metrics, and registry paths used **live** `getProjectPath()`. After `applyProjectPath` switched projects mid-session, cycle JSON and `m7-cycles/` artifacts could land in different trees (split-brain).

## Fix

- `CycleState.projectPath` set at `startCycle` from `getProjectPath()`.
- Helpers: `cyclesDirForProject`, `artifactsDirForState`, `cycleStatePathFor`.
- `commitState` / cold `getState` use pinned path; `taskProjectRoots` map for reload.
- Legacy state files without the field infer project root from `…/project/.m7/cycles/<id>.json`.
- `migrateState` ensures `projectPath` is set.
- Constructor `this.cyclesDir` kept only for `cleanupOldCycles` scan.

## Test

`tests/cycleOrchestrator.test.mjs` — block **CYC-4 pinned projectPath** (dirA start → switch to dirB → submit → files only under dirA).
