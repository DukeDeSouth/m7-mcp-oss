# GATE-3 — response noise (gate duplication + error banner)

**OSS:** v3.22.0

## Root cause (grep)

| Location | Duplication |
|----------|-------------|
| `cycleOrchestrator.ts` `buildGateInstruction` | `gateTemplate` embedded in `instruction` string **and** `gate.prompt`; `artifact.template` also held full gate |
| `cycleTool.ts` `formatCycleResponse` | Renders goal + artifact template block + instruction + **gateSection** (`gate.prompt`) |
| `hintGenerator.ts` | Banner when `recentErrors[0].count > 2` on **cumulative** journal totals |

## Fix

1. Gate JSON template only in `instruction.gate.prompt`; instruction body points to single Reflection Gate section (GATE-3).
2. `artifact.template` stub when awaiting reflection.
3. Remove cumulative error banner until delta metrics exist.

## Tests

- `cycleOrchestrator.test.mjs` — `gatePromptText()` + `Gate-ID:` exactly once in `formatCycleResponse`.
- `hintGenerator.test.mjs` — no “Runtime errors increasing” on high cumulative count.
