# Stage 3 hygiene batch (HYG-3–6)

**OSS:** v3.22.0

| ID | Change |
|----|--------|
| HYG-3 | `fileSearcher.ts`: `execFile('grep', argv[])`; exit code 1 → empty |
| HYG-4 | Removed `src/test-tool.ts` + registration |
| HYG-5 | README: re-injection counts `mcp_m7_cycle` calls only |
| HYG-6 | Deleted unused `codeInterceptor.ts` |

Tests: `fileSearcher.test.mjs`, build without test tool, `npm test` 22/22.
