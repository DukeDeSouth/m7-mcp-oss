/**
 * CYC-9 — cleanupOldCycles preserves active, archives completed
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, access, rm } from 'fs/promises';
import { utimes } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

const PHASES = [
  'intake',
  'discovery',
  'architecture',
  'solution',
  'impact',
  'simulation',
  'implementation',
];

function baseState(overrides) {
  const phaseAttempts = Object.fromEntries(PHASES.map((p) => [p, 0]));
  const shortArtifactAttempts = Object.fromEntries(PHASES.map((p) => [p, 0]));
  const rewindCount = Object.fromEntries(PHASES.map((p) => [p, 0]));
  const artifacts = Object.fromEntries(PHASES.map((p) => [p, null]));
  return {
    taskId: 'cycle_test_active_001',
    taskSlug: 'test-active',
    taskDescription: 'active cycle',
    currentPhase: 'architecture',
    completedPhases: ['intake', 'discovery'],
    artifacts,
    startedAt: new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
    phaseAttempts,
    shortArtifactAttempts,
    rewindCount,
    awaitingReflection: false,
    taskFraming: 'active cycle',
    reflections: [],
    phaseMcpCallCount: 0,
    phaseEnteredAt: new Date().toISOString(),
    projectPath: '',
    ...overrides,
  };
}

function baseStateForDir(dir, overrides = {}) {
  return baseState({ projectPath: dir, ...overrides });
}

describe('CYC-9 cycle cleanup', () => {
  it('old active state survives; old completed moves to archive', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'cyc9-'));
    const prev = {
      M7: process.env.M7_PROJECT_PATH,
      CURSOR: process.env.CURSOR_WORKSPACE,
    };
    process.env.M7_PROJECT_PATH = dir;
    process.env.CURSOR_WORKSPACE = dir;
    const { resetProjectPathStateForTests } = await import(
      '../dist/core/utils/projectPath.js'
    );
    resetProjectPathStateForTests();

    const cyclesDir = path.join(dir, '.m7', 'cycles');
    const oldTime = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);

    try {
      await mkdir(cyclesDir, { recursive: true });
      const activePath = path.join(cyclesDir, 'cycle_test_active_001.json');
      const completedPath = path.join(cyclesDir, 'cycle_test_completed_001.json');

      await writeFile(activePath, JSON.stringify(baseStateForDir(dir, {})), 'utf8');
      await writeFile(
        completedPath,
        JSON.stringify(
          baseStateForDir(dir, {
            taskId: 'cycle_test_completed_001',
            taskSlug: 'test-completed',
            taskDescription: 'done',
            currentPhase: 'implementation',
            completedPhases: [...PHASES],
          })
        ),
        'utf8'
      );
      await utimes(activePath, oldTime, oldTime);
      await utimes(completedPath, oldTime, oldTime);

      const { CycleOrchestrator } = await import(
        '../dist/core/orchestrator/cycleOrchestrator.js'
      );
      const orch = new CycleOrchestrator();
      await orch.startCycle('trigger cleanup for CYC-9 test');

      await access(activePath);
      await access(path.join(cyclesDir, 'archive', 'cycle_test_completed_001.json'));
      try {
        await access(completedPath);
        assert.fail('completed state should be archived');
      } catch {
        /* expected */
      }
    } finally {
      process.env.M7_PROJECT_PATH = prev.M7;
      process.env.CURSOR_WORKSPACE = prev.CURSOR;
      resetProjectPathStateForTests();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
