/**
 * TaskOrchestrator — session completion guard (STATE-2)
 * Run via: npm test (imports from dist/)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

process.env.CURSOR_WORKSPACE = process.env.CURSOR_WORKSPACE || new URL('..', import.meta.url).pathname;

const { TaskOrchestrator } = await import('../dist/core/orchestrator/taskOrchestrator.js');

const journalStub = {
  logFeature: async () => 'test-feature-id',
};

const VALIDATION_KEYS = [
  'playwright_validation_passed',
  'success_metrics_measured',
  'documentation_updated',
];

const IMPL_KEYS = [
  'code_quality_verified',
  'tests_passing',
  'performance_benchmarks_met',
];

describe('TaskOrchestrator completeSession guard (STATE-2)', () => {
  it('fresh session → completeSession refused, phase unchanged', async () => {
    const orch = new TaskOrchestrator(journalStub);
    const session = await orch.startTask('STATE-2 refuse early complete', 'light');

    const ok = await orch.completeSession(session.id);
    assert.equal(ok, false);

    const after = orch.getSessionStatus(session.id);
    assert.ok(after);
    assert.notEqual(after.currentPhase, 'completed');
    assert.match(after.lastError, /validation|phase/i);
  });

  it('force: true → completed with forcedCompletion recorded', async () => {
    const orch = new TaskOrchestrator(journalStub);
    const session = await orch.startTask('STATE-2 force complete', 'light');

    const ok = await orch.completeSession(session.id, 'closed early for test', { force: true });
    assert.equal(ok, true);

    const after = orch.getSessionStatus(session.id);
    assert.equal(after.currentPhase, 'completed');
    assert.ok(after.forcedCompletion?.at);
    assert.equal(after.forcedCompletion.notes, 'closed early for test');
    assert.equal(after.lastError, undefined);
  });

  it('validation phase with all validation reqs → completeSession succeeds', async () => {
    const orch = new TaskOrchestrator(journalStub);
    const session = await orch.startTask('STATE-2 legal validation complete', 'light');
    const live = orch.getSessionStatus(session.id);
    assert.ok(live);

    live.currentPhase = 'validation';
    live.phaseTimestamps.validation = new Date();
    for (const key of VALIDATION_KEYS) {
      live.phaseRequirements[key] = true;
    }

    const ok = await orch.completeSession(session.id);
    assert.equal(ok, true);

    const after = orch.getSessionStatus(session.id);
    assert.equal(after.currentPhase, 'completed');
    assert.equal(after.forcedCompletion, undefined);
  });

  it('implementation reqs must be met before advancing to validation', async () => {
    const orch = new TaskOrchestrator(journalStub);
    const session = await orch.startTask('STATE-2 impl transition cap', 'light');
    const live = orch.getSessionStatus(session.id);
    assert.ok(live);

    live.currentPhase = 'implementation';
    live.phaseTimestamps.implementation = new Date();

    await orch.markRequirementComplete(session.id, IMPL_KEYS[0]);
    assert.equal(orch.getSessionStatus(session.id).currentPhase, 'implementation');

    for (const key of IMPL_KEYS.slice(1)) {
      await orch.markRequirementComplete(session.id, key);
    }
    assert.equal(orch.getSessionStatus(session.id).currentPhase, 'validation');
    assert.notEqual(orch.getSessionStatus(session.id).currentPhase, 'completed');
  });

  it('validation phase with partial reqs → refused with pending keys in lastError', async () => {
    const orch = new TaskOrchestrator(journalStub);
    const session = await orch.startTask('STATE-2 partial validation', 'light');
    const live = orch.getSessionStatus(session.id);
    assert.ok(live);

    live.currentPhase = 'validation';
    live.phaseRequirements[VALIDATION_KEYS[0]] = true;

    const ok = await orch.completeSession(session.id);
    assert.equal(ok, false);
    const after = orch.getSessionStatus(session.id);
    assert.match(after.lastError, /Validation requirements incomplete/i);
    assert.match(after.lastError, /success_metrics_measured/);
    assert.equal(after.currentPhase, 'validation');
  });

  it('second completeSession on completed session → false', async () => {
    const orch = new TaskOrchestrator(journalStub);
    const session = await orch.startTask('STATE-2 double complete', 'light');
    assert.equal(await orch.completeSession(session.id, undefined, { force: true }), true);

    const ok = await orch.completeSession(session.id);
    assert.equal(ok, false);
    assert.match(orch.getSessionStatus(session.id).lastError, /already completed/i);
  });

  it('all validation reqs via mark_complete does not auto-finish session', async () => {
    const orch = new TaskOrchestrator(journalStub);
    const session = await orch.startTask('STATE-2 no auto complete', 'light');
    const live = orch.getSessionStatus(session.id);
    assert.ok(live);

    live.currentPhase = 'validation';
    live.phaseTimestamps.validation = new Date();

    for (const key of VALIDATION_KEYS) {
      await orch.markRequirementComplete(session.id, key);
    }
    assert.equal(orch.getSessionStatus(session.id).currentPhase, 'validation');
  });
});

describe('TaskOrchestrator regressions (STATE-2 + CYC-1 neighbors)', () => {
  it('fresh session: checkCanProceedToCode is false (no vacuous arch/planning complete)', async () => {
    const orch = new TaskOrchestrator(journalStub);
    const session = await orch.startTask('regression canProceed fresh', 'light');

    const check = await orch.checkCanProceedToCode(session.id);
    assert.equal(check.canProceed, false);
    assert.ok(check.blockers.length > 0);
  });

  it('enforceM7Compliance blocks code_change on fresh session', async () => {
    const orch = new TaskOrchestrator(journalStub);
    const session = await orch.startTask('regression enforce fresh', 'light');

    const result = await orch.enforceM7Compliance('code_change', session.id);
    assert.equal(result.allowed, false);
    assert.match(result.reason, /M7|requirement|compliance/i);
  });
});
