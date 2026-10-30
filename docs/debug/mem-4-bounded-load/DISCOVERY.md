# MEM-4: Bounded load must not truncate persisted levels

**KNOWN_ISSUES:** MEM-4 · **Fixed in:** 3.19.0

## Root cause

`MemorySystem` used `BoundedMap(2000)` for `longterm`. `loadPersistedMemory()` repopulated the map with `set()` for every key in the file. Beyond 2000 keys, LRU eviction dropped rows silently. The next `persistLevel()` rewrite stored only the in-memory snapshot.

## Fix

1. `BoundedMap.setMaxSize(n)` — increase capacity only.
2. Before hydrating `longterm` / `conceptual`, resize cap to `max(default, fileEntryCount + 1)`.
3. Track `loadedEntryCount` and `explicitDeletes`; refuse to write the level file if `map.size < loaded - deletes`.

## Test

`tests/mem4-bounded-load.test.mjs` — 2100-key `longterm.json`, one store, shutdown flush, file has ≥2101 keys.
