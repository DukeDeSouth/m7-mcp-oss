# M7 MCP — Index

> Project navigation map. Read before any task.
> Details: MASTER_REFERENCE.md | Conventions: CODING_STANDARDS.md

## What is this

M7 MCP Server — an MCP server that makes an AI coding agent work through a
fixed 7-phase cycle (discovery → architecture → solution → impact → simulation
→ implementation → report) with reflection gates between phases, persistent
project memory, and a set of supporting analysis tools.

**Stack:** TypeScript (ESM), Node 22, `@modelcontextprotocol/sdk`, stdio transport
**Entry point:** `src/index.ts` → `dist/index.js`

## Project Structure

```
m7-mcp-oss/
├── src/
│   ├── index.ts              ← MCP server, registers every tool in isolated try/catch
│   ├── core/
│   │   ├── orchestrator/     ← 7-phase cycle, reflection gates, carry-forward, rule reinjection
│   │   ├── tools/            ← tool handlers (analyze_task, memory, session, cycle, ...)
│   │   ├── config/           ← feature flags loaded from config/m7-config.yaml
│   │   ├── router.ts         ← task routing (simple / standard / full cycle)
│   │   ├── safety/           ← deterministic intent/safety rules
│   │   ├── task-graph/, task-transfer/, scope/, templates/ ...
│   ├── memory/               ← tiered memory, fog of war, epistemic status, ChromaDB (optional)
│   ├── hive/                 ← multi-agent coordinator (OpenAI / Anthropic clients)
│   ├── tsi/                  ← Tech Safety Intelligence: YAML pattern packs in src/tsi/patterns
│   ├── telemetry/            ← local telemetry; upload only when M7_TELEMETRY_ENDPOINT is set
│   ├── arch-advisor/, knowledge-graph/, error-database/, style-guardian/, visualizer/, mesh/ ...
├── tests/                    ← node *.test.mjs (run: npm test)
├── templates/                ← phase artifact templates
├── workflows/                ← workflow definitions
├── Methodology/              ← spec (IDEAL_METHODOLOGY), agent rules, index; archive/ = 2025 drafts
├── config/m7-config.yaml     ← feature flags and cycle settings
├── docs/                     ← guides (TOOLS_REGISTRY.md = tool list, HIVE_USER_GUIDE.md, M7_WHY_FULL_CYCLE.md)
├── M7-GUIDE.md               ← operational guide for the agent (read at chat start)
└── scripts/run-tests.sh      ← test runner with per-file timeout
```

## Key Systems

| System | Where | Notes |
|---|---|---|
| Cycle orchestrator | `src/core/orchestrator/cycleOrchestrator.ts` | phases, gates, gate-ID nonce, grounding check |
| Memory | `src/memory/` | L1/L2/L3 tiers, confidence decay, fog of war, `.m7/` on disk |
| Task analysis | `src/core/tools/analyzeTask.ts` | routing + session creation + scope alerts |
| Hive | `src/hive/` | needs `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` |
| Feature flags | `src/core/config/featureFlags.ts` | defaults + `config/m7-config.yaml` overrides |

## Known Issues

- Server requires `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` at startup (see README).
- `src/tsi/core/yamlLoader.ts` resolves pattern files from `src/tsi/patterns` even when running from `dist/`; works from a git clone, not from a dist-only install.
- Some tests touch the local `.m7/` state dir and can be slow; `scripts/run-tests.sh` applies a per-file timeout.
