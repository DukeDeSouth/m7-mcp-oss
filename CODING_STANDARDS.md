# M7 MCP — Coding Standards

> Project-specific conventions. Not generic best practices — rules for this repo.

## Stack

TypeScript (strict, ESM), Node 22. Build with `tsc` to `dist/`. Imports between
source files use the `.js` extension (ESM output). The package is
`"type": "module"`: `require` does not exist at runtime, so use static
`import` or `await import()`. A `require()` inside `try/catch` fails on every
call and the `catch` hides it; the HYG-11 test scans `src/` for any
`require(` call.

## Conventions

- **One tool, one module.** Each MCP tool lives in `src/core/tools/<name>.ts`
  (or its own package dir) and exports `{ name, description, inputSchema, handler }`.
  Registration happens in `src/index.ts` inside an isolated `try/catch` so one
  broken tool never takes the server down.
- **Schemas with zod.** Input validation is declared next to the handler and
  converted to JSON Schema for MCP.
- **No stdout.** stdout is the MCP channel. Log through `log()` / the logger
  module, which writes to stderr and only when `M7_DEBUG=true`.
- **Feature flags, not branches.** New optional behaviour goes behind a flag in
  `src/core/config/featureFlags.ts` with a default and a YAML override in
  `config/m7-config.yaml`.
- **State in `.m7/`.** Anything persisted for a project goes under the project's
  `.m7/` dir via the existing managers; never write to arbitrary paths.
- **Fail soft.** Tool handlers return an error payload instead of throwing past
  the MCP boundary.
- **Tests are plain node scripts.** `tests/*.test.mjs`, no framework, import from
  `dist/`. Run `npm run build && npm test`.
- **Project path from `getProjectPath()`.** Never `process.cwd()` for project
  state; clients start servers from `/` or `~`. New `process.cwd()` uses need an
  entry (with a reason) in the STATE-4 allowlist test.
- **Per-project caches.** A module-level singleton that holds project state is
  keyed by the resolved project path, not one per process.
- **No shell strings.** `execFile` / `execFileSync` with an argv array; put user
  input after `-e` (or the tool's equivalent) and end options with `--`. The
  HYG-10 test fails on any other `child_process` import or `shell: true`.
- **Health checks report, they do not start things.** No tool call starts
  processes or containers on the host as a side effect.
- **Dead code goes.** An unreachable module is deleted, not fixed in place; it
  tends to keep defects the live path no longer has.
- **Debounced writes are drained.** Every debounced store registers
  `registerShutdownContributor`; synchronous readers of async-loaded state await
  a `ready()` first.
- **Tests bind a temp project.** Use `bindProject` / `makeProject` from
  `tests/helpers/deepScanHarness.mjs` (sets both `CURSOR_WORKSPACE` and
  `M7_PROJECT_PATH`); `npm test` fails if a test writes into the repo. Tests
  that touch the health check pin `CHROMA_URL`.
- **Every fix has a mutant.** A KNOWN_ISSUES fix adds its test to the deep scan
  suites and a revert to `scripts/deep-scan-mutants.mjs`; the test must fail for
  the stated reason when the old code is back.
- **What is written whole is not bounded.** A collection that is persisted by
  writing all of it (memory levels, fog, tombstones, the contract registry) is
  a plain `Map` / `Set`. `BoundedMap` is for RAM-only data and for caches whose
  misses fall through to the store (MEM-5).
- **One write queue per file.** Writes of a whole-file snapshot go through one
  promise chain per owner and read their data when they start, not when they
  are queued. A flush returns a promise that resolves when its data is on disk,
  and `shutdown()` awaits the chain (MEM-7, STATE-5).
- **Reads have no write side effects.** Loading a file or answering a query
  does not store anything (MEM-6).
- **Artifact identity comes from the ID.** Paths for per-entity files include
  the entity's unique ID, are created exclusively (`mkdir` without
  `recursive`), and a collision picks a new ID instead of sharing (CYC-10).
- **Success means written.** A tool answers `success: true` only after the
  write it reports has finished; a failed write is `success: false` with the
  reason, and in-memory state is rolled back (STATE-1, STATE-5).
- **Race tests hold a write.** A test for write ordering or concurrency
  wraps the write function, holds the first call open and counts how many
  run at once; it does not rely on timing (MEM-7). A test that passes on
  broken code in some runs proves nothing.

## Anti-Patterns

- Sentinel strings in data fields (`"(empty)"`): store empty values plus a
  status code; format for humans only in the presentation layer.
- Reading exit codes through `| tail` / `| head` without `pipefail`.
- Update-time validation stricter than create-time validation for the same
  entity.
- `npm test` as the only acceptance criterion: it is silent on repos without
  tests.
- `value || default` for numbers where `0` is valid (confidence, importance):
  use `??`.
- Swallowing write errors at debug level: a failed persist is at least a warn.
- Calling an async flush without `await` "to start it early": the caller then
  cannot know when its data is on disk.
- `mkdir({ recursive: true })` as an existence check: it succeeds on an existing
  directory and hides a collision.
