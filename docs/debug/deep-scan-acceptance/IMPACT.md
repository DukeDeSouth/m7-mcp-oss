# Impact: deep scan acceptance suites (v3.22.1)

## Behaviour change

| Surface | Before | After |
|---------|--------|-------|
| Session created < 500 ms before exit | Lost | Drained by `flushPersist()` shutdown contributor |
| First tool call after start | Could miss persisted sessions | Entry points await `orchestrator.ready()` |
| Cross-session knowledge | `<cwd>/.m7/cross-session/`, one store for all projects | `<project>/.m7/cross-session/`, one instance per project |
| Cross-session save failure | Debug log | Warn log |
| Arch advisor, visualizer, mesh, telemetry exports, git capture | cwd | Active project |
| `git` in telemetry capture | `execSync` command string | `execFileSync` argv |
| Architecture context search | Shell string with task text | `execFile('rg', argv)`, `--fixed-strings -e <kw> --` |
| `serverInfo.version`, `m7://status` | `2.0.0` | `package.json` version |
| `analyze_task` with ChromaDB offline | `docker compose up -d` on a compose file in cwd, up to 15 s wait | Report only; hint names `CHROMA_URL` |
| Project index git info, repo without `origin` | No branch, no last commit | Each field read on its own |
| Unreachable modules (`core/verification`, auto-memory tool, `PersistentMemory`, cascade invalidation) | Present in `dist/` | Removed |
| Failed transfer | Source keeps `outcome` / `completed` | Source node restored as it was |
| Retried reflection after phase advance | Accepted as next artifact | Replayed |
| Non-Latin cycle slug | Empty, artifacts in `m7-cycles/` root | Letters of any script, hash fallback |
| `npm run build` | Stale modules from deleted sources stay | `dist/` cleaned first |
| `npm test` | Listed files only | All `tests/*.test.mjs` + `tests/reliability/*`, fails on repo pollution |
| Two cycles with one description | One artifact folder, mixed INTAKE, one registry row | Folder per cycle `m7-cycles/<slug>-<id suffix>/`, two rows |
| `mcp_m7_contracts` | `success: true` without saving; `list` empty; YAML keeps the last function only | Load awaited, four sections with stable IDs, failure reported |
| Long-term > 2000, conceptual > 1000, fog > 500, tombstones > 5000 | Oldest entries removed from disk | Kept; L0/L1 bounds unchanged |
| `loadSchema()` / every `analyze_task` | One more schema copy in long-term memory | No memory write |
| ≥ 50 pending memory writes, then exit or keep running | Some acknowledged writes missing on disk | All on disk; `shutdown()` waits for writes in flight |
| Project switch less than 1 s after a store | Store lost | Old core drained before exit |

## Notes

A server that used to run from its project directory sees no difference. A server started elsewhere starts with an empty cross-session store in the project; the old store stays where it was (`<cwd>/.m7/cross-session/`) and is not migrated.

Long-lived code that keeps a `getCrossSessionLearning()` result across a project switch would bring STATE-4 back; the static `process.cwd()` allowlist test does not catch that case.

Cycles started before CYC-10 keep writing to their old folder (the path comes from the stored `taskSlug`). Schema copies written by earlier versions stay in `longterm.json` until deleted (KNOWN_ISSUES MEM-6). Without bounds, long-term memory grows with use; the README section on storage says so. A project whose `longterm.json` was already cut to 2000 entries does not get the lost records back.

## Verification

- `npm test`: 26 files, pollution check clean.
- `tests/deepScanAcceptance.test.mjs` 106, `tests/deepScanE2E.test.mjs` 21, `tests/deepScanTraceability.test.mjs` 21.
- `npm run test:mutants`: 39/39 killed.
- HYG-9 and HYG-10 tests were run against the build before the fix first: all 7 failed for the stated reason. The CYC-10, STATE-5, MEM-5, MEM-6 and MEM-7 tests likewise failed before their fixes, except the guards that pin behavior which must not change: a legacy folder, an unwritable state directory, and a delete during flushes.
