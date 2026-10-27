# M7 MCP — Master Reference

## Identity
- **Project**: M7 MCP Server (public snapshot)
- **Description**: MCP server that enforces a 7-phase development cycle on AI coding agents and keeps persistent project memory
- **Stack**: TypeScript ESM, Node 22, `@modelcontextprotocol/sdk`, optional ChromaDB
- **Transport**: stdio

## Architecture

```
Cursor / any MCP client
        │ stdio (JSON-RPC)
        ▼
src/index.ts (M7MCPServer)
  ├─ registers 38 tools, each in its own try/catch (list: docs/TOOLS_REGISTRY.md)
  ├─ APIManager (Hive LLM clients)
  └─ tool handlers
       ├─ analyze_task ─► TaskRouter ─► session + cycle
       ├─ cycle ────────► CycleOrchestrator (phases, reflection gates, carry-forward)
       ├─ memory ───────► MemoryManager (tiers, confidence, fog of war, epistemic status)
       ├─ hive_* ───────► Hive coordinator (multi-agent runs)
       ├─ tsi/* ────────► YAML pattern packs (tech safety)
       └─ telemetry ────► local collector (remote upload opt-in)
```

State lives in the target project's `.m7/` directory (memory JSON, cycle state,
fog of war, epistemic metrics). The server never writes outside the project
path and `~/.m7/` (telemetry consent/config).

## Key Dependencies

| Package | Use |
|---|---|
| `@modelcontextprotocol/sdk` | MCP protocol / stdio transport |
| `zod` | tool input schemas |
| `js-yaml` | config and TSI patterns |
| `chromadb` (optional) | vector memory; falls back to local JSON when unavailable |
| `openai`, `@anthropic-ai/sdk` | Hive agents |
| `chokidar` | file watchers |

## Data Files

| Path | Purpose |
|---|---|
| `config/m7-config.yaml` | feature flags, cycle thresholds |
| `src/tsi/patterns/*.yaml` | tech-safety pattern packs |
| `templates/` | phase artifact templates |
| `<project>/.m7/` | runtime state: memory, cycles, fog of war |
| `<project>/m7-cycles/` | per-task cycle artifacts (INTAKE.md, DISCOVERY.md, ARCHITECTURE.md, SOLUTION_PLAN.md, IMPACT_ANALYSIS.md, SIMULATION.md, IMPLEMENTATION.md) |
| `<project>/CYCLE_REGISTRY.md` | one line per completed cycle, appended by the orchestrator |
| `<project>/docs/debug/<task>/`, `docs/features/<task>/` | 7 task documents created by `analyze_task` on new session |
| `<project>/docs/hive/` | saved Hive reports |
| `~/.m7/telemetry_config.json` | telemetry consent (local) |

## Environment

| Var | Required | Notes |
|---|---|---|
| `OPENAI_API_KEY` | yes | checked at startup |
| `ANTHROPIC_API_KEY` | yes | checked at startup |
| `M7_PROJECT_PATH` | recommended | target project; otherwise resolved from cwd / Cursor |
| `CHROMA_URL` | no | default `http://localhost:8000` |
| `M7_TELEMETRY_ENDPOINT` | no | enables telemetry upload to your own collector |
| `M7_DEBUG=true` | no | verbose logging to stderr |
