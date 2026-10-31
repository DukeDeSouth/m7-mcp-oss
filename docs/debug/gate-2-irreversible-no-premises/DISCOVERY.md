# GATE-2 — irreversible steps without premises

**OSS:** v3.21.0 · **File:** `src/core/orchestrator/groundingGate.ts` (`runGroundingCheck` step loop)

## Root cause

`for (const premiseId of step.premise_ids)` never runs when `premise_ids` is `[]`, so irreversible steps with no premises produced zero warnings.

## Fix

Before the premise loop: if `reversibility === 'irreversible'` and `premise_ids.length === 0`, push one **strong** warning keyed by step id (dedupe via `seen`).

## Test

`tests/groundingGate.test.mjs` — **G15** (`deploy_prod`, empty premises → `strongWarnings === 1`).
