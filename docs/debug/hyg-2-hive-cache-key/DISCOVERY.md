# HYG-2 — Hive cache key

**OSS:** v3.21.0 · **File:** `src/hive/cache/taskResultCache.ts` → `hashTask`

## Root cause

`[^\w\s]` without Unicode stripped Cyrillic; `.sort()` collapsed order-sensitive descriptions.

## Fix

Normalize with `/[^\p{L}\p{N}\s]/gu`, collapse whitespace, **no sort** — MD5 of full normalized string.

## Test

`tests/hiveCache.test.mjs` — distinct Cyrillic tasks; `move A to B` vs `move B to A` do not exact-hit.
