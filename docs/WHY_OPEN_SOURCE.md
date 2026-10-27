# Why M7 is open source, and not a patent or a startup

This document explains when M7 was built, what problem it was built for, which
other paths were considered (a patent, outside investment), and why the code
is being published under Apache-2.0 instead. It is not a user guide: there
are no install or tool instructions here, those are in the documents listed
at the end. This is context and motivation for a reader who wants to judge
the work. A Russian version is in `docs/WHY_OPEN_SOURCE.ru.md`.

## 1. When and why

M7 started in June 2025 as a private tool for one developer working daily
with an AI coding agent in Cursor. The problem it addressed was not model
quality. It was the working mode the agent fell into when given a bug
report: symptom, hypothesis, patch, observe, next hypothesis. Each step was
cheap; the sequence was expensive. Patches landed on top of unverified
patches, changes chosen by a local symptom broke call paths the agent had
never read, and nothing was written down, so the next chat started from the
same wrong hypothesis. `docs/M7_WHY_FULL_CYCLE.md` gives the observations in
detail.

The response was to make the process mandatory rather than advisory. The
first versions (0.1.0 in June 2025, 1.0.0 in July 2025) encoded a seven-phase
cycle as a prompt-level protocol with eleven MCP tools behind it. Over the
next year it became an MCP server that holds cycle state on disk, issues a
gate ID with every phase instruction and rejects reflections that do not
quote it, re-injects a compact rule summary after a threshold of tool calls
in the same phase, carries forward context between phases, and runs several
models against each other when a question is contested (Hive). The timeline
is in `README.md` and the version history in `CHANGELOG.md`; the orchestrator
is `src/core/orchestrator/cycleOrchestrator.ts`.

M7 was never sold. It was used by me and my own team, and the
infrastructure around it, a self-update client, a license check, a
private-access gate, existed for convenience of distribution inside that
circle and to keep the code from walking off, not as a business. Those parts
are removed from the public tree because they serve no purpose here. The
methodology and the server are what remain.

## 2. Where M7 sits relative to "harnesses"

In 2026 the industry converged on a vocabulary for this layer. Anthropic and
OpenAI both published engineering notes under the heading of *harness
design* or *harness engineering*, and comparisons of agent harnesses (Claude
Code, Codex, OpenCode, Goose, OpenHands and others) are now routine. In that
vocabulary a harness is the runtime around the model: the loop, the tools,
the sandbox, the memory, the permission system.

M7 is not a harness in that sense and does not compete with one. It runs
*inside* a harness, over MCP, and constrains what the agent is allowed to do
next. The nearest published analogue is the planner / generator / evaluator
split with file-based hand-offs that Anthropic described for long-running
builds. M7 reached a similar shape independently and earlier, from a
different motivation:

| Published harness pattern (2025–2026)        | M7 equivalent, and when it appeared                                                        |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Planner expands a short prompt into a spec   | `intake → discovery → architecture → solution` phases with mandatory artifacts (June 2025) |
| Evaluator agent reviews generator output     | Reflection gates between phases; blocking, not advisory (February 2026)                    |
| File-based hand-offs between agent sessions  | `m7-cycles/<task>/*.md` artifacts, `CYCLE_REGISTRY.md`, task transfer between chats (2025) |
| Context resets / compaction                  | Carry-forward summaries between phases; rule re-injection inside a phase (2026)            |
| Single model, single vendor                  | Hive: multi-model debate across OpenAI and Anthropic with a synthesizer (August 2025)       |

The differences are as informative as the similarities. M7's gates are
enforced by the server (the model cannot skip a phase by deciding to), its
artifacts are a required output rather than an optional log, and its memory
tracks epistemic status (known / assumed / stale / unknown) rather than just
content. Whether those choices are right is an open question; the point of
publishing is to let people check.

## 3. The patent path, and why it was not pursued

A provisional patent application covering the M7 cycle and its enforcement
mechanisms was filed with the USPTO on May 6, 2026. I decided not to
convert it into a non-provisional application, for four reasons.

**Subject matter.** A process that governs how an agent works is close to
the "abstract idea" boundary under *Alice* / 35 U.S.C. §101. The claims
that survive in this area describe narrow technical mechanisms, not
workflows. M7 has such mechanisms (gate-ID nonces validated on reflection
submit, threshold-based rule re-injection, scope scanning that upgrades a
route to decomposition), but a patent drawn that narrowly protects very
little, and a patent drawn broadly is unlikely to issue.

**Cost against benefit.** Prosecution to grant costs tens of thousands of
dollars and two to four years. By grant, the ideas would be table stakes;
the industry moved from "agents need scaffolding" to published harness
designs from the model vendors within roughly a year. There is no realistic
scenario in which a sole developer enforces such a patent against the
companies that would be practicing it.

**Model vendors train the harness and the model together.** Anthropic has
said publicly that it removes scaffolding from its harness as the model
improves. A patent on scaffolding is a patent on a shrinking surface.

**The provisional already did the useful thing.** It fixed a priority date
for the design before any public disclosure. Letting it lapse costs nothing
and loses nothing I intend to use.

## 4. The investor path, and why it was not pursued

Turning M7 into a funded company was an option I considered and did not
take. The category was being absorbed faster than a one-person company
could occupy it. Cycle
enforcement, planning modes, hooks, sub-agents and persistent project memory
have appeared as built-in features of the harnesses themselves. What is left
for an independent layer is the methodology, the enforcement discipline and
the epistemic memory model, and those are better argued in the open than
sold behind a license check.

A second, plainer reason: raising money to defend a position means spending
the next two years on distribution rather than on the question I actually
care about, which is how to make an agent do discovery before it writes
code. Publishing lets me keep working on that question.

## 5. Why open source, and why now

- **Defensive publication.** A public, dated repository is prior art. Nobody,
  including the vendors above, can later patent this design against me or
  against anyone else who uses it. For a sole developer this is a stronger
  position than a patent I could not afford to enforce.
- **Verifiable record of independent convergence.** The value I want to
  demonstrate is not "I had the idea" but "I built the mechanism, before the
  vocabulary existed, and it runs". The code, the tests, the templates and
  the dated changelog are that evidence. A slide deck is not.
- **License.** Apache-2.0 includes an explicit patent grant (section 3).
  Anyone using this code under the license receives a license to any patent
  claims I hold on it. That is intentional and closes the question of
  whether the provisional is a trap for users.
- **Timing.** The snapshot is the July 2026 state of the tree. The
  harness-design discussion is current now; a year from now the comparison
  in section 2 would be of historical interest only.

## 6. What to look at to check the claims

| Claim                                   | Where                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| Phase sequence and gate enforcement     | `src/core/orchestrator/cycleOrchestrator.ts`, `src/core/orchestrator/ruleReinjection.ts` |
| Gate-ID nonce issue and validation      | `generateGateInstructionId` / `validateGateInstructionId` in `src/core/orchestrator/controlChannel.ts` |
| Routing (heavy-first, decomposition)    | `src/core/router.ts`, `config/m7-config.yaml`                                  |
| Multi-model debate                      | `src/hive/`, `docs/HIVE_USER_GUIDE.md`                                         |
| Epistemic memory                        | `src/memory/`, `CHANGELOG.md` entry "prior epistemic work"                     |
| Dated history                           | `CHANGELOG.md` from 0.1.0 (2025-06-15) onward                                  |
| Tool surface                            | `docs/TOOLS_REGISTRY.md` (38 tools, generated from `tools/list`)               |
| Why a fixed cycle at all                | `docs/M7_WHY_FULL_CYCLE.md`, `docs/methodology/M7_IDEAL_PRINCIPLES.md`         |

## 7. Status

This repository is a snapshot. Development continues privately and may or
may not be synced here. Issues and pull requests are welcome; see
`CONTRIBUTING.md`. If you build something on the methodology, a reference
back is appreciated but not required beyond what the license asks.
