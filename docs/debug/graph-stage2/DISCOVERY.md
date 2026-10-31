# Stage 2 task graph fixes (GRAPH-1–3)

**OSS:** v3.21.0

| ID | Change | Test |
|----|--------|------|
| GRAPH-1 | `getSubgraph`: `bestDepth` map + `depth <= seenAt` early return replaced by re-expand when `depth > seenAt` | Diamond A–B–C–D depth 2 |
| GRAPH-2 | `randomBytes(3)` task id suffix; `createTask` throws on duplicate id | Two transfers, distinct ids |
| GRAPH-3 | `deleteTask`; transfer catch rolls back new node + restores `previousStatus` | Stub `createLink` throw → single active `src` |

**Tests:** `tests/taskGraph.test.mjs`
