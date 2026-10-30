# CYC-6: Carry-forward latest reflection per phase

**KNOWN_ISSUES:** CYC-6 · **Fixed in:** 3.19.0

## Root cause

`buildCarryForward` used `reflections.find(r => r.phase === phase)`, which returns the **first** gate record. After a rewind and redo, `reflections` is append-only and contains multiple entries for the same phase — the table showed stale summaries.

## Fix

- `latestReflectionForPhase()` — reverse scan for the last matching `phase`.
- `buildCarryForward` uses that helper instead of `find`.

## Test

`tests/cycleOrchestrator.test.mjs` — **CYC-6 carry-forward latest reflection** (rewind redo discovery, OLD/NEW markers).
