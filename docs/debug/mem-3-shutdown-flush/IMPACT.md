# Impact: shutdown flush (MEM-3)

## Behaviour change

| Surface | Before | After |
|---------|--------|-------|
| Exit with pending L2/L3 writes | Data lost | `flushAllWithTimeout` (up to 2s) then `exit(0)` |
| Steady-state store | 1s debounce | Unchanged |
| Fatal uncaughtException | exit 1, no flush | Unchanged |
| Journal debounced writes | Lost on exit | Flushed via registered contributor |

## Notes

Process may take up to ~2 seconds to exit while flushing. Timeout still exits 0 (best-effort drain).

## Verification

- `tests/reliability/shutdownFlush.test.mjs`
- `npm test` (12 suites)
