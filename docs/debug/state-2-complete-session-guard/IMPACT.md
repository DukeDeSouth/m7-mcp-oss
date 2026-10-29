# Impact: complete_session phase guard (STATE-2)

## Behaviour change

| Surface | Before | After |
|---------|--------|-------|
| `complete_session` on fresh session | Success | `success: false`, `lastError` on session, phase unchanged |
| `complete_session` with `force: true` | N/A | Completes; `forcedCompletion` recorded |
| Legal path | Any phase | Must be `validation` with all validation requirements true |
| Phase auto-advance from implementation | Could land on `completed` | Caps at `validation` |

## Callers

- MCP `mcp_m7_session` `complete_session` — documents `force` and surfaces `lastError` in the refusal message.
- Internal code calling `TaskOrchestrator.completeSession` — same boolean contract; optional third argument `{ force?: boolean }`.

## Regression risk

- Workflows that closed sessions immediately after `start_task` must pass `force: true` or finish validation requirements first.
- Tests or scripts that relied on `every([]) === true` for unnamed phases will see phases stay incomplete until requirements exist and are marked.

## Verification

- `tests/taskOrchestrator.test.mjs` — four cases matching KNOWN_ISSUES acceptance (refuse, force, legal validation complete, implementation → validation cap).
- `npm test` — 12 suites, 0 failures.
