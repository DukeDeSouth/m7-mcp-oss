# M7 MCP

**Current release:** [v3.18.1](https://github.com/DukeDeSouth/m7-mcp-oss/releases/tag/v3.18.1) — clone `main` or download the release archive. There is no npm package; build from source (`npm run build`).

An MCP server that makes an AI coding agent work through a fixed seven-phase
cycle instead of jumping straight to code. It was built for Cursor, but it
speaks plain MCP over stdio and should work with any client that supports
tools.

This repository is a **snapshot, not the live tree**. I developed M7 between
June 2025 and mid-2026 as a private tool used by me and my team. The version
published here is the state of the repo as of July 2026 with the parts tied
to that closed distribution (self-update client, license check, private-access
gate) and one unfinished research module removed. Development continues privately; I may or may not sync more of
it later. See [CHANGELOG.md](CHANGELOG.md) for what changed when, and
[docs/WHY_OPEN_SOURCE.md](docs/WHY_OPEN_SOURCE.md) for why this is published
as open source rather than pursued as a patent or a company.

## What it does

The core idea is simple: before the agent touches code it has to go through
discovery, architecture, solution, impact analysis and an implementation
simulation, write an artifact for each, and pass a reflection gate between
phases. The server does not trust the model to "remember" the rules: it
issues a gate ID with every phase instruction, rejects reflections that do not
quote it, re-injects a compact rule summary after N tool calls in the same
phase, and keeps the cycle state on disk so a new chat can pick up where the
old one stopped.

Around that cycle there is a set of supporting tools:

- **Memory** with tiers (L1/L2/L3), confidence decay, promotion and a
  "fog of war" that tracks what is known, assumed, stale or unknown about the
  project. Optional ChromaDB backend for semantic search; falls back to local
  JSON.
- **Task analysis and routing** (`mcp_m7_analyze_task`): classifies a request,
  creates a session, flags scope drift, decides between a short path and the
  full cycle.
- **Hive**: run several model instances (OpenAI / Anthropic) on a question and
  merge the answers. Needs API keys.
- **TSI** (tech safety intelligence): YAML pattern packs (security,
  performance, architecture, testing, deployment) used to warn about known
  footguns before implementation.
- Task graph, task transfer between chats, architecture advisor, knowledge
  graph, error database, style guardian, DCCE text validator, mesh for
  multi-machine sessions, and a few more. The full list is in
  [docs/TOOLS_REGISTRY.md](docs/TOOLS_REGISTRY.md); 38 tools are registered
  by `src/index.ts`.

Documentation is split by reader. For the agent: [M7-GUIDE.md](M7-GUIDE.md)
(operational guide) and
[Methodology/CURSOR_METHODOLOGY_RULES.md](Methodology/CURSOR_METHODOLOGY_RULES.md)
(rules for `.cursorrules`). For people: [docs/M7_WHY_FULL_CYCLE.md](docs/M7_WHY_FULL_CYCLE.md)
(why a fixed cycle), [docs/methodology/M7_IDEAL_PRINCIPLES.md](docs/methodology/M7_IDEAL_PRINCIPLES.md)
(principles and where they are implemented) and
[Methodology/IDEAL_METHODOLOGY.md](Methodology/IDEAL_METHODOLOGY.md) (process
specification). The index is [Methodology/METHODOLOGY_INDEX.md](Methodology/METHODOLOGY_INDEX.md).

## Timeline

For context, since harness-engineering frameworks became a popular topic in
2026:

- June–July 2025: first prototype (0.1.0 → 1.0.0), 11 tools, basic memory,
  7-phase cycle as a prompt-level protocol.
- August 2025: 2.0.0 — Hive multi-agent, tiered memory, scope management.
- Late 2025: TSI, telemetry (opt-in), context visualizer.
- February–March 2026: cycle orchestrator v2 with reflection gates,
  carry-forward context, template-driven artifacts.
- July 2026: epistemic layer (fog of war boundaries, grounding gate, adversarial
  review gate, control-channel nonce, rule re-injection).
- October 2026: first public community-fix batch on [KNOWN_ISSUES.md](KNOWN_ISSUES.md) (v3.18.1) — see [docs/COMMUNITY_SPRINT.md](docs/COMMUNITY_SPRINT.md).

## Requirements

- Node 22 or newer
- `OPENAI_API_KEY` and `ANTHROPIC_API_KEY`. The server checks both at startup
  and refuses to run without them; this is a leftover of the Hive-first design
  and is on the list of things to relax. Placeholder values are enough if you
  do not use Hive.
- Optional: ChromaDB at `CHROMA_URL` (default `http://localhost:8000`) for
  vector memory.

## Install

```bash
git clone https://github.com/DukeDeSouth/m7-mcp-oss.git m7-mcp
cd m7-mcp
npm install
npm run build
```

Then add the server to your MCP client. For Cursor, `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "m7": {
      "command": "node",
      "args": ["/absolute/path/to/m7-mcp/dist/index.js"],
      "cwd": "/absolute/path/to/m7-mcp",
      "env": {
        "OPENAI_API_KEY": "sk-...",
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "M7_PROJECT_PATH": "/absolute/path/to/your/project"
      }
    }
  }
}
```

`install.sh` does the same interactively. `M7_PROJECT_PATH` is optional: the
server tries MCP roots and a few environment hints first, but setting it
explicitly avoids surprises when several workspaces are open.

Run `mcp_m7_init_project` once inside a project. It creates the memory bank,
project knowledge files and a `.cursorrules` with the methodology summary.
From then on, start tasks with
`mcp_m7_analyze_task` and follow the instructions the server returns.

## Configuration

Feature flags and cycle thresholds are in `config/m7-config.yaml`. Defaults are
in `src/core/config/featureFlags.ts`. Useful environment variables:

| Variable | Purpose |
|---|---|
| `M7_PROJECT_PATH` | target project directory |
| `M7_DEBUG=true` | verbose logs on stderr |
| `M7_TELEMETRY_ENDPOINT` | enable telemetry upload to a collector you run; unset means nothing leaves the machine |
| `M7_RULE_REINJECTION_THRESHOLD` | override the per-phase tool-call count before rules are re-injected |
| `CHROMA_URL` | ChromaDB base URL |

Telemetry is off by default and, even when you opt in with
`mcp_m7_telemetry`, nothing is sent unless `M7_TELEMETRY_ENDPOINT` is set.

## Development

```bash
npm run build      # tsc → dist/
npm test           # scripts/run-tests.sh: each tests/*.test.mjs with a timeout
M7_DEBUG=true node dist/index.js   # run the server by hand
```

Tests import from `dist/`, so build first. They write into `.m7/` in the repo
root; that directory is git-ignored.

## Known limitations

- Both API keys are required at startup even if you never call Hive.
- `src/tsi` loads its YAML patterns from `src/tsi/patterns` even when running
  from `dist/`, so run it from a clone, not from a copied `dist/`.
- Some modules keep timers alive after the work is done; the test runner uses
  `--test-force-exit` for that reason.
- Comments and some docs are a mix of English and Russian.
- Project-path resolution scans `~/.cursor/projects` as one of its fallbacks.
  If you are not using Cursor, set `M7_PROJECT_PATH`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and PRs are welcome; I cannot
promise fast turnaround. If you want something concrete to work on,
[KNOWN_ISSUES.md](KNOWN_ISSUES.md) lists confirmed defects with code
references and a suggested order. The first response sprint (Stage 1 batch 1) is
documented in [docs/COMMUNITY_SPRINT.md](docs/COMMUNITY_SPRINT.md).

## License

Apache License 2.0. See [LICENSE](LICENSE).
