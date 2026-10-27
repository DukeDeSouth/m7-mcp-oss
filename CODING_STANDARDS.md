# M7 MCP — Coding Standards

> Project-specific conventions. Not generic best practices — rules for this repo.

## Stack

TypeScript (strict, ESM), Node 22. Build with `tsc` to `dist/`. Imports between
source files use the `.js` extension (ESM output).

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

## Anti-Patterns

- Sentinel strings in data fields (`"(empty)"`): store empty values plus a
  status code; format for humans only in the presentation layer.
- Reading exit codes through `| tail` / `| head` without `pipefail`.
- Update-time validation stricter than create-time validation for the same
  entity.
- `npm test` as the only acceptance criterion: it is silent on repos without
  tests.
