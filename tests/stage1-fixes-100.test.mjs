/**
 * Stage 1 KNOWN_ISSUES fixes — 100 diverse regression cases
 * CYC-1 · STATE-2 · STATE-1 · MEM-3
 *
 * Run: npm run build && node --test --test-force-exit tests/stage1-fixes-100.test.mjs
 */

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile, rm, chmod } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

const PROJECT = await mkdtemp(path.join(tmpdir(), 'm7-stage1-'));
process.env.M7_PROJECT_PATH = PROJECT;
process.env.CURSOR_WORKSPACE = PROJECT;
const { resetProjectPathStateForTests } = await import('../dist/core/utils/projectPath.js');
resetProjectPathStateForTests();
after(async () => {
  await rm(PROJECT, { recursive: true, force: true }).catch(() => {});
});

const { CycleOrchestrator } = await import('../dist/core/orchestrator/cycleOrchestrator.js');
const { TaskOrchestrator } = await import('../dist/core/orchestrator/taskOrchestrator.js');
const { StatePersistError } = await import('../dist/core/errors/statePersist.js');
const { safeReadJSON, atomicWriteJSON } = await import('../dist/core/utils/atomicWrite.js');
const { extractGateInstructionId } = await import('../dist/core/orchestrator/controlChannel.js');
const {
  flushAllWithTimeout,
  registerShutdownContributor,
  SHUTDOWN_FLUSH_TIMEOUT_MS,
} = await import('../dist/core/shutdown/flushOnExit.js');
const { resetMemoryCore, getMemoryCore } = await import('../dist/memory/auto/unified-memory-core.js');

const journalStub = { logFeature: async () => 'feat-id' };

const VALIDATION_KEYS = [
  'playwright_validation_passed',
  'success_metrics_measured',
  'documentation_updated',
];

function fakeArtifact(length = 220) {
  return `# INTAKE: matrix\n\n${'x'.repeat(length)}`;
}

function gateIdFromResponse(response) {
  const text = [
    response?.instruction?.instruction,
    response?.instruction?.gate?.prompt,
    response?.instruction?.artifact?.template,
  ]
    .filter(Boolean)
    .join('\n');
  return extractGateInstructionId(text);
}

async function cycleAtIntakeGate() {
  const orch = new CycleOrchestrator();
  const start = await orch.startCycle(`Stage1 matrix ${Date.now()}-${Math.random()}`);
  await orch.submitArtifact(start.taskId, fakeArtifact());
  const gate = await orch.getCurrentInstruction(start.taskId);
  const gateId = gateIdFromResponse(gate);
  assert.ok(gateId);
  return { orch, taskId: start.taskId, gateId };
}

// ─── CYC-1: 30 invalid reflection payloads ───────────────────────────

const CYC1_INVALID = [
  ['plain prose', () => 'Just continue please'],
  ['empty fence', () => '```\n```'],
  ['json array root', (g) => `\`\`\`json\n[1,2]\n\`\`\``],
  ['decision proceed', (g) => `\`\`\`json\n{"decision":"proceed","summary":"x","gate_instruction_id":"${g}"}\n\`\`\``],
  ['decision skip', (g) => `\`\`\`json\n{"decision":"skip","summary":"x","gate_instruction_id":"${g}"}\n\`\`\``],
  ['decision number', (g) => `\`\`\`json\n{"decision":1,"summary":"x","gate_instruction_id":"${g}"}\n\`\`\``],
  ['decision null', (g) => `\`\`\`json\n{"decision":null,"summary":"x","gate_instruction_id":"${g}"}\n\`\`\``],
  ['missing decision', (g) => `\`\`\`json\n{"summary":"x","gate_instruction_id":"${g}"}\n\`\`\``],
  ['decision cyrillic homoglyph', (g) => `\`\`\`json\n{"decision":"cоntinue","summary":"s","gate_instruction_id":"${g}"}\n\`\`\``],
  ['empty decision string', (g) => `\`\`\`json\n{"decision":"","summary":"x","gate_instruction_id":"${g}"}\n\`\`\``],
  ['decision undefined literal', (g) => `\`\`\`json\n{"decision":"undefined","summary":"x","gate_instruction_id":"${g}"}\n\`\`\``],
  ['json string not object', (g) => `\`\`\`json\n"continue"\n\`\`\``],
  ['truncated json', (g) => `\`\`\`json\n{"decision":"continue"\n\`\`\``],
  ['extra comma json', (g) => `\`\`\`json\n{"decision":"continue",, "summary":"s","gate_instruction_id":"${g}"}\n\`\`\``],
  ['wrong gate id', (g) => `\`\`\`json\n{"decision":"continue","summary":"s","gate_instruction_id":"gate_fake_000"}\n\`\`\``],
  ['missing gate id', (g) => `\`\`\`json\n{"decision":"continue","summary":"s"}\n\`\`\``],
  ['gate id number', (g) => `\`\`\`json\n{"decision":"continue","summary":"s","gate_instruction_id":12345}\n\`\`\``],
  ['decision typo continu', (g) => `\`\`\`json\n{"decision":"continu","summary":"s","gate_instruction_id":"${g}"}\n\`\`\``],
  ['yaml not json', (g) => `decision: continue\nsummary: hi`],
  ['html wrapper', (g) => `<p>${JSON.stringify({ decision: 'continue', summary: 's', gate_instruction_id: g })}</p>`],
  ['nested decision object', (g) => `\`\`\`json\n{"decision":{"v":"continue"},"summary":"s","gate_instruction_id":"${g}"}\n\`\`\``],
  ['decision array', (g) => `\`\`\`json\n{"decision":["continue"],"summary":"s","gate_instruction_id":"${g}"}\n\`\`\``],
  ['only whitespace', () => '   \n\t  '],
  ['json null', () => '```json\nnull\n```'],
  ['decision true bool', (g) => `\`\`\`json\n{"decision":true,"summary":"s","gate_instruction_id":"${g}"}\n\`\`\``],
  ['decision false bool', (g) => `\`\`\`json\n{"decision":false,"summary":"s","gate_instruction_id":"${g}"}\n\`\`\``],
  ['decision pivot typo', (g) => `\`\`\`json\n{"decision":"pivott","summary":"s","gate_instruction_id":"${g}"}\n\`\`\``],
  ['abort as number', (g) => `\`\`\`json\n{"decision":0,"summary":"s","gate_instruction_id":"${g}"}\n\`\`\``],
  ['unicode decision', (g) => `\`\`\`json\n{"decision":"продолжить","summary":"s","gate_instruction_id":"${g}"}\n\`\`\``],
  ['gate id empty string', (g) => `\`\`\`json\n{"decision":"continue","summary":"s","gate_instruction_id":""}\n\`\`\``],
];

describe('Stage-1 matrix (100 cases)', () => {
  for (const [label, build] of CYC1_INVALID) {
    it(`CYC-1 #${label} → rejected`, async () => {
      const { orch, taskId, gateId } = await cycleAtIntakeGate();
      const content = build(gateId);
      const result = await orch.submitReflection(taskId, content);
      assert.equal(result.success, false, 'must not accept invalid reflection');
      assert.match(String(result.error), /reflection|decision|gate|json|parse/i);
      const after = await orch.getCurrentInstruction(taskId);
      assert.ok(gateIdFromResponse(after), 'still at gate');
    });
  }

  // ─── STATE-2: 22 session completion variants ─────────────────────

  const STATE2_CASES = [];
  for (let mask = 0; mask < 8; mask++) {
    STATE2_CASES.push({
      name: `validation mask ${mask.toString(2).padStart(3, '0')}`,
      mask,
    });
  }
  for (const phase of ['discovery', 'architecture', 'planning', 'implementation']) {
    STATE2_CASES.push({ name: `complete from ${phase}`, phase });
  }
  for (let i = 0; i < 11; i++) {
    STATE2_CASES.push({ name: `force note variant ${i}`, forceIdx: i });
  }

  let s2 = 0;
  for (const c of STATE2_CASES) {
    if (s2 >= 22) break;
    s2++;
    it(`STATE-2 #${c.name}`, async () => {
      const orch = new TaskOrchestrator(journalStub);
      const session = await orch.startTask(`S2 ${c.name}`, 'light');
      const live = orch.getSessionStatus(session.id);
      assert.ok(live);

      if (c.mask !== undefined) {
        live.currentPhase = 'validation';
        for (let b = 0; b < 3; b++) {
          live.phaseRequirements[VALIDATION_KEYS[b]] = (c.mask & (1 << b)) !== 0;
        }
        const ok = await orch.completeSession(session.id);
        const allSet = c.mask === 7;
        assert.equal(ok, allSet);
        if (!allSet) {
          assert.notEqual(orch.getSessionStatus(session.id).currentPhase, 'completed');
        }
        return;
      }

      if (c.phase) {
        live.currentPhase = c.phase;
        assert.equal(await orch.completeSession(session.id), false);
        assert.notEqual(orch.getSessionStatus(session.id).currentPhase, 'completed');
        return;
      }

      const note = `forced-${c.forceIdx}-${'n'.repeat(c.forceIdx)}`;
      assert.equal(await orch.completeSession(session.id, note, { force: true }), true);
      const done = orch.getSessionStatus(session.id);
      assert.equal(done.currentPhase, 'completed');
      assert.equal(done.forcedCompletion.notes, note);
    });
  }

  // ─── STATE-1 safeReadJSON: 28 corrupt-main + backup ──────────────

  /** Must fail JSON.parse on main file so backup path is exercised */
  const CORRUPT_BODIES = [
    '',
    '{',
    '{]',
    '{"a":',
    'not json at all',
    '{"valid": true',
    '\x00\x01binary',
    '{ "unclosed": "quote}',
    '{ "x": NaN }',
    '{ "key": value }',
    '{ "arr": [1,2,3',
    '{ "depth": { "a": { "b": { "c": 1 } } }',
    '{ "x": 1 }; alert(1)',
    '{{{{',
    '}]',
    '{"trailing":',
    'bareword',
    '{,}',
    '{"a":1,,}',
    '```json',
    '<xml>bad</xml>',
    'function(){}',
    '{ "bad\\u": "\\u" }',
    '{ "line": "broken\\',
    '{\n"unterminated": "\n',
    '{ "comma": , "x": 1 }',
    '{ "tab": \t broken }',
    'NOT{json',
    '["unclosed"',
  ];

  for (let i = 0; i < CORRUPT_BODIES.length; i++) {
    const body = CORRUPT_BODIES[i];
    it(`STATE-1 safeReadJSON corrupt #${i} recovers backup`, async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'm7-s1-'));
      const filePath = path.join(dir, 'data.json');
      const payload = { recovered: true, idx: i };
      try {
        await atomicWriteJSON(filePath, payload, { maxBackups: 3 });
        await atomicWriteJSON(filePath, { ...payload, pass: 2 }, { maxBackups: 3 });
        await writeFile(filePath, body, 'utf8');
        const result = await safeReadJSON(filePath);
        assert.ok(result.data, 'must load from backup');
        assert.equal(result.data.idx, i);
        assert.ok(result.recoveredFrom, 'must set recoveredFrom');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  }

  // ─── STATE-1: 5 persist / error contract ─────────────────────────

  it('STATE-1 StatePersistError code', () => {
    const e = new StatePersistError('/p/x.json', 'disk full');
    assert.equal(e.code, 'STATE_PERSIST_FAILED');
    assert.match(e.message, /disk full/);
  });

  for (let n = 1; n <= 4; n++) {
    it(`STATE-1 persist error message shape #${n}`, () => {
      const e = new StatePersistError(`.m7/cycles/t${n}.json`, `reason-${n}`);
      assert.match(e.message, new RegExp(`t${n}\\.json`));
      assert.match(e.message, new RegExp(`reason-${n}`));
    });
  }

  // ─── MEM-3: 15 flush / shutdown variants ─────────────────────────

  for (const level of ['L2', 'L3']) {
    it(`MEM-3 flush persists ${level} before debounce`, async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'm7-m3-'));
      const prev = process.env.M7_PROJECT_PATH;
      process.env.M7_PROJECT_PATH = dir;
      try {
        resetMemoryCore();
        const core = await getMemoryCore(dir);
        const record = await core.store(`${level} payload ${'y'.repeat(90)}`, {
          level,
          source: 'matrix',
        });
        assert.equal(await flushAllWithTimeout(), 'done');
        const file =
          level === 'L2'
            ? path.join(dir, '.m7/memory/longterm.json')
            : path.join(dir, '.m7/memory/conceptual.json');
        const raw = JSON.parse(await readFile(file, 'utf8'));
        assert.ok(raw[record.id]);
      } finally {
        process.env.M7_PROJECT_PATH = prev;
        await rm(dir, { recursive: true, force: true });
      }
    });
  }

  for (let batch = 2; batch <= 6; batch++) {
    it(`MEM-3 flush ${batch} pending L2 writes`, async () => {
      const dir = await mkdtemp(path.join(tmpdir(), 'm7-m3-'));
      const prev = process.env.M7_PROJECT_PATH;
      process.env.M7_PROJECT_PATH = dir;
      try {
        resetMemoryCore();
        const core = await getMemoryCore(dir);
        const ids = [];
        for (let j = 0; j < batch; j++) {
          const r = await core.store(`batch ${batch}-${j} ${'z'.repeat(80)}`, {
            level: 'L2',
            source: 'matrix',
          });
          ids.push(r.id);
        }
        await flushAllWithTimeout();
        const raw = JSON.parse(
          await readFile(path.join(dir, '.m7/memory/longterm.json'), 'utf8')
        );
        for (const id of ids) {
          assert.ok(raw[id], `missing ${id}`);
        }
      } finally {
        process.env.M7_PROJECT_PATH = prev;
        await rm(dir, { recursive: true, force: true });
      }
    });
  }

  it('MEM-3 shutdownMemoryCore noop when never initialized', async () => {
    resetMemoryCore();
    const { shutdownMemoryCore } = await import('../dist/memory/auto/unified-memory-core.js');
    await shutdownMemoryCore();
  });

  it('MEM-3 journal contributor runs with flushAll', async () => {
    let called = false;
    registerShutdownContributor(async () => {
      called = true;
    });
    await flushAllWithTimeout();
    assert.equal(called, true);
  });

  it('MEM-3 SHUTDOWN_FLUSH_TIMEOUT_MS is 2000', () => {
    assert.equal(SHUTDOWN_FLUSH_TIMEOUT_MS, 2000);
  });

  it('MEM-3 flushAllWithTimeout completes under timeout', async () => {
    const t0 = Date.now();
    const r = await flushAllWithTimeout();
    assert.ok(r === 'done' || r === 'timeout');
    assert.ok(Date.now() - t0 < SHUTDOWN_FLUSH_TIMEOUT_MS + 500);
  });

  it('STATE-1 chmod cycles dir blocks artifact persist', async () => {
    if (process.platform === 'win32') return;
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('STATE-1 matrix chmod');
    const cyclesPath = path.join(process.env.M7_PROJECT_PATH, '.m7', 'cycles');
    await mkdir(cyclesPath, { recursive: true });
    const before = start.progress.completed;
    await chmod(cyclesPath, 0o500);
    try {
      const result = await orch.submitArtifact(start.taskId, fakeArtifact());
      assert.equal(result.success, false);
      assert.match(result.error, /State not persisted/i);
      const onDisk = JSON.parse(
        await readFile(path.join(cyclesPath, `${start.taskId}.json`), 'utf8')
      );
      assert.equal(onDisk.completedPhases.length, before);
    } finally {
      await chmod(cyclesPath, 0o755);
    }
  });

  it('STATE-2 force note variant 10', async () => {
    const orch = new TaskOrchestrator(journalStub);
    const session = await orch.startTask('S2 force 10', 'light');
    const note = 'forced-10-' + 'n'.repeat(10);
    assert.equal(await orch.completeSession(session.id, note, { force: true }), true);
    const done = orch.getSessionStatus(session.id);
    assert.equal(done.currentPhase, 'completed');
    assert.equal(done.forcedCompletion.notes, note);
  });

  it('CYC-1 valid continue after reject same gate', async () => {
    const { orch, taskId, gateId } = await cycleAtIntakeGate();
    assert.equal((await orch.submitReflection(taskId, 'not json')).success, false);
    const ok = await orch.submitReflection(
      taskId,
      `\`\`\`json\n{"decision":"continue","summary":"ok after reject","gate_instruction_id":"${gateId}","confidence":0.9}\n\`\`\``
    );
    assert.equal(ok.success, true);
  });
});
