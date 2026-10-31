/**
 * Deep Scan acceptance suite — one describe per KNOWN_ISSUES item, tagged [ID].
 *
 * Each block implements the item's "Acceptance test:" line literally, plus the
 * negative/edge variants needed to make that line meaningful. "Restart" always
 * means a new Node process (tests/helpers/deepScanWorker.mjs), never a module reset.
 * End-to-end checks through the real MCP server live in deepScanE2E.test.mjs.
 *
 * Run: npm run build && node --test --test-force-exit tests/deepScanAcceptance.test.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  mkdir, writeFile, readFile, readdir, chmod, utimes, access, stat,
} from 'node:fs/promises';
import path from 'node:path';

import {
  ROOT,
  PHASES,
  makeProject,
  removeProject,
  bindProject,
  runWorker,
  fakeArtifact,
  reflectionJson,
  countOccurrences,
  isolatedEnv,
} from './helpers/deepScanHarness.mjs';

const execFileAsync = promisify(execFile);

// Bind the whole file to a throwaway project before any dist module builds a singleton.
const SUITE_PROJECT = await makeProject('deepscan-suite-');
const unbindSuite = await bindProject(SUITE_PROJECT);
after(async () => {
  unbindSuite();
  await removeProject(SUITE_PROJECT);
});

const { CycleOrchestrator, getCycleOrchestrator } = await import('../dist/core/orchestrator/cycleOrchestrator.js');
const { extractGateInstructionId } = await import('../dist/core/orchestrator/controlChannel.js');
const { formatCycleResponse, formatCompletionResponse, cycleTool } = await import('../dist/core/tools/cycleTool.js');
const { applyProjectPath, resetProjectPathStateForTests } = await import('../dist/core/utils/projectPath.js');
const { safeReadJSON, atomicWriteJSON } = await import('../dist/core/utils/atomicWrite.js');
const { TaskOrchestrator } = await import('../dist/core/orchestrator/taskOrchestrator.js');
const { unifiedSessionTool } = await import('../dist/core/tools/unified/sessionTool.js');
const { resetMemoryCore, getMemoryCore, MIRROR_MAX_CONFIDENCE } = await import('../dist/memory/auto/unified-memory-core.js');
const { flushAllWithTimeout } = await import('../dist/core/shutdown/flushOnExit.js');
const { MemorySystem } = await import('../dist/memory/memorySystem.js');
const { JournalSystem } = await import('../dist/journal/journalSystem.js');
const { SchemaSystem } = await import('../dist/schema/schemaSystem.js');
const { contractsTool } = await import('../dist/core/tools/critical/contracts.js');
const { TaskGraphManager } = await import('../dist/core/task-graph/taskGraphManager.js');
const { TransferManager } = await import('../dist/core/task-transfer/transferManager.js');
const { parseGroundingSpec, runGroundingCheck } = await import('../dist/core/orchestrator/groundingGate.js');
const { generateIntelligentHints } = await import('../dist/core/utils/hintGenerator.js');
const { TaskResultCache } = await import('../dist/hive/cache/taskResultCache.js');
const { grepForKeywordTestHarness } = await import('../dist/hive/context/fileSearcher.js');
const { buildRipgrepArgs, getArchitectureContextAnalyzer } = await import('../dist/core/architecture/architecture-context-analyzer.js');

const journalStub = { logFeature: async () => 'feat-id' };
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

// ─── cycle helpers ─────────────────────────────────────────────────

function gateTextOf(instruction) {
  if (!instruction) return '';
  return [instruction.instruction, instruction.gate?.prompt].filter(Boolean).join('\n');
}

async function currentGateId(orch, taskId) {
  const cur = await orch.getCurrentInstruction(taskId);
  return extractGateInstructionId(gateTextOf(cur.instruction));
}

async function reflect(orch, taskId, decision = 'continue', extra = {}) {
  const gateId = await currentGateId(orch, taskId);
  assert.ok(gateId, 'Gate-ID must be available while awaiting reflection');
  return orch.submitReflection(taskId, reflectionJson(gateId, decision, extra));
}

async function runFullCycle(orch, description) {
  const start = await orch.startCycle(description);
  for (const phase of PHASES) {
    const a = await orch.submitArtifact(start.taskId, fakeArtifact(phase, phase[0]));
    assert.equal(a.success, true, `${phase} artifact: ${a.error}`);
    if (phase === 'implementation') {
      assert.equal(a.completed, true, 'implementation artifact completes the cycle (no gate)');
      break;
    }
    const r = await reflect(orch, start.taskId, 'continue', { summary: `${phase} done` });
    assert.equal(r.success, true, `${phase} reflection: ${r.error}`);
  }
  return start.taskId;
}

async function withProject(prefix, fn) {
  const dir = await makeProject(prefix);
  const unbind = await bindProject(dir);
  try {
    return await fn(dir);
  } finally {
    unbind();
    await bindProject(SUITE_PROJECT);
    resetMemoryCore();
    await chmod(path.join(dir, '.m7', 'cycles'), 0o755).catch(() => {});
    await removeProject(dir);
  }
}

async function readAllText(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    const p = path.join(dir, name);
    if ((await stat(p)).isFile()) out.push(await readFile(p, 'utf8'));
  }
  return out.join('\n');
}

// ═══════════════════════════════════════════════════════════════════
// Stage 1 / Stage 2 — cycle contract
// ═══════════════════════════════════════════════════════════════════

describe('[CYC-1] unparseable or unknown reflection is rejected, gate unchanged', () => {
  const invalid = [
    ['not json', gateId => `## Gate-ID: ${gateId}\n\nnot json`, /json/i],
    ['decision "proceed"', gateId => reflectionJson(gateId, 'proceed'), /decision/i],
  ];
  for (const [label, build, errPattern] of invalid) {
    it(`${label} → success false; same phase, same gate, no reflection record`, async () => {
      const orch = new CycleOrchestrator();
      const { taskId } = await orch.startCycle(`CYC-1 ${label}`);
      await orch.submitArtifact(taskId, fakeArtifact('intake'));
      const gateBefore = await currentGateId(orch, taskId);

      const res = await orch.submitReflection(taskId, build(gateBefore));
      assert.equal(res.success, false);
      assert.match(res.error ?? '', errPattern);

      const cur = await orch.getCurrentInstruction(taskId);
      assert.equal(cur.success, true);
      assert.equal(cur.instruction.phase.name, 'intake');
      assert.equal(await currentGateId(orch, taskId), gateBefore);
      const st = await orch.getState(taskId);
      assert.equal(st.awaitingReflection, true);
      assert.equal(st.reflections.length, 0);
      assert.deepEqual(st.completedPhases, ['intake']);
    });
  }

  it('a valid reflection after a rejected one is still accepted (gate not poisoned)', async () => {
    const orch = new CycleOrchestrator();
    const { taskId } = await orch.startCycle('CYC-1 recover after reject');
    await orch.submitArtifact(taskId, fakeArtifact('intake'));
    const gateId = await currentGateId(orch, taskId);
    assert.equal((await orch.submitReflection(taskId, 'garbage')).success, false);
    const ok = await orch.submitReflection(taskId, reflectionJson(gateId, 'continue'));
    assert.equal(ok.success, true, ok.error);
    assert.equal(ok.instruction.phase.name, 'discovery');
  });

  it('rejection is durable: a restarted process still awaits the same gate', async () => {
    const dir = await makeProject('cyc1-restart-');
    try {
      const [start] = await runWorker(dir, [
        { op: 'cycle.start', params: { description: 'CYC-1 restart' } },
        { op: 'cycle.submit', params: { taskId: '$0.taskId', content: fakeArtifact('intake') } },
        { op: 'cycle.reflect', params: { taskId: '$0.taskId', decision: 'proceed' } },
      ]);
      const [state, cur] = await runWorker(dir, [
        { op: 'cycle.state', params: { taskId: start.taskId } },
        { op: 'cycle.get', params: { taskId: start.taskId } },
      ]);
      assert.equal(state.awaitingReflection, true);
      assert.equal(state.reflections, 0);
      assert.equal(cur.phase, 'intake');
      assert.ok(cur.gateId);
    } finally {
      await removeProject(dir);
    }
  });
});

describe('[CYC-2] artifact submission is idempotent and serialized', () => {
  it('(a) same artifact twice → second returns the first response; completedPhases.length === 1', async () => {
    const orch = new CycleOrchestrator();
    const { taskId } = await orch.startCycle('CYC-2 sequential');
    const art = fakeArtifact('intake');
    const r1 = await orch.submitArtifact(taskId, art);
    const r2 = await orch.submitArtifact(taskId, art);
    assert.equal(r1.success, true);
    assert.deepEqual(r2, r1);
    const st = await orch.getState(taskId);
    assert.deepEqual(st.completedPhases, ['intake']);
    assert.equal(st.currentPhase, 'intake');
    assert.equal(st.awaitingReflection, true);
  });

  it('(b) Promise.all of identical artifacts → one transition, identical responses', async () => {
    const orch = new CycleOrchestrator();
    const { taskId } = await orch.startCycle('CYC-2 concurrent identical');
    const art = fakeArtifact('intake');
    const [a, b] = await Promise.all([orch.submitArtifact(taskId, art), orch.submitArtifact(taskId, art)]);
    assert.equal(a.success, true);
    assert.deepEqual(b, a, 'second call is a replay of the first, not a second transition');
    const st = await orch.getState(taskId);
    assert.equal(st.completedPhases.length, 1);
  });

  it('(b) Promise.all of different artifacts → exactly one call reports a transition', async () => {
    const orch = new CycleOrchestrator();
    const { taskId } = await orch.startCycle('CYC-2 concurrent different');
    const results = await Promise.all([
      orch.submitArtifact(taskId, fakeArtifact('intake', 'a')),
      orch.submitArtifact(taskId, fakeArtifact('intake', 'b')),
    ]);
    const transitioned = results.filter(r => r.success && r.instruction?.gate);
    assert.equal(transitioned.length, 1);
    const rejected = results.filter(r => !r.success);
    assert.equal(rejected.length, 1);
    assert.match(rejected[0].error ?? '', /awaiting reflection/i);
    const st = await orch.getState(taskId);
    assert.deepEqual(st.completedPhases, ['intake']);
  });

  it('duplicate reflection is replayed, not applied twice', async () => {
    const orch = new CycleOrchestrator();
    const { taskId } = await orch.startCycle('CYC-2 reflection replay');
    await orch.submitArtifact(taskId, fakeArtifact('intake'));
    const body = reflectionJson(await currentGateId(orch, taskId), 'continue');
    const r1 = await orch.submitReflection(taskId, body);
    const r2 = await orch.submitReflection(taskId, body);
    assert.equal(r1.success, true);
    assert.deepEqual(r2, r1);
    const st = await orch.getState(taskId);
    assert.equal(st.reflections.length, 1);
    assert.equal(st.currentPhase, 'discovery');
  });

  it('tool retry of an accepted reflection is not taken as the next phase artifact', async () => {
    const orch = getCycleOrchestrator();
    const { taskId } = await orch.startCycle('CYC-2 tool retry reflection');
    await orch.submitArtifact(taskId, fakeArtifact('intake'));
    const body = reflectionJson(await currentGateId(orch, taskId), 'continue');
    const t1 = await cycleTool.handler({ task_id: taskId, artifact_content: body });
    const t2 = await cycleTool.handler({ task_id: taskId, artifact_content: body });
    assert.ok(!t1.isError);
    assert.deepEqual(t2, t1);
    const st = await orch.getState(taskId);
    assert.deepEqual(st.completedPhases, ['intake']);
    assert.equal(st.currentPhase, 'discovery');
    assert.equal(st.awaitingReflection, false);
  });

  it('tool retry of an accepted artifact returns the same gate response', async () => {
    const orch = getCycleOrchestrator();
    const { taskId } = await orch.startCycle('CYC-2 tool retry artifact');
    const art = fakeArtifact('intake');
    const t1 = await cycleTool.handler({ task_id: taskId, artifact_content: art });
    const t2 = await cycleTool.handler({ task_id: taskId, artifact_content: art });
    assert.deepEqual(t2, t1);
    assert.deepEqual((await orch.getState(taskId)).completedPhases, ['intake']);
  });
});

describe('[CYC-3] completed and aborted cycles are terminal', () => {
  it('abort at intake → tool response has no "7 phases"; later submit fails with "aborted"', async () => {
    const orch = getCycleOrchestrator(); // the instance cycleTool uses
    const { taskId } = await orch.startCycle('CYC-3 abort terminal');
    await orch.submitArtifact(taskId, fakeArtifact('intake'));
    const gateId = await currentGateId(orch, taskId);

    const toolRes = await cycleTool.handler({ task_id: taskId, artifact_content: reflectionJson(gateId, 'abort') });
    const text = toolRes.content.map(c => c.text).join('\n');
    assert.doesNotMatch(text, /7 phases/i);
    assert.match(text, /abort/i);
    assert.match(text, /intake/i);

    const st = await orch.getState(taskId);
    assert.equal(st.status, 'aborted');
    const again = await orch.submitArtifact(taskId, fakeArtifact('intake', 'z'));
    assert.equal(again.success, false);
    assert.match(again.error ?? '', /aborted/i);
  });

  it('formatCompletionResponse distinguishes aborted from completed', () => {
    assert.doesNotMatch(formatCompletionResponse('t', 'aborted', 'intake', 1), /All 7 phases/i);
    assert.match(formatCompletionResponse('t', 'completed', 'implementation', 7), /7/);
  });

  it('completed cycle rejects further artifacts and stays at 7 phases', async () => {
    const orch = new CycleOrchestrator();
    const taskId = await runFullCycle(orch, 'CYC-3 completed terminal');
    const st = await orch.getState(taskId);
    assert.equal(st.status, 'completed');
    assert.equal(st.completedPhases.length, 7);
    const again = await orch.submitArtifact(taskId, fakeArtifact('implementation', 'q'));
    assert.equal(again.success, false);
    assert.match(again.error ?? '', /completed/i);
    assert.equal((await orch.getState(taskId)).completedPhases.length, 7);
  });

  it('terminal status survives a restart', async () => {
    const dir = await makeProject('cyc3-restart-');
    try {
      const [start] = await runWorker(dir, [
        { op: 'cycle.start', params: { description: 'CYC-3 restart' } },
        { op: 'cycle.submit', params: { taskId: '$0.taskId', content: fakeArtifact('intake') } },
        { op: 'cycle.reflect', params: { taskId: '$0.taskId', decision: 'abort' } },
      ]);
      const [state, submit] = await runWorker(dir, [
        { op: 'cycle.state', params: { taskId: start.taskId } },
        { op: 'cycle.submit', params: { taskId: start.taskId, content: fakeArtifact('intake', 'k') } },
      ]);
      assert.equal(state.status, 'aborted');
      assert.equal(submit.success, false);
      assert.match(submit.error ?? '', /aborted/i);
    } finally {
      await removeProject(dir);
    }
  });
});

describe('[CYC-4] one cycle, one owner project', () => {
  it('project path A at start, B at submit → state and artifact both under A', async () => {
    const dirA = await makeProject('cyc4-a-');
    const dirB = await makeProject('cyc4-b-');
    try {
      resetProjectPathStateForTests();
      applyProjectPath(dirA);
      const orch = new CycleOrchestrator();
      const { taskId } = await orch.startCycle('CYC-4 owner project');
      applyProjectPath(dirB);
      assert.equal((await orch.submitArtifact(taskId, fakeArtifact('intake'))).success, true);

      const st = await orch.getState(taskId);
      assert.equal(st.projectPath, dirA);
      await access(path.join(dirA, '.m7', 'cycles', `${taskId}.json`));
      await access(path.join(dirA, 'm7-cycles', st.taskSlug, 'INTAKE.md'));
      await assert.rejects(access(path.join(dirB, '.m7', 'cycles', `${taskId}.json`)));
      await assert.rejects(access(path.join(dirB, 'm7-cycles')));
    } finally {
      await bindProject(SUITE_PROJECT);
      await removeProject(dirA);
      await removeProject(dirB);
    }
  });
});

describe('[CYC-5] short-artifact and rewind limits are separate', () => {
  it('three short submissions → all rejected, third says the cycle is stuck, phase unchanged', async () => {
    const orch = new CycleOrchestrator();
    const { taskId } = await orch.startCycle('CYC-5 three shorts');
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await orch.submitArtifact(taskId, `short ${i}`));
    assert.deepEqual(results.map(r => r.success), [false, false, false]);
    assert.match(results[2].error ?? '', /stuck/i);
    const st = await orch.getState(taskId);
    assert.equal(st.currentPhase, 'intake');
    assert.deepEqual(st.completedPhases, []);
  });

  it('two rewinds into discovery do not consume the short-artifact budget', async () => {
    const orch = new CycleOrchestrator();
    const { taskId } = await orch.startCycle('CYC-5 rewind isolation');
    await orch.submitArtifact(taskId, fakeArtifact('intake'));
    await reflect(orch, taskId);
    for (let i = 0; i < 2; i++) {
      await orch.submitArtifact(taskId, fakeArtifact('discovery', String(i)));
      await reflect(orch, taskId);
      await orch.submitArtifact(taskId, fakeArtifact('architecture', String(i)));
      const r = await reflect(orch, taskId, 'rewind', { rewind_target: 'discovery', change_detected: true });
      assert.equal(r.success, true, r.error);
    }
    const st = await orch.getState(taskId);
    assert.equal(st.rewindCount.discovery, 2);
    const short = await orch.submitArtifact(taskId, 'tiny');
    assert.equal(short.success, false);
    assert.match(short.error ?? '', /Attempt 1\/3/);
    assert.equal((await orch.getState(taskId)).shortArtifactAttempts.discovery, 1);
  });
});

describe('[CYC-6] carry-forward uses the latest reflection per phase', () => {
  it('two discovery reflections → the second summary appears, the first does not', async () => {
    const orch = new CycleOrchestrator();
    const OLD = `CYC6_OLD_${Date.now()}`;
    const NEW = `CYC6_NEW_${Date.now()}`;
    const { taskId } = await orch.startCycle('CYC-6 latest reflection');
    await orch.submitArtifact(taskId, fakeArtifact('intake'));
    await reflect(orch, taskId);
    await orch.submitArtifact(taskId, fakeArtifact('discovery', 'o'));
    await reflect(orch, taskId, 'continue', { summary: OLD });
    await orch.submitArtifact(taskId, fakeArtifact('architecture'));
    await reflect(orch, taskId, 'rewind', { rewind_target: 'discovery', change_detected: true });
    await orch.submitArtifact(taskId, fakeArtifact('discovery', 'n'));
    const after = await reflect(orch, taskId, 'continue', { summary: NEW });
    const text = after.instruction.instruction;
    assert.ok(text.includes(NEW));
    assert.ok(!text.includes(OLD));
  });
});

describe('[CYC-7] both submissions of one phase are recoverable on disk', () => {
  it('discovery submitted twice (via rewind) → both texts in the artifact directory', async () => {
    const orch = new CycleOrchestrator();
    const FIRST = `CYC7_FIRST_${Date.now()}`;
    const SECOND = `CYC7_SECOND_${Date.now()}`;
    const { taskId } = await orch.startCycle('CYC-7 resubmit trace');
    await orch.submitArtifact(taskId, fakeArtifact('intake'));
    await reflect(orch, taskId);
    await orch.submitArtifact(taskId, `# DISCOVERY: one\n\n${FIRST}\n${'a'.repeat(220)}`);
    await reflect(orch, taskId);
    await orch.submitArtifact(taskId, fakeArtifact('architecture'));
    await reflect(orch, taskId, 'rewind', { rewind_target: 'discovery', change_detected: true });
    await orch.submitArtifact(taskId, `# DISCOVERY: two\n\n${SECOND}\n${'b'.repeat(220)}`);

    const st = await orch.getState(taskId);
    const all = await readAllText(path.join(st.projectPath, 'm7-cycles', st.taskSlug));
    assert.ok(all.includes(FIRST), 'first discovery text lost');
    assert.ok(all.includes(SECOND), 'second discovery text missing');
  });
});

describe('[CYC-8] one registry row per cycle', () => {
  it('temp registry: two completions of one cycle → one row, updated in place', async () => {
    await withProject('cyc8-', async dir => {
      const orch = new CycleOrchestrator();
      const taskId = await runFullCycle(orch, 'CYC-8 registry dedupe');
      const st = await orch.getState(taskId);
      assert.equal(st.projectPath, dir);
      const folder = `m7-cycles/${st.taskSlug}`;

      assert.equal((await orch.registerSummary(taskId, 'summary alpha')).success, true);
      const reg1 = await readFile(path.join(dir, 'CYCLE_REGISTRY.md'), 'utf8');
      const row1 = reg1.split('\n').filter(l => l.includes(`| ${folder} |`));
      assert.equal(row1.length, 1);

      assert.equal((await orch.registerSummary(taskId, 'summary beta')).success, true);
      const reg2 = await readFile(path.join(dir, 'CYCLE_REGISTRY.md'), 'utf8');
      const row2 = reg2.split('\n').filter(l => l.includes(`| ${folder} |`));
      assert.equal(row2.length, 1);
      assert.ok(row2[0].includes('summary beta'));
      assert.ok(!reg2.includes('summary alpha'));
      assert.equal(row2[0].split('|')[1].trim(), row1[0].split('|')[1].trim(), 'row number must not change');
      assert.match(row2[0], /\[completed\]/);
    });
  });

  it('a second cycle gets its own row', async () => {
    await withProject('cyc8-two-', async dir => {
      const orch = new CycleOrchestrator();
      const a = await orch.startCycle('CYC-8 first cycle');
      const b = await orch.startCycle('CYC-8 second cycle');
      await orch.registerSummary(a.taskId, 'first');
      await orch.registerSummary(b.taskId, 'second');
      await orch.registerSummary(a.taskId, 'first again');
      const rows = (await readFile(path.join(dir, 'CYCLE_REGISTRY.md'), 'utf8'))
        .split('\n').filter(l => /^\| \d+ \|/.test(l));
      assert.equal(rows.length, 2);
    });
  });
});

describe('[CYC-9] cleanup only archives terminal cycles', () => {
  it('old active state survives; old completed and old aborted are archived', async () => {
    await withProject('cyc9-', async dir => {
      const cyclesDir = path.join(dir, '.m7', 'cycles');
      await mkdir(cyclesDir, { recursive: true });
      const base = (taskId, extra) => ({
        taskId,
        taskSlug: taskId,
        taskDescription: taskId,
        currentPhase: 'architecture',
        completedPhases: ['intake', 'discovery'],
        artifacts: Object.fromEntries(PHASES.map(p => [p, null])),
        startedAt: new Date().toISOString(),
        lastUpdatedAt: new Date().toISOString(),
        phaseAttempts: Object.fromEntries(PHASES.map(p => [p, 0])),
        shortArtifactAttempts: Object.fromEntries(PHASES.map(p => [p, 0])),
        rewindCount: Object.fromEntries(PHASES.map(p => [p, 0])),
        awaitingReflection: false,
        taskFraming: taskId,
        reflections: [],
        phaseMcpCallCount: 0,
        phaseEnteredAt: new Date().toISOString(),
        projectPath: dir,
        ...extra,
      });
      const files = {
        cycle_old_active_1: base('cycle_old_active_1', { status: 'active' }),
        cycle_old_completed_1: base('cycle_old_completed_1', {
          status: 'completed', currentPhase: 'implementation', completedPhases: [...PHASES],
        }),
        cycle_old_aborted_1: base('cycle_old_aborted_1', { status: 'aborted' }),
      };
      const old = new Date(Date.now() - 9 * 24 * 3600 * 1000);
      for (const [id, data] of Object.entries(files)) {
        const p = path.join(cyclesDir, `${id}.json`);
        await writeFile(p, JSON.stringify(data));
        await utimes(p, old, old);
      }

      await new CycleOrchestrator().startCycle('CYC-9 trigger cleanup');

      await access(path.join(cyclesDir, 'cycle_old_active_1.json'));
      for (const id of ['cycle_old_completed_1', 'cycle_old_aborted_1']) {
        await assert.rejects(access(path.join(cyclesDir, `${id}.json`)), `${id} should leave cyclesDir`);
        await access(path.join(cyclesDir, 'archive', `${id}.json`));
      }
      const resumed = await new CycleOrchestrator().getCurrentInstruction('cycle_old_active_1');
      assert.equal(resumed.success, true, 'old active cycle must still be resumable');
    });
  });
});

describe('[CYC-10] every cycle has its own artifact folder', () => {
  const idSuffix = taskId => taskId.slice(-6);

  it('two cycles with one description → two folders, two histories, two registry rows', async () => {
    await withProject('cyc10-same-', async dir => {
      const orch = new CycleOrchestrator();
      const desc = 'CYC-10 same description';
      const a = await orch.startCycle(desc);
      const b = await orch.startCycle(desc);
      const sa = await orch.getState(a.taskId);
      const sb = await orch.getState(b.taskId);
      assert.notEqual(sa.taskSlug, sb.taskSlug);
      assert.ok(sa.taskSlug.endsWith(`-${idSuffix(a.taskId)}`), sa.taskSlug);
      assert.ok(sb.taskSlug.endsWith(`-${idSuffix(b.taskId)}`), sb.taskSlug);

      assert.equal((await orch.submitArtifact(a.taskId, fakeArtifact('intake', 'a'))).success, true);
      assert.equal((await reflect(orch, a.taskId)).success, true);
      assert.equal((await orch.submitArtifact(a.taskId, fakeArtifact('discovery', 'a'))).success, true);
      assert.equal((await orch.submitArtifact(b.taskId, fakeArtifact('intake', 'b'))).success, true);

      const folderA = path.join(dir, 'm7-cycles', sa.taskSlug);
      const folderB = path.join(dir, 'm7-cycles', sb.taskSlug);
      const intakeA = await readFile(path.join(folderA, 'INTAKE.md'), 'utf8');
      const intakeB = await readFile(path.join(folderB, 'INTAKE.md'), 'utf8');
      assert.ok(intakeA.includes('a'.repeat(220)) && !intakeA.includes('b'.repeat(220)));
      assert.ok(intakeB.includes('b'.repeat(220)) && !intakeB.includes('a'.repeat(220)));
      assert.doesNotMatch(intakeA + intakeB, /resubmitted/, 'a second cycle is not a resubmit of the first');
      assert.deepEqual(await readdir(folderB), ['INTAKE.md'], 'no phase of cycle A in cycle B');

      await orch.registerSummary(a.taskId, 'summary alpha');
      await orch.registerSummary(b.taskId, 'summary beta');
      const registry = await readFile(path.join(dir, 'CYCLE_REGISTRY.md'), 'utf8');
      const rows = registry.split('\n').filter(l => /^\| \d+ \|/.test(l));
      assert.equal(rows.length, 2);
      assert.ok(registry.includes('summary alpha') && registry.includes('summary beta'));
    });
  });

  it('20 parallel starts with one description → 20 ids, 20 folders', async () => {
    await withProject('cyc10-par-', async dir => {
      const orch = new CycleOrchestrator();
      const starts = await Promise.all(Array.from({ length: 20 }, () => orch.startCycle('CYC-10 parallel')));
      const ids = starts.map(s => s.taskId);
      assert.equal(new Set(ids).size, 20);
      const slugs = await Promise.all(ids.map(async id => (await orch.getState(id)).taskSlug));
      assert.equal(new Set(slugs).size, 20);
      assert.equal((await readdir(path.join(dir, 'm7-cycles'))).length, 20);
      for (const id of ids) await access(path.join(dir, '.m7', 'cycles', `${id}.json`));
    });
  });

  it('a taken id or folder is never reused: the next suffix is tried, and start fails when none is free', async () => {
    await withProject('cyc10-taken-', async dir => {
      const orch = new CycleOrchestrator();
      const seq = ['aaaaaa'];
      orch.nextIdSuffix = () => seq.shift() ?? 'ffffff';
      const a = await orch.startCycle('CYC-10 taken');
      assert.ok(a.taskId.endsWith('_aaaaaa'));

      seq.push('aaaaaa', 'bbbbbb');
      const b = await orch.startCycle('CYC-10 taken');
      assert.ok(b.taskId.endsWith('_bbbbbb'), b.taskId);

      await mkdir(path.join(dir, 'm7-cycles', 'cyc-10-taken-cccccc'));
      seq.push('cccccc', 'dddddd');
      const c = await orch.startCycle('CYC-10 taken');
      assert.ok(c.taskId.endsWith('_dddddd'), 'a leftover folder with the same name is not adopted');

      orch.nextIdSuffix = () => 'aaaaaa';
      await assert.rejects(orch.startCycle('CYC-10 taken'), /unique/);
      const states = (await readdir(path.join(dir, '.m7', 'cycles'))).filter(f => f.endsWith('.json'));
      assert.equal(states.length, 3);
      assert.equal((await orch.getState(a.taskId)).taskSlug, 'cyc-10-taken-aaaaaa');
    });
  });

  it('a cycle whose state predates the suffix keeps writing to its own folder', async () => {
    await withProject('cyc10-legacy-', async dir => {
      const { taskId } = await new CycleOrchestrator().startCycle('CYC-10 legacy');
      const file = path.join(dir, '.m7', 'cycles', `${taskId}.json`);
      const legacy = { ...JSON.parse(await readFile(file, 'utf8')), taskId: 'cycle_legacy_123456', taskSlug: 'cyc-10-legacy' };
      await writeFile(path.join(dir, '.m7', 'cycles', 'cycle_legacy_123456.json'), JSON.stringify(legacy));

      const orch = new CycleOrchestrator();
      assert.equal((await orch.submitArtifact('cycle_legacy_123456', fakeArtifact('intake', 'l'))).success, true);
      const intake = await readFile(path.join(dir, 'm7-cycles', 'cyc-10-legacy', 'INTAKE.md'), 'utf8');
      assert.ok(intake.includes('l'.repeat(220)));
    });
  });

  it('a start whose state cannot be written leaves no folder behind', async () => {
    await withProject('cyc10-ro-', async dir => {
      await mkdir(path.join(dir, '.m7'), { recursive: true });
      await writeFile(path.join(dir, '.m7', 'cycles'), 'not a directory');
      await assert.rejects(new CycleOrchestrator().startCycle('CYC-10 cannot persist'));
      const left = await readdir(path.join(dir, 'm7-cycles')).catch(() => []);
      assert.deepEqual(left, []);
    });
  });

  it('cleanup runs in the project the new cycle belongs to', async () => {
    const dirA = await makeProject('cyc10-clean-a-');
    const dirB = await makeProject('cyc10-clean-b-');
    try {
      resetProjectPathStateForTests();
      applyProjectPath(dirA);
      const orch = new CycleOrchestrator();
      applyProjectPath(dirB);

      const cyclesB = path.join(dirB, '.m7', 'cycles');
      await mkdir(cyclesB, { recursive: true });
      const { taskId } = await new CycleOrchestrator().startCycle('CYC-10 template');
      const old = JSON.parse(await readFile(path.join(cyclesB, `${taskId}.json`), 'utf8'));
      const doneFile = path.join(cyclesB, 'cycle_old_done_1.json');
      await writeFile(doneFile, JSON.stringify({
        ...old, taskId: 'cycle_old_done_1', status: 'completed', completedPhases: [...PHASES], currentPhase: 'implementation',
      }));
      const nineDaysAgo = new Date(Date.now() - 9 * 24 * 3600 * 1000);
      await utimes(doneFile, nineDaysAgo, nineDaysAgo);

      await orch.startCycle('CYC-10 started after the switch');
      await access(path.join(cyclesB, 'archive', 'cycle_old_done_1.json'));
      await assert.rejects(access(doneFile));
    } finally {
      await bindProject(SUITE_PROJECT);
      await removeProject(dirA);
      await removeProject(dirB);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Persisted state
// ═══════════════════════════════════════════════════════════════════

describe('[STATE-1] failed writes are reported; corrupt files fall back to backups', () => {
  it('(a) unwritable cycles dir → submitArtifact success false; completedPhases unchanged, also after restart', {
    skip: isRoot ? 'chmod does not restrict root' : false,
  }, async () => {
    const dir = await makeProject('state1a-');
    try {
      const [start] = await runWorker(dir, [{ op: 'cycle.start', params: { description: 'STATE-1 unwritable' } }]);
      const cyclesDir = path.join(dir, '.m7', 'cycles');
      await chmod(cyclesDir, 0o500);
      let submit;
      let inProcess;
      try {
        [submit, inProcess] = await runWorker(dir, [
          { op: 'cycle.submit', params: { taskId: start.taskId, content: fakeArtifact('intake') } },
          { op: 'cycle.state', params: { taskId: start.taskId } },
        ]);
      } finally {
        await chmod(cyclesDir, 0o755);
      }
      assert.equal(submit.success, false);
      assert.match(submit.error ?? '', /not persisted/i);
      assert.deepEqual(inProcess.completedPhases, [], 'in-memory state must not advance');

      const [afterRestart] = await runWorker(dir, [{ op: 'cycle.state', params: { taskId: start.taskId } }]);
      assert.equal(afterRestart.found, true);
      assert.deepEqual(afterRestart.completedPhases, []);
      assert.equal(afterRestart.awaitingReflection, false);
    } finally {
      await removeProject(dir);
    }
  });

  it('(b) safeReadJSON: corrupt main + valid .bak.1 → backup data with recoveredFrom', async () => {
    await withProject('state1b-', async dir => {
      const file = path.join(dir, 'state.json');
      await atomicWriteJSON(file, { v: 1 });
      await atomicWriteJSON(file, { v: 2 });
      const full = await readFile(file, 'utf8');
      await writeFile(file, full.slice(0, Math.floor(full.length / 2)));
      const res = await safeReadJSON(file);
      assert.deepEqual(res.data, { v: 1 });
      assert.equal(res.recoveredFrom, `${file}.bak.1`);
    });
  });

  it('(b) corrupt cycle state file → a restarted server resolves the cycle from backup', async () => {
    const dir = await makeProject('state1b-restart-');
    try {
      const [start] = await runWorker(dir, [
        { op: 'cycle.start', params: { description: 'STATE-1 corrupt restart' } },
        { op: 'cycle.submit', params: { taskId: '$0.taskId', content: fakeArtifact('intake') } },
        { op: 'cycle.reflect', params: { taskId: '$0.taskId' } },
      ]);
      const rel = path.join('.m7', 'cycles', `${start.taskId}.json`);
      await access(path.join(dir, `${rel}.bak.1`));
      const [, cur] = await runWorker(dir, [
        { op: 'fs.truncateHalf', params: { file: rel } },
        { op: 'cycle.get', params: { taskId: start.taskId } },
      ]);
      assert.equal(cur.success, true, cur.error);
      assert.ok(['intake', 'discovery'].includes(cur.phase), `recovered phase ${cur.phase}`);
    } finally {
      await removeProject(dir);
    }
  });
});

describe('[STATE-2] complete_session has a phase guard', () => {
  it('fresh session → completeSession false with a reason; force → true and forcedCompletion recorded', async () => {
    await withProject('state2-', async () => {
      const orch = new TaskOrchestrator(journalStub);
      const s = await orch.startTask('STATE-2 fresh session', 'light');
      assert.equal(await orch.completeSession(s.id), false);
      const refused = orch.getSessionStatus(s.id);
      assert.notEqual(refused.currentPhase, 'completed');
      assert.match(refused.lastError ?? '', /Cannot complete session from phase/);
      assert.equal(refused.forcedCompletion, undefined);

      assert.equal(await orch.completeSession(s.id, 'override', { force: true }), true);
      const forced = orch.getSessionStatus(s.id);
      assert.equal(forced.currentPhase, 'completed');
      assert.ok(forced.forcedCompletion?.at);
      assert.equal(forced.forcedCompletion.notes, 'override');
    });
  });

  it('tool path: complete_session on a fresh session is refused', async () => {
    await withProject('state2-tool-', async () => {
      const orch = new TaskOrchestrator(journalStub);
      const s = await orch.startTask('STATE-2 tool path', 'light');
      const res = await unifiedSessionTool.handler({ action: 'complete_session', session_id: s.id }, orch);
      const text = res.content.map(c => c.text).join('\n');
      assert.match(text, /Completion Refused/);
      assert.doesNotMatch(text, /Completed Successfully/);
    });
  });

  it('refusal and forced completion both survive a restart', async () => {
    const dir = await makeProject('state2-restart-');
    try {
      const [s, refused] = await runWorker(dir, [
        { op: 'session.start', params: { description: 'STATE-2 restart' } },
        { op: 'session.complete', params: { id: '$0.id' } },
      ]);
      assert.equal(refused.ok, false);
      const [status1, forced] = await runWorker(dir, [
        { op: 'session.status', params: { id: s.id } },
        { op: 'session.complete', params: { id: s.id, force: true, notes: 'forced' } },
      ]);
      assert.equal(status1.found, true);
      assert.notEqual(status1.currentPhase, 'completed');
      assert.equal(forced.ok, true);
      const [status2] = await runWorker(dir, [{ op: 'session.status', params: { id: s.id } }]);
      assert.equal(status2.currentPhase, 'completed');
      assert.ok(status2.forcedCompletion?.at);
    } finally {
      await removeProject(dir);
    }
  });
});

describe('[STATE-3] session persistence is drained on exit and stays with its project', () => {
  it('session created right before exit is on disk after restart', async () => {
    const dir = await makeProject('state3-');
    try {
      const [s] = await runWorker(dir, [{ op: 'session.start', params: { description: 'STATE-3 drain' } }]);
      const [status] = await runWorker(dir, [{ op: 'session.status', params: { id: s.id } }]);
      assert.equal(status.found, true);
    } finally {
      await removeProject(dir);
    }
  });

  it('first tool call after start sees persisted sessions (no race with the async load)', async () => {
    await withProject('state3-race-', async () => {
      const first = new TaskOrchestrator(journalStub);
      const s = await first.startTask('STATE-3 load race', 'light');
      await first.flushPersist();

      const fresh = new TaskOrchestrator(journalStub);
      const res = await unifiedSessionTool.handler({ action: 'status', session_id: s.id }, fresh);
      const text = res.content.map(c => c.text).join('\n');
      assert.doesNotMatch(text, /not found/i);
      assert.ok(text.includes(s.id));
    });
  });

  it('orchestrator built for project A keeps writing to A after the active project changes', async () => {
    const dirA = await makeProject('state3-a-');
    const dirB = await makeProject('state3-b-');
    try {
      resetProjectPathStateForTests();
      applyProjectPath(dirA);
      const orch = new TaskOrchestrator(journalStub);
      applyProjectPath(dirB);
      const s = await orch.startTask('STATE-3 pinned sessions file', 'light');
      await orch.flushPersist();
      const raw = JSON.parse(await readFile(path.join(dirA, '.m7', 'orchestrator-sessions.json'), 'utf8'));
      assert.ok(raw[s.id]);
      await assert.rejects(access(path.join(dirB, '.m7', 'orchestrator-sessions.json')));
    } finally {
      await bindProject(SUITE_PROJECT);
      await removeProject(dirA);
      await removeProject(dirB);
    }
  });
});

describe('[STATE-4] project state follows the resolved project, not process.cwd()', () => {
  // Every remaining process.cwd() in src/ and why it is not project state.
  const ALLOWED_CWD = new Map([
    ['src/core/utils/projectPath.ts', 'the last fallback of project resolution itself'],
    ['src/core/tools/doctorTool.ts', 'printed as a diagnostic next to the resolved path'],
    ['src/mesh/relay/server.ts', 'standalone relay process, not the MCP server'],
  ]);

  async function* tsFiles(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) yield* tsFiles(p);
      else if (entry.name.endsWith('.ts')) yield p;
    }
  }

  it('process.cwd() appears only in the allowed files', async () => {
    const offenders = [];
    for await (const file of tsFiles(path.join(ROOT, 'src'))) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (ALLOWED_CWD.has(rel)) continue;
      const lines = (await readFile(file, 'utf8')).split('\n');
      lines.forEach((l, i) => {
        if (/process\.cwd\(\)/.test(l) && !/^\s*(\*|\/\/)/.test(l)) offenders.push(`${rel}:${i + 1}`);
      });
    }
    assert.deepEqual(offenders, []);
  });

  it('cross-session knowledge from a session is stored under the project, nothing under cwd', async () => {
    const cwdStats = path.join(process.cwd(), '.m7', 'cross-session', 'stats.json');
    const before = await stat(cwdStats).then(s => s.mtimeMs, () => null);
    await withProject('state4-cs-', async dir => {
      assert.notEqual(path.resolve(process.cwd()), path.resolve(dir), 'the check needs cwd ≠ project');
      const orch = new TaskOrchestrator(journalStub);
      const s = await orch.startTask('STATE-4 cross-session location', 'light');
      assert.equal(await orch.completeSession(s.id, 'done', { force: true }), true);
      await access(path.join(dir, '.m7', 'cross-session', 'stats.json'));
    });
    assert.equal(await stat(cwdStats).then(s => s.mtimeMs, () => null), before, 'cwd/.m7/cross-session untouched');
  });

  it('getCrossSessionLearning returns one instance per project', async () => {
    const { getCrossSessionLearning } = await import('../dist/cross-session/index.js');
    const dirA = await makeProject('state4-a-');
    const dirB = await makeProject('state4-b-');
    try {
      resetProjectPathStateForTests();
      applyProjectPath(dirA);
      const a = getCrossSessionLearning();
      applyProjectPath(dirB);
      const b = getCrossSessionLearning();
      assert.notEqual(a, b);
      applyProjectPath(dirA);
      assert.equal(getCrossSessionLearning(), a);
    } finally {
      await bindProject(SUITE_PROJECT);
      await removeProject(dirA);
      await removeProject(dirB);
    }
  });

  it('git capture defaults to the project and passes exclude pathspecs without a shell', async t => {
    const hasGit = await execFileAsync('git', ['--version']).then(() => true, () => false);
    if (!hasGit) {
      t.skip('git not installed');
      return;
    }
    const { captureStagedDiff, buildExcludeArgs } = await import('../dist/telemetry/gitCapture.js');
    await withProject('state4-git-', async dir => {
      await execFileAsync('git', ['init', '-q'], { cwd: dir });
      await writeFile(path.join(dir, 'a.ts'), 'export const a = 1;\n');
      await writeFile(path.join(dir, 'yarn.lock'), 'lock\n');
      await execFileAsync('git', ['add', 'a.ts', 'yarn.lock'], { cwd: dir });

      assert.ok(buildExcludeArgs().includes(':(exclude)yarn.lock'));
      for (const result of [captureStagedDiff(dir), captureStagedDiff()]) {
        assert.ok(result, 'staged diff of the bound project');
        assert.equal(result.files_changed, 1);
        assert.match(result.diff, /a\.ts/);
        assert.doesNotMatch(result.diff, /yarn\.lock/);
      }
    });
  });
});

describe('[STATE-5] the contract registry keeps every contract it reports as registered', () => {
  const SCHEMA = 'project:\n  name: state5-fixture\n  version: 0.0.1\n';
  const systemsFor = dir => {
    const journal = new JournalSystem(dir);
    return { journal, schema: new SchemaSystem(journal, dir) };
  };
  const register = (systems, name, type) =>
    contractsTool.handler({ action: 'register', contract: { name, type, purpose: `purpose of ${name}` } }, systems);
  const list = async systems => (await contractsTool.handler({ action: 'list' }, systems)).contracts;

  it('function, endpoint, method, class → listed in the same session, after a restart, and after one more register', async () => {
    await withProject('state5-', async dir => {
      await writeFile(path.join(dir, 'PROJECT_SCHEMA.yaml'), SCHEMA);
      const s1 = systemsFor(dir);
      const kinds = [['getUserById', 'function'], ['GET /users', 'endpoint'], ['User.save', 'method'], ['UserService', 'class']];
      for (const [name, type] of kinds) {
        const r = await register(s1, name, type);
        assert.equal(r.success, true, `${name}: ${r.message}`);
      }
      const same = await list(s1);
      assert.deepEqual(same.map(c => c.name).sort(), kinds.map(k => k[0]).sort());

      const s2 = systemsFor(dir);
      const restarted = await list(s2);
      assert.deepEqual(restarted.map(c => `${c.name}:${c.type}`).sort(), kinds.map(k => k.join(':')).sort());
      const idsBefore = Object.fromEntries(same.map(c => [c.name, c.id]));
      for (const c of restarted) assert.equal(c.id, idsBefore[c.name], `${c.name}: id changed across restart`);

      assert.equal((await register(s2, 'createOrder', 'function')).success, true);
      const after = await list(systemsFor(dir));
      assert.equal(after.length, 5);
      const yamlText = await readFile(path.join(dir, 'PROJECT_SCHEMA.yaml'), 'utf8');
      for (const [name] of [...kinds, ['createOrder']]) assert.ok(yamlText.includes(name), `${name} missing from PROJECT_SCHEMA.yaml`);
    });
  });

  it('re-registering a name keeps its id and creation time', async () => {
    await withProject('state5-rereg-', async dir => {
      await writeFile(path.join(dir, 'PROJECT_SCHEMA.yaml'), SCHEMA);
      const first = (await register(systemsFor(dir), 'getOrder', 'function')).contract;
      const again = (await register(systemsFor(dir), 'getOrder', 'function')).contract;
      assert.equal(again.id, first.id);
      assert.equal(new Date(again.createdAt).getTime(), new Date(first.createdAt).getTime());
      assert.equal((await list(systemsFor(dir))).length, 1);
    });
  });

  it('no PROJECT_SCHEMA.yaml → register fails, nothing is written, nothing is listed', async () => {
    await withProject('state5-noschema-', async dir => {
      const s = systemsFor(dir);
      const r = await register(s, 'getUserById', 'function');
      assert.equal(r.success, false);
      assert.match(r.error, /init_project|PROJECT_SCHEMA/i);
      await assert.rejects(access(path.join(dir, 'PROJECT_SCHEMA.yaml')));
      assert.deepEqual(await list(s), []);
    });
  });

  it('unreadable PROJECT_SCHEMA.yaml → register fails and the file is left as it was', async () => {
    await withProject('state5-corrupt-', async dir => {
      const file = path.join(dir, 'PROJECT_SCHEMA.yaml');
      await writeFile(file, 'project: [unclosed\n');
      const r = await register(systemsFor(dir), 'getUserById', 'function');
      assert.equal(r.success, false);
      assert.equal(await readFile(file, 'utf8'), 'project: [unclosed\n');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Memory
// ═══════════════════════════════════════════════════════════════════

describe('[MEM-0] one read path: the result before restart equals the result after', () => {
  it('[MEM-0a] deleted mirror record stays deleted after restart', async () => {
    const dir = await makeProject('mem0a-');
    const token = `MirrorTombstone${Date.now()}`;
    try {
      await writeFile(path.join(dir, 'INDEX.md'), `## ${token}\n\n${token} alpha beta gamma.\n`);
      const [first] = await runWorker(dir, [{ op: 'mem.search', params: { query: token } }]);
      const mirror = first.hits.find(h => h.id.startsWith('ref_INDEX.md_'));
      assert.ok(mirror, `mirror hit expected, got ${JSON.stringify(first.hits)}`);

      const [del, warmGet, warmSearch] = await runWorker(dir, [
        { op: 'mem.delete', params: { id: mirror.id } },
        { op: 'mem.get', params: { id: mirror.id } },
        { op: 'mem.search', params: { query: token } },
      ]);
      assert.equal(del.deleted, true);
      const [coldGet, coldSearch] = await runWorker(dir, [
        { op: 'mem.get', params: { id: mirror.id } },
        { op: 'mem.search', params: { query: token } },
      ]);
      assert.deepEqual(coldGet, warmGet);
      assert.equal(coldGet.found, false);
      assert.deepEqual(coldSearch.hits.map(h => h.id), warmSearch.hits.map(h => h.id));
      assert.ok(!coldSearch.hits.some(h => h.id === mirror.id));
    } finally {
      await removeProject(dir);
    }
  });

  it('[MEM-0b] contradicts confidences are identical before and after restart', async () => {
    const dir = await makeProject('mem0b-');
    try {
      const [a, b, aWarm] = await runWorker(dir, [
        { op: 'mem.store', params: { content: `fact A ${'x'.repeat(40)}`, level: 'L2', confidence: 0.9 } },
        { op: 'mem.store', params: { content: 'fact B contradicts A', level: 'L2', confidence: 0.9, contradicts: '$0.id' } },
        { op: 'mem.get', params: { id: '$0.id' } },
      ]);
      const [aCold, bCold] = await runWorker(dir, [
        { op: 'mem.get', params: { id: a.id } },
        { op: 'mem.get', params: { id: b.id } },
      ]);
      assert.ok(aWarm.confidence < 0.9, 'contradiction must lower A');
      assert.equal(aCold.confidence, aWarm.confidence);
      assert.equal(bCold.confidence, b.confidence);
    } finally {
      await removeProject(dir);
    }
  });

  it('[MEM-0c] level and confidence filters apply to mirrors, identically warm and cold', async () => {
    const dir = await makeProject('mem0c-');
    const token = `FilterMirror${Date.now()}`;
    try {
      await writeFile(path.join(dir, 'INDEX.md'), `## ${token}\n\n${token} searchable paragraph.\n`);
      const queries = [
        { op: 'mem.search', params: { query: token } },
        { op: 'mem.search', params: { query: token, levels: ['L0'] } },
        { op: 'mem.search', params: { query: token, minConfidence: 0.8 } },
      ];
      const warm = await runWorker(dir, queries);
      const cold = await runWorker(dir, queries);
      const mirror = warm[0].hits.find(h => h.id.startsWith('ref_'));
      assert.ok(mirror, 'unfiltered search must return the mirror');
      assert.ok(mirror.confidence <= MIRROR_MAX_CONFIDENCE + 1e-9);
      assert.ok(!warm[1].hits.some(h => h.id.startsWith('ref_')), 'levels filter must exclude mirror');
      assert.ok(!warm[2].hits.some(h => h.id.startsWith('ref_')), 'confidence filter must exclude mirror');
      for (let i = 0; i < queries.length; i++) {
        assert.deepEqual(cold[i].hits.map(h => h.id).sort(), warm[i].hits.map(h => h.id).sort(), `query ${i}`);
      }
    } finally {
      await removeProject(dir);
    }
  });

  it('[MEM-0d] L4 record is fetchable by id after restart', async () => {
    const dir = await makeProject('mem0d-');
    try {
      const [rec, warm] = await runWorker(dir, [
        { op: 'mem.store', params: { content: `project-level fact ${'z'.repeat(30)}`, level: 'L4', confidence: 0.85 } },
        { op: 'mem.get', params: { id: '$0.id' } },
      ]);
      const [cold] = await runWorker(dir, [{ op: 'mem.get', params: { id: rec.id } }]);
      assert.equal(rec.level, 'L4');
      assert.deepEqual(cold, warm);
    } finally {
      await removeProject(dir);
    }
  });
});

describe('[MEM-1] invalidate_bulk persists', () => {
  it('after invalidate_bulk and a restart, confidence is reduced and invalidatedAt is set', async () => {
    const dir = await makeProject('mem1-');
    try {
      const [rec, tool] = await runWorker(dir, [
        { op: 'mem.store', params: { content: `MEM-1 payload ${'q'.repeat(60)}`, level: 'L2', confidence: 0.9 } },
        { op: 'mem.tool', params: { args: { action: 'invalidate_bulk', ids: ['$0.id'] } } },
      ]);
      assert.match(tool.text, /\*\*Invalidated:\*\* 1\/1/);
      const [cold] = await runWorker(dir, [{ op: 'mem.get', params: { id: rec.id } }]);
      assert.ok(Math.abs(cold.confidence - 0.27) < 1e-9, `confidence ${cold.confidence}`);
      assert.ok(cold.invalidatedAt);
    } finally {
      await removeProject(dir);
    }
  });

  it('unknown id is reported as not found, not counted as invalidated', async () => {
    const dir = await makeProject('mem1-missing-');
    try {
      const [tool] = await runWorker(dir, [
        { op: 'mem.tool', params: { args: { action: 'invalidate_bulk', ids: ['mem_does_not_exist'] } } },
      ]);
      assert.match(tool.text, /\*\*Invalidated:\*\* 0\/1/);
      assert.match(tool.text, /Not found/);
    } finally {
      await removeProject(dir);
    }
  });
});

describe('[MEM-2] confidence 0 survives a round trip', () => {
  for (const level of ['L2', 'L3', 'L4']) {
    it(`${level}: stored with confidence 0 → 0 after restart`, async () => {
      const dir = await makeProject('mem2-');
      try {
        const [rec] = await runWorker(dir, [
          { op: 'mem.store', params: { content: `refuted ${level} ${'r'.repeat(40)}`, level, confidence: 0 } },
        ]);
        assert.equal(rec.confidence, 0);
        const [cold] = await runWorker(dir, [{ op: 'mem.get', params: { id: rec.id } }]);
        assert.equal(cold.found, true);
        assert.equal(cold.confidence, 0);
      } finally {
        await removeProject(dir);
      }
    });
  }
});

describe('[MEM-3] pending writes are drained before exit (in-process half; SIGTERM half in E2E)', () => {
  it('L2 store is absent before flush and present after flushAllWithTimeout', async () => {
    await withProject('mem3-', async dir => {
      resetMemoryCore();
      const core = await getMemoryCore(dir);
      const rec = await core.store(`MEM-3 ${'m'.repeat(80)}`, { level: 'L2', source: 'experiment' });
      const file = path.join(dir, '.m7', 'memory', 'longterm.json');
      await assert.rejects(access(file));
      assert.equal(await flushAllWithTimeout(), 'done');
      assert.ok(JSON.parse(await readFile(file, 'utf8'))[rec.id]);
    });
  });

  it('a worker that exits right after store leaves the record on disk', async () => {
    const dir = await makeProject('mem3-worker-');
    try {
      const [rec] = await runWorker(dir, [
        { op: 'mem.store', params: { content: `MEM-3 worker ${'w'.repeat(60)}`, level: 'L2' } },
      ]);
      const [cold] = await runWorker(dir, [{ op: 'mem.get', params: { id: rec.id } }]);
      assert.equal(cold.found, true);
    } finally {
      await removeProject(dir);
    }
  });
});

describe('[MEM-4] loading more than 2000 long-term records loses nothing', () => {
  it('2100-entry longterm.json → 2100 loaded, 2101 on disk, still 2101 after a second restart', async () => {
    const dir = await makeProject('mem4-');
    try {
      const memDir = path.join(dir, '.m7', 'memory');
      await mkdir(memDir, { recursive: true });
      const data = {};
      for (let i = 0; i < 2100; i++) {
        data[`mem4-${String(i).padStart(4, '0')}`] = { data: { n: i }, timestamp: new Date().toISOString(), level: 'longterm' };
      }
      const file = path.join(memDir, 'longterm.json');
      await writeFile(file, JSON.stringify(data));

      const [first] = await runWorker(dir, [{ op: 'ms.roundtrip', params: { key: 'mem4-new-1' } }]);
      assert.equal(first.loaded, 2100);
      assert.equal(Object.keys(JSON.parse(await readFile(file, 'utf8'))).length, 2101);

      const [second] = await runWorker(dir, [{ op: 'ms.roundtrip', params: { key: 'mem4-new-2' } }]);
      assert.equal(second.loaded, 2101);
      const final = JSON.parse(await readFile(file, 'utf8'));
      assert.equal(Object.keys(final).length, 2102);
      assert.ok(final['mem4-0000'] && final['mem4-2099']);
    } finally {
      await removeProject(dir);
    }
  });
});

describe('[MEM-5] later writes never push an earlier record off the disk', () => {
  const fogEntry = (p, confidence = 0.5) => ({
    id: `fog-${p}`, path: p, discovery: `seen ${p}`, technical_details: {}, dependencies: [],
    discovered_at: new Date().toISOString(), confidence, source: 'code_analysis',
  });

  it('review trace: first record, then 2000 more with a drain every 49 → the first is still on disk and readable', async () => {
    await withProject('mem5-trace-', async dir => {
      const file = path.join(dir, '.m7', 'memory', 'longterm.json');
      const first = new MemorySystem(dir);
      await first.ensureLoaded();
      await first.store('first', { v: 1 }, 'longterm');
      await first.shutdown();
      assert.ok(JSON.parse(await readFile(file, 'utf8')).first);

      const ms = new MemorySystem(dir);
      await ms.ensureLoaded();
      for (let i = 0; i < 2000; i++) {
        await ms.store(`later-${i}`, { i }, 'longterm');
        if (i % 49 === 48) await ms.shutdown();
      }
      await ms.shutdown();

      const onDisk = JSON.parse(await readFile(file, 'utf8'));
      assert.equal(Object.keys(onDisk).length, 2001);
      assert.ok(onDisk.first, 'first record is still in longterm.json');
      const fresh = new MemorySystem(dir);
      await fresh.ensureLoaded();
      assert.deepEqual(await fresh.retrieve('first', 'longterm'), { v: 1 });
    });
  });

  it('conceptual level: 1001 writes keep all 1001', async () => {
    await withProject('mem5-concept-', async dir => {
      const ms = new MemorySystem(dir);
      await ms.ensureLoaded();
      for (let i = 0; i <= 1000; i++) await ms.store(`c-${i}`, { i }, 'conceptual');
      await ms.shutdown();
      const onDisk = JSON.parse(await readFile(path.join(dir, '.m7', 'memory', 'conceptual.json'), 'utf8'));
      assert.equal(Object.keys(onDisk).length, 1001);
      assert.ok(onDisk['c-0']);
    });
  });

  it('public path: an L2 record survives 2000 later L2 records and a restart', async () => {
    const dir = await makeProject('mem5-core-');
    try {
      const [rec] = await runWorker(dir, [{ op: 'mem.store', params: { content: `MEM-5 first ${'f'.repeat(60)}`, level: 'L2' } }]);
      await runWorker(dir, [{ op: 'mem.storeMany', params: { count: 2000, prefix: 'MEM-5 later' } }], { timeoutMs: 120_000 });
      const onDisk = JSON.parse(await readFile(path.join(dir, '.m7', 'memory', 'longterm.json'), 'utf8'));
      assert.equal(Object.keys(onDisk).length, 2001);
      const [got] = await runWorker(dir, [{ op: 'mem.get', params: { id: rec.id } }]);
      assert.equal(got.found, true, 'first L2 record must survive');
      assert.match(got.content, /^MEM-5 first/);
    } finally {
      await removeProject(dir);
    }
  });

  it('fog of war: a 600-entry file survives load + update, and the 501st runtime entry does not evict the 1st', async () => {
    await withProject('mem5-fog-', async dir => {
      const fogFile = path.join(dir, '.m7', 'memory', 'fog_of_war.json');
      await mkdir(path.dirname(fogFile), { recursive: true });
      await writeFile(fogFile, JSON.stringify(Array.from({ length: 600 }, (_, i) => fogEntry(`src/f${i}.ts`))));
      const loaded = new MemorySystem(dir);
      await loaded.ensureLoaded();
      assert.equal((await loaded.getFogOfWar()).length, 600);
      await loaded.discoverTechnicalDetail('src/new.ts', fogEntry('src/new.ts', 0.9));
      const afterLoad = JSON.parse(await readFile(fogFile, 'utf8'));
      assert.equal(afterLoad.length, 601);
      assert.ok(afterLoad.some(e => e.path === 'src/f0.ts'));

      await writeFile(fogFile, '[]');
      const ms = new MemorySystem(dir);
      await ms.ensureLoaded();
      for (let i = 0; i <= 500; i++) await ms.discoverTechnicalDetail(`src/r${i}.ts`, fogEntry(`src/r${i}.ts`));
      const runtime = JSON.parse(await readFile(fogFile, 'utf8'));
      assert.equal(runtime.length, 501);
      assert.ok(runtime.some(e => e.path === 'src/r0.ts'));
    });
  });

  it('tombstones: 5001 on disk, one more delete → the oldest is still recorded', async () => {
    const dir = await makeProject('mem5-tomb-');
    try {
      const tombFile = path.join(dir, '.m7', 'memory-tombstones.json');
      await mkdir(path.dirname(tombFile), { recursive: true });
      await writeFile(tombFile, JSON.stringify({ version: 1, ids: Array.from({ length: 5001 }, (_, i) => `gone-${i}`) }));
      const [rec] = await runWorker(dir, [{ op: 'mem.store', params: { content: `MEM-5 to delete ${'d'.repeat(60)}`, level: 'L2' } }]);
      await runWorker(dir, [{ op: 'mem.delete', params: { id: rec.id } }]);
      const ids = JSON.parse(await readFile(tombFile, 'utf8')).ids;
      assert.ok(ids.includes('gone-0'), 'oldest tombstone dropped');
      assert.ok(ids.includes(rec.id));
      assert.equal(ids.length, 5002);
    } finally {
      await removeProject(dir);
    }
  });

  it('a write issued before the load finished is not wiped by the load', async () => {
    await withProject('mem5-race-', async dir => {
      const file = path.join(dir, '.m7', 'memory', 'longterm.json');
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify({ old: { data: { v: 0 }, timestamp: new Date().toISOString(), level: 'longterm' } }));
      const ms = new MemorySystem(dir);
      await ms.store('early', { v: 1 }, 'longterm');
      await ms.shutdown();
      const onDisk = JSON.parse(await readFile(file, 'utf8'));
      assert.ok(onDisk.old && onDisk.early, JSON.stringify(Object.keys(onDisk)));
    });
  });
});

describe('[MEM-7] memory writes land in order and are all on disk after shutdown', () => {
  const countOnDisk = async dir =>
    Object.keys(JSON.parse(await readFile(path.join(dir, '.m7', 'memory', 'longterm.json'), 'utf8').catch(() => '{}'))).length;

  for (const n of [50, 120, 2000]) {
    it(`${n} stores, then the process exits → ${n} on disk`, async () => {
      const dir = await makeProject(`mem7-exit-${n}-`);
      try {
        await runWorker(dir, [{ op: 'mem.storeMany', params: { count: n, prefix: 'MEM-7 exit' } }], { timeoutMs: 120_000 });
        assert.equal(await countOnDisk(dir), n);
      } finally {
        await removeProject(dir);
      }
    });
  }

  it('500 stores while the first file write is held: one write at a time, the newest snapshot lands last', async () => {
    await withProject('mem7-order-', async dir => {
      const ms = new MemorySystem(dir);
      await ms.ensureLoaded();
      const realWrite = ms.writeFile.bind(ms);
      let release;
      const held = new Promise(r => { release = r; });
      const started = [];
      let inFlight = 0;
      let maxInFlight = 0;
      ms.writeFile = (file, data) => {
        const first = started.length === 0;
        const run = (async () => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          try {
            if (first) await held;
            await realWrite(file, data);
          } finally {
            inFlight--;
          }
        })();
        started.push(run);
        return run;
      };

      for (let i = 0; i < 500; i++) await ms.store(`k${i}`, { i }, 'longterm');
      await new Promise(r => setTimeout(r, 50));
      release();
      await ms.shutdown();
      await Promise.allSettled(started);

      assert.ok(started.length >= 2, `expected several flushes, got ${started.length}`);
      assert.equal(maxInFlight, 1, 'two snapshots of one file were written concurrently');
      assert.equal(await countOnDisk(dir), 500, 'a stale snapshot overwrote a newer one');
    });
  });

  it('a delete issued while flushes are in flight stays deleted, and nothing else is lost', async () => {
    await withProject('mem7-delete-', async dir => {
      const ms = new MemorySystem(dir);
      await ms.ensureLoaded();
      for (let i = 0; i < 60; i++) await ms.store(`d${i}`, { i }, 'longterm');
      assert.equal(await ms.delete('d10', 'longterm'), true);
      await ms.shutdown();
      const onDisk = JSON.parse(await readFile(path.join(dir, '.m7', 'memory', 'longterm.json'), 'utf8'));
      assert.equal(Object.keys(onDisk).length, 59);
      assert.equal(onDisk.d10, undefined);
      assert.ok(onDisk.d59);
    });
  });

  it('a write in project A right before a switch to B is on A’s disk after flushAll', async () => {
    const dirA = await makeProject('mem7-a-');
    const dirB = await makeProject('mem7-b-');
    try {
      await bindProject(dirA);
      resetMemoryCore();
      const a = await getMemoryCore();
      const rec = await a.store(`MEM-7 written in A ${'a'.repeat(60)}`, { level: 'L2' });
      await bindProject(dirB);
      await getMemoryCore();
      await flushAllWithTimeout();
      const onDisk = JSON.parse(await readFile(path.join(dirA, '.m7', 'memory', 'longterm.json'), 'utf8').catch(() => '{}'));
      assert.ok(onDisk[rec.id], 'write made in A before the switch was dropped');
    } finally {
      await bindProject(SUITE_PROJECT);
      resetMemoryCore();
      await removeProject(dirA);
      await removeProject(dirB);
    }
  });
});

describe('[MEM-6] reading PROJECT_SCHEMA.yaml stores nothing in memory', () => {
  it('three loadSchema() calls → the schema is returned, memory is unchanged', async () => {
    await withProject('mem6-', async dir => {
      await writeFile(path.join(dir, 'PROJECT_SCHEMA.yaml'), 'project:\n  name: mem6-schema-fixture\n  version: 0.0.1\n');
      const core = await getMemoryCore(dir);
      const before = (await core.getStats()).totalRecords;
      const schema = new SchemaSystem(new JournalSystem(dir), dir);
      for (let i = 0; i < 3; i++) assert.equal((await schema.loadSchema()).project.name, 'mem6-schema-fixture');
      await flushAllWithTimeout();
      assert.equal((await core.getStats()).totalRecords, before);
      const longterm = JSON.parse(await readFile(path.join(dir, '.m7', 'memory', 'longterm.json'), 'utf8').catch(() => '{}'));
      assert.equal(Object.values(longterm).filter(v => JSON.stringify(v).includes('mem6-schema-fixture')).length, 0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Task graph and transfer
// ═══════════════════════════════════════════════════════════════════

async function withGraph(fn) {
  return withProject('graph-', async dir => {
    const mgr = new TaskGraphManager(dir);
    await mgr.initialize();
    return fn(mgr, dir);
  });
}

const SCOPE = { type: 'scope_expansion', originalEstimate: 1, newEstimate: 10 };

describe('[GRAPH-1] depth-limited traversal includes every node within depth', () => {
  it('diamond A→B→C, A→C, C→D with A→B→C walked first: depth 2 includes D, depth 1 does not', async () => {
    await withGraph(async mgr => {
      for (const id of ['A', 'B', 'C', 'D']) await mgr.createTask({ id, title: id, folder: `.m7/t/${id}` });
      await mgr.createLink('A', 'B', 'related', 'ab');
      await mgr.createLink('B', 'C', 'related', 'bc');
      await mgr.createLink('A', 'C', 'related', 'ac');
      await mgr.createLink('C', 'D', 'related', 'cd');
      const ids = async depth =>
        (await mgr.getSubgraph({ centerId: 'A', depth, includeCompleted: true })).tasks.map(t => t.id).sort();
      assert.deepEqual(await ids(2), ['A', 'B', 'C', 'D']);
      assert.deepEqual(await ids(1), ['A', 'B', 'C']);
      assert.deepEqual(await ids(0), ['A']);
    });
  });

  it('no node is returned twice', async () => {
    await withGraph(async mgr => {
      for (const id of ['A', 'B', 'C']) await mgr.createTask({ id, title: id, folder: `.m7/t/${id}` });
      await mgr.createLink('A', 'B', 'related', 'ab');
      await mgr.createLink('B', 'C', 'related', 'bc');
      await mgr.createLink('A', 'C', 'related', 'ac');
      const tasks = (await mgr.getSubgraph({ centerId: 'A', depth: 3, includeCompleted: true })).tasks;
      assert.equal(new Set(tasks.map(t => t.id)).size, tasks.length);
    });
  });
});

describe('[GRAPH-2] transfer ids cannot collide', () => {
  it('two transfers with identical descriptions and a frozen clock → two distinct tasks', async () => {
    await withGraph(async mgr => {
      await mgr.createTask({ id: 'from', title: 'from', folder: '.m7/t/from' });
      const tm = new TransferManager(undefined, mgr);
      const realNow = Date.now;
      Date.now = () => 1_700_000_000_000;
      let r1;
      let r2;
      try {
        r1 = await tm.executeTransfer('from', 'scope_expansion', 'same description', SCOPE);
        r2 = await tm.executeTransfer('from', 'scope_expansion', 'same description', SCOPE);
      } finally {
        Date.now = realNow;
      }
      assert.equal(r1.success, true, r1.error);
      assert.equal(r2.success, true, r2.error);
      assert.notEqual(r1.newTaskId, r2.newTaskId);
      assert.ok(await mgr.getTask(r1.newTaskId));
      assert.ok(await mgr.getTask(r2.newTaskId));
      assert.equal((await mgr.getStats()).totalTasks, 3);
    });
  });

  it('createTask refuses to overwrite an existing id', async () => {
    await withGraph(async mgr => {
      await mgr.createTask({ id: 'dup', title: 'one', folder: '.m7/t/dup' });
      await assert.rejects(mgr.createTask({ id: 'dup', title: 'two', folder: '.m7/t/dup2' }), /already exists/);
      assert.equal((await mgr.getTask('dup')).title, 'one');
    });
  });
});

describe('[GRAPH-3] a failed transfer leaves the graph exactly as it was', () => {
  const comparable = raw => {
    const g = JSON.parse(raw);
    delete g.meta.lastUpdated; // save() stamps the write time; everything else must match
    return g;
  };

  for (const failing of ['createLink', 'updateTaskStatus']) {
    it(`${failing} throws → graph JSON before equals graph JSON after`, async () => {
      await withGraph(async (mgr, dir) => {
        await mgr.createTask({ id: 'src', title: 'source', folder: '.m7/t/src' });
        await mgr.createTask({ id: 'other', title: 'other', folder: '.m7/t/other' });
        await mgr.createLink('src', 'other', 'related', 'pre-existing');
        const graphFile = path.join(dir, '.m7', 'task-graph.json');
        const before = comparable(await readFile(graphFile, 'utf8'));

        const original = mgr[failing].bind(mgr);
        mgr[failing] = async (...args) => {
          if (failing === 'updateTaskStatus' && args[1] !== 'transferred') return original(...args);
          throw new Error(`stub ${failing} failure`);
        };
        const res = await new TransferManager(undefined, mgr).executeTransfer('src', 'scope_expansion', 'rollback', SCOPE);
        mgr[failing] = original;

        assert.equal(res.success, false);
        assert.match(res.error, new RegExp(`stub ${failing} failure`));
        const afterRaw = await readFile(graphFile, 'utf8');
        assert.deepEqual(comparable(afterRaw), before);

        const fresh = new TaskGraphManager(dir);
        await fresh.initialize();
        const src = await fresh.getTask('src');
        assert.equal(src.status, 'active');
        assert.equal(src.outcome, undefined);
        assert.equal(src.completed, undefined);
        await assert.rejects(access(path.join(dir, 'docs', 'debug')), 'no task folder or TASK_META left on disk');
      });
    });
  }

  it('missing source task → failure without creating anything', async () => {
    await withGraph(async (mgr, dir) => {
      await mgr.createTask({ id: 'only', title: 'only', folder: '.m7/t/only' });
      const graphFile = path.join(dir, '.m7', 'task-graph.json');
      const before = comparable(await readFile(graphFile, 'utf8'));
      const res = await new TransferManager(undefined, mgr).executeTransfer('ghost', 'scope_expansion', 'x', SCOPE);
      assert.equal(res.success, false);
      assert.match(res.error, /Source task not found/);
      assert.deepEqual(comparable(await readFile(graphFile, 'utf8')), before);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Gates and output
// ═══════════════════════════════════════════════════════════════════

function groundingArtifact(premises, steps) {
  return `\`\`\`json\n${JSON.stringify({ grounding: { premises, steps } })}\n\`\`\``;
}

describe('[GATE-1] path: premises are checked on the filesystem', () => {
  it('existing file without fog entry → FOUND; nonexistent file → NOT_FOUND', async () => {
    await withProject('gate1-', async dir => {
      resetMemoryCore();
      await mkdir(path.join(dir, 'src'), { recursive: true });
      await writeFile(path.join(dir, 'src', 'present.ts'), 'export const x = 1;\n');
      const spec = parseGroundingSpec(groundingArtifact(
        [
          { id: 'p1', ref: 'path:src/present.ts', claim: 'exists' },
          { id: 'p2', ref: 'path:src/absent.ts', claim: 'missing' },
        ],
        [{ id: 's1', description: 'edit', reversibility: 'reversible', premise_ids: ['p1', 'p2'] }],
      ));
      const result = await runGroundingCheck(spec, 'full');
      const byId = Object.fromEntries(result.resolved.map(r => [r.premiseId ?? r.id, r]));
      const present = result.resolved.find(r => r.ref === 'path:src/present.ts') ?? byId.p1;
      const absent = result.resolved.find(r => r.ref === 'path:src/absent.ts') ?? byId.p2;
      assert.equal(present.found, true);
      assert.equal(absent.found, false);
      assert.ok(result.warnings.some(w => w.status === 'NOT_FOUND' && w.ref === 'path:src/absent.ts'));
      assert.ok(!result.warnings.some(w => w.ref === 'path:src/present.ts'));
    });
  });

  it('path traversal outside the project is NOT_FOUND', async () => {
    await withProject('gate1-escape-', async () => {
      resetMemoryCore();
      const spec = parseGroundingSpec(groundingArtifact(
        [{ id: 'p1', ref: 'path:../../../etc/hosts', claim: 'outside' }],
        [{ id: 's1', description: 'read', reversibility: 'reversible', premise_ids: ['p1'] }],
      ));
      const result = await runGroundingCheck(spec, 'full');
      assert.equal(result.resolved[0].found, false);
    });
  });
});

describe('[GATE-2] irreversible step without premises is a strong warning', () => {
  it('one irreversible step, premise_ids [] → exactly one strong warning naming the step', async () => {
    const spec = parseGroundingSpec(groundingArtifact(
      [],
      [{ id: 'drop_table', description: 'drop prod table', reversibility: 'irreversible', premise_ids: [] }],
    ));
    const result = await runGroundingCheck(spec, 'full');
    const strong = result.warnings.filter(w => w.severity === 'strong');
    assert.equal(strong.length, 1);
    assert.deepEqual(strong[0].stepIds, ['drop_table']);
    assert.match(strong[0].message, /drop_table/);
  });

  it('reversible step without premises raises no strong warning', async () => {
    const spec = parseGroundingSpec(groundingArtifact(
      [],
      [{ id: 'tweak', description: 'tweak copy', reversibility: 'reversible', premise_ids: [] }],
    ));
    const result = await runGroundingCheck(spec, 'full');
    assert.equal(result.warnings.filter(w => w.severity === 'strong').length, 0);
  });
});

describe('[GATE-3] gate prompt rendered once; no sourceless error banner', () => {
  it('formatted response for one gate contains "Gate-ID:" exactly once, at every gated phase', async () => {
    const orch = new CycleOrchestrator();
    const { taskId } = await orch.startCycle('GATE-3 single gate render');
    for (const phase of PHASES.filter(p => p !== 'implementation')) {
      await orch.submitArtifact(taskId, fakeArtifact(phase));
      const cur = await orch.getCurrentInstruction(taskId);
      const text = formatCycleResponse(cur.instruction);
      assert.equal(countOccurrences(text, 'Gate-ID:'), 1, `${phase}: Gate-ID count`);
      assert.equal(countOccurrences(text, '## 🚦 Reflection Gate'), 1, `${phase}: gate section count`);
      assert.equal((await reflect(orch, taskId)).success, true);
    }
  });

  it('hint generator never emits the error banner without a source', () => {
    for (const count of [0, 3, 50, 10_000]) {
      const hints = generateIntelligentHints({ recentErrors: [{ category: 'runtime', count }], phase: 'implementation' });
      assert.ok(!hints.some(h => /errors increasing/i.test(h)), `count ${count}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// Hygiene and documentation
// ═══════════════════════════════════════════════════════════════════

describe('[HYG-1] non-Latin descriptions give distinct non-empty slugs', () => {
  it('Cyrillic, CJK, emoji and punctuation-only descriptions → distinct ids, slugs and artifact folders', async () => {
    await withProject('hyg1-', async dir => {
      const orch = new CycleOrchestrator();
      const descs = ['Исправить баг', 'Добавить тест', '修复错误', '添加测试', '🔥🔥', '!!! ???'];
      const readable = ['исправить-баг', 'добавить-тест', '修复错误', '添加测试', null, null];
      const ids = [];
      const slugs = [];
      for (const [i, d] of descs.entries()) {
        const { taskId } = await orch.startCycle(d);
        const st = await orch.getState(taskId);
        const suffix = taskId.slice(-6);
        if (readable[i]) assert.equal(st.taskSlug, `${readable[i]}-${suffix}`, 'letters of any script stay in the slug');
        else assert.match(st.taskSlug, new RegExp(`^[0-9a-f]{8}-${suffix}$`), 'no letters → hash slug');
        assert.doesNotMatch(taskId, /^cycle__/);
        assert.match(taskId, /^cycle_[a-z0-9-]+_[0-9a-f]{6}$/);
        assert.ok(st.taskSlug.length > 0, `empty slug for ${JSON.stringify(d)}`);
        assert.doesNotMatch(st.taskSlug, /^-|-$|[/\\]/);
        assert.equal((await orch.submitArtifact(taskId, fakeArtifact('intake', d[0]))).success, true);
        await access(path.join(dir, 'm7-cycles', st.taskSlug, 'INTAKE.md'));
        ids.push(taskId);
        slugs.push(st.taskSlug);
      }
      assert.equal(new Set(ids).size, descs.length);
      assert.equal(new Set(slugs).size, descs.length);
      await assert.rejects(access(path.join(dir, 'm7-cycles', 'INTAKE.md')), 'no artifact at the m7-cycles root');
    });
  });

  it('the same description twice still yields two different ids', async () => {
    const orch = new CycleOrchestrator();
    const a = await orch.startCycle('Исправить баг');
    const b = await orch.startCycle('Исправить баг');
    assert.notEqual(a.taskId, b.taskId);
  });
});

describe('[HYG-2] hive cache keys keep non-Latin text and word order', () => {
  const hash = text => new TaskResultCache().hashTask(text);

  it("hashTask('Исправить баг') !== hashTask('Добавить тест')", () => {
    assert.notEqual(hash('Исправить баг'), hash('Добавить тест'));
  });

  it("hashTask('move A to B') !== hashTask('move B to A')", () => {
    assert.notEqual(hash('move A to B'), hash('move B to A'));
  });

  it('case and punctuation still normalize to one key (positive control)', () => {
    assert.equal(hash('Исправить  баг!'), hash('исправить баг'));
    assert.equal(hash('Move A to B.'), hash('move a to b'));
  });

  it('cache returns the right entry for each non-Latin task', () => {
    const cache = new TaskResultCache({ similarityThreshold: 1.1 });
    cache.set('Исправить баг', 'coder', 'fix', true, 1);
    cache.set('Добавить тест', 'coder', 'test', true, 1);
    assert.equal(cache.get('Исправить баг')?.result, 'fix');
    assert.equal(cache.get('Добавить тест')?.result, 'test');
  });
});

describe('[HYG-3] grep runs without a shell', () => {
  it('project path containing a space and a double quote is searched correctly', async () => {
    await withProject('hyg3 base ', async dir => {
      const sub = path.join(dir, 'with space "and quote"');
      await mkdir(sub, { recursive: true });
      await writeFile(path.join(sub, 'needle.ts'), 'export const HYG3_NEEDLE_TOKEN = 1;\n');
      const hits = await grepForKeywordTestHarness(sub, 'HYG3_NEEDLE_TOKEN', { includeExtensions: ['.ts'], excludePatterns: [] });
      assert.equal(hits.length, 1);
      assert.ok(hits[0].path.endsWith('needle.ts'));
    });
  });

  it('a keyword that looks like a grep option is searched as text', async () => {
    await withProject('hyg3-dash-', async dir => {
      await writeFile(path.join(dir, 'flags.ts'), 'const usage = "--include-everything";\n');
      const hits = await grepForKeywordTestHarness(dir, '--include-everything', { includeExtensions: ['.ts'], excludePatterns: [] });
      assert.equal(hits.length, 1);
    });
  });

  it('shell metacharacters in the keyword are inert', async () => {
    await withProject('hyg3-meta-', async dir => {
      const hits = await grepForKeywordTestHarness(dir, 'x";touch PWNED_HYG3;"', { includeExtensions: ['.ts'], excludePatterns: [] });
      assert.deepEqual(hits, []);
      await assert.rejects(access(path.join(dir, 'PWNED_HYG3')));
    });
  });
});

describe('[HYG-4] no API key material in any output', () => {
  it('test tool source and build output are gone', async () => {
    await assert.rejects(access(path.join(ROOT, 'src', 'test-tool.ts')));
    await assert.rejects(access(path.join(ROOT, 'dist', 'test-tool.js')));
  });

  it('no source file slices an API key into a string', async () => {
    const { stdout } = await execFileAsync('grep', [
      '-rnE', '--include=*.ts',
      '(api[Kk]ey|[a-z]+Key|_API_KEY)[^;]*\\.(substring|substr|slice)\\(',
      path.join(ROOT, 'src'),
    ]).catch(err => (err.code === 1 ? { stdout: '' } : Promise.reject(err)));
    const offenders = stdout.split('\n').filter(Boolean).filter(l => !/contextKeys|keywords?\b/.test(l));
    assert.deepEqual(offenders, []);
  });
});

describe('[HYG-5] README describes re-injection by mcp_m7_cycle calls', () => {
  it('README no longer says "after N tool calls" and names mcp_m7_cycle', async () => {
    const readme = await readFile(path.join(ROOT, 'README.md'), 'utf8');
    assert.doesNotMatch(readme, /after N tool calls/i);
    assert.match(readme, /after N calls to `mcp_m7_cycle` within the\s+same phase/);
    const envRow = readme.split('\n').find(l => l.includes('M7_RULE_REINJECTION_THRESHOLD'));
    assert.ok(envRow, 'env table row expected');
    assert.match(envRow, /`mcp_m7_cycle` calls in the same phase/);
    assert.ok(!readme.includes('\\`'), 'escaped backticks render literally in Markdown');
  });
});

describe('[HYG-6] M7CodeInterceptor is removed and tsc passes', () => {
  it('file is gone and nothing in src references it', async () => {
    await assert.rejects(access(path.join(ROOT, 'src', 'core', 'enforcement', 'codeInterceptor.ts')));
    const { stdout } = await execFileAsync('grep', ['-rln', 'M7CodeInterceptor', path.join(ROOT, 'src')])
      .catch(err => (err.code === 1 ? { stdout: '' } : Promise.reject(err)));
    assert.equal(stdout.trim(), '');
  });

  it('tsc --noEmit passes', { timeout: 120_000 }, async () => {
    const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
    await execFileAsync(process.execPath, [tsc, '--noEmit', '-p', path.join(ROOT, 'tsconfig.json')], { cwd: ROOT });
  });
});

describe('[HYG-7] architecture context ripgrep runs without a shell and terminates', () => {
  const PAYLOAD = 'Fix handler `zzq";id>PWNED_HYG7;echo"` in module';

  it('ripgrep argv keeps the keyword as one argument and searches an explicit path', () => {
    const kw = 'a";id>x;"';
    const args = buildRipgrepArgs(kw);
    assert.equal(args[args.indexOf('-e') + 1], kw);
    assert.ok(args.includes('--fixed-strings'));
    assert.deepEqual(args.slice(-2), ['--', '.']);
  });

  it('injection payload with no rg on PATH creates nothing', async () => {
    const dir = await makeProject('hyg7-inj-');
    try {
      const script = `
        const { getArchitectureContextAnalyzer } = await import(${JSON.stringify(path.join(ROOT, 'dist/core/architecture/architecture-context-analyzer.js'))});
        const r = await getArchitectureContextAnalyzer().analyze(${JSON.stringify(PAYLOAD)}, process.env.CURSOR_WORKSPACE);
        console.log(JSON.stringify(r.keywords));
      `;
      const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: dir,
        env: isolatedEnv(dir, { PATH: '/usr/bin:/bin' }),
        timeout: 30_000,
      });
      assert.ok(JSON.parse(stdout.trim().split('\n').pop()).some(k => k.includes('PWNED_HYG7')), 'payload must reach the search');
      await assert.rejects(access(path.join(dir, 'PWNED_HYG7')));
    } finally {
      await removeProject(dir);
    }
  });

  it('with rg available, an existing identifier is found well under the timeout', async t => {
    const hasRg = await execFileAsync('rg', ['--version']).then(() => true, () => false);
    if (!hasRg) {
      t.skip('ripgrep not installed');
      return;
    }
    await withProject('hyg7-find-', async dir => {
      await mkdir(path.join(dir, 'src'), { recursive: true });
      await writeFile(path.join(dir, 'src', 'marker.ts'), 'export const zzqMarkerHyg7 = 1;\n');
      const r = await getArchitectureContextAnalyzer().analyze('Fix `zzqMarkerHyg7` usage', dir);
      assert.ok(r.existingImplementations.length + r.similarPatterns.length > 0 || r.recommendation.suggestedFiles.length > 0,
        JSON.stringify(r));
      assert.ok(r.analysisTimeMs < 1500, `analysis took ${r.analysisTimeMs}ms`);
    });
  });
});

describe('[HYG-9] health check reports ChromaDB offline without starting anything', () => {
  it('offline ChromaDB: no docker attempt, the hint names CHROMA_URL and the local fallback', async () => {
    const { checkSystemHealth, formatHealthStatus, clearHealthCache } = await import('../dist/core/health/index.js');
    const prev = process.env.CHROMA_URL;
    process.env.CHROMA_URL = 'http://127.0.0.1:9';
    try {
      clearHealthCache();
      const health = await checkSystemHealth({ skipCache: true });
      assert.ok(!('dockerStartAttempted' in health));
      const chroma = health.components.find(c => c.name.includes('ChromaDB'));
      assert.equal(chroma.status, 'offline');
      assert.match(chroma.action, /http:\/\/127\.0\.0\.1:9/);
      assert.match(chroma.action, /local JSON/);
      assert.doesNotMatch(formatHealthStatus(health), /docker/i);
    } finally {
      if (prev === undefined) delete process.env.CHROMA_URL;
      else process.env.CHROMA_URL = prev;
      clearHealthCache();
    }
  });

  it('the health module exposes no docker start', async () => {
    const health = await import('../dist/core/health/index.js');
    assert.equal(health.tryStartDocker, undefined);
  });
});

describe('[HYG-10] unreachable modules with already-fixed defects are removed', () => {
  const REMOVED = [
    'core/verification/index',
    'core/verification/symbolVerifier',
    'core/verification/gordianKnotDetector',
    'core/tools/v3/auto-memory-tool',
    'memory/auto/index',
    'memory/auto/project-registry',
    'memory/auto/context-injector',
    'memory/auto/types',
  ];

  it('removed modules are absent from src and dist', async () => {
    for (const m of REMOVED) {
      await assert.rejects(access(path.join(ROOT, 'src', `${m}.ts`)), `src/${m}.ts`);
      await assert.rejects(access(path.join(ROOT, 'dist', `${m}.js`)), `dist/${m}.js`);
    }
  });

  it('memory core has no RAM-only cascade invalidation and no PersistentMemory wrapper', async () => {
    const core = await import('../dist/memory/auto/unified-memory-core.js');
    assert.equal(core.PersistentMemory, undefined);
    assert.equal(core.createPersistentMemory, undefined);
    assert.equal(core.UnifiedMemoryCore.prototype.invalidateDependents, undefined);
    assert.equal(core.UnifiedMemoryCore.prototype.updateWithInvalidation, undefined);
  });

  it('src imports only execFile / execFileSync from child_process and never sets shell: true', async () => {
    const offenders = [];
    const walk = async dir => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(p);
        else if (entry.name.endsWith('.ts')) {
          const rel = path.relative(ROOT, p);
          const text = await readFile(p, 'utf8');
          for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](?:node:)?child_process['"]/g)) {
            const names = m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0]).filter(Boolean);
            for (const n of names) if (!['execFile', 'execFileSync'].includes(n)) offenders.push(`${rel}: ${n}`);
          }
          if (/import\s+\*\s+as\s+\w+\s+from\s*['"](?:node:)?child_process['"]|require\(\s*['"](?:node:)?child_process['"]\s*\)/.test(text)) {
            offenders.push(`${rel}: namespace import`);
          }
          if (/shell\s*:\s*true/.test(text)) offenders.push(`${rel}: shell: true`);
        }
      }
    };
    await walk(path.join(ROOT, 'src'));
    assert.deepEqual(offenders, []);
  });

  it('project scan reads branch and last commit in a repo without an origin remote', async t => {
    const hasGit = await execFileAsync('git', ['--version']).then(() => true, () => false);
    if (!hasGit) {
      t.skip('git not installed');
      return;
    }
    const { DefaultProjectScanner } = await import('../dist/core/tools/projectIndex/projectScanner.js');
    await withProject('hyg10-git-', async dir => {
      const git = args => execFileAsync('git', ['-c', 'user.name=Hyg Ten', '-c', 'user.email=h@example.com', ...args], { cwd: dir });
      await git(['init', '-q', '-b', 'trunk']);
      await git(['add', 'package.json']);
      await git(['commit', '-q', '-m', 'init "quoted" $HOME']);
      const info = await new DefaultProjectScanner().scanGitInfo(dir);
      assert.equal(info.repository, undefined);
      assert.equal(info.branch, 'trunk');
      assert.match(info.lastCommit, /^[0-9a-f]{7,} init "quoted" \$HOME \(Hyg Ten, /);
      assert.deepEqual(info.contributors, ['Hyg Ten']);
    });
  });
});

describe('[HYG-11] no require() in ES modules', () => {
  it('no require() call in any TypeScript source under src/', async () => {
    const { createRequire } = await import('node:module');
    const ts = createRequire(import.meta.url)(path.join(ROOT, 'node_modules', 'typescript'));
    const offenders = [];
    async function walk(dir) {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(p);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
          const sf = ts.createSourceFile(p, await readFile(p, 'utf8'), ts.ScriptTarget.ES2022, true);
          const visit = node => {
            if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require') {
              offenders.push(`${path.relative(ROOT, p)}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
            }
            ts.forEachChild(node, visit);
          };
          visit(sf);
        }
      }
    }
    await walk(path.join(ROOT, 'src'));
    assert.deepEqual(offenders, []);
  });

  it('createTSISystem() returns a TSI system', async () => {
    const { createTSISystem, TSISystem } = await import('../dist/tsi/index.js');
    assert.ok(createTSISystem() instanceof TSISystem);
  });

  it('joining the mesh writes the presence file with this host name; leaving removes it', async () => {
    const { MeshManager } = await import('../dist/mesh/MeshManager.js');
    const { hostname } = await import('node:os');
    const meshDir = await makeProject('hyg11-mesh-');
    const mesh = new MeshManager();
    try {
      mesh.init(meshDir);
      mesh.join('test', SUITE_PROJECT);
      const presenceDir = path.join(meshDir, 'presence');
      const files = (await readdir(presenceDir)).filter(f => f.startsWith('instance_'));
      assert.equal(files.length, 1, 'presence file expected after join');
      const presence = JSON.parse(await readFile(path.join(presenceDir, files[0]), 'utf8'));
      assert.equal(presence.hostname, hostname());
      assert.equal(presence.pid, process.pid);
      mesh.leave();
      assert.deepEqual((await readdir(presenceDir)).filter(f => f.startsWith('instance_')), []);
    } finally {
      mesh.leave();
      await removeProject(meshDir);
    }
  });
});
