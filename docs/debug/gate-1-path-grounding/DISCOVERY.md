# GATE-1 — path: premise filesystem check

**Release:** 3.20.1

## Problem

`resolvePremiseRef` treated `path:` refs as Fog-of-War lookups only. Files on disk without a fog entry were reported NOT_FOUND.

## Fix

1. Resolve path relative to `getProjectPath()` with `..` escape blocked.
2. `fs.access` — if present, synthetic record at confidence 0.8 → KNOWN.
3. Optional fog entry for same path merges content/confidence on top.

## Tests

`tests/groundingGate.test.mjs` — G11–G14.
