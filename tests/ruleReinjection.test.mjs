/**
 * Rule reinjection tests (Sprint 8)
 * Run: npm run build && node tests/ruleReinjection.test.mjs
 */
import assert from 'node:assert/strict';
import path from 'node:path';

process.env.M7_PROJECT_PATH = path.join(import.meta.dirname, '..');
process.env.M7_RULE_REINJECTION_THRESHOLD = '18';

const {
  appendRuleReinjection,
  buildRuleReinjectionBlock,
  getRuleReinjectionThreshold,
  resetPhaseMcpTracking,
  trackPhaseMcpCall,
} = await import('../dist/core/orchestrator/ruleReinjection.js');
const { getPhaseConfig } = await import('../dist/core/orchestrator/templates/phases.js');

console.log('ruleReinjection tests');

assert.equal(getRuleReinjectionThreshold(), 18);

const baseState = {
  taskId: 'cycle_test',
  taskSlug: 'test',
  taskDescription: 'Test task',
  currentPhase: 'discovery',
  completedPhases: ['intake'],
  artifacts: {},
  startedAt: new Date().toISOString(),
  lastUpdatedAt: new Date().toISOString(),
  phaseAttempts: {},
  awaitingReflection: false,
  taskFraming: 'Test framing',
  reflections: [],
};

resetPhaseMcpTracking(baseState);
for (let i = 1; i < 18; i++) {
  const track = trackPhaseMcpCall(baseState);
  assert.equal(track.shouldReinject, false, `call ${i} should not inject`);
}
const inject = trackPhaseMcpCall(baseState);
assert.equal(inject.shouldReinject, true);
assert.equal(baseState.phaseMcpCallCount, 0);
assert.ok(baseState.lastRuleReinjectionAt);

const block = buildRuleReinjectionBlock(baseState, getPhaseConfig('discovery'));
assert.ok(block.includes('DISCOVERY'));
assert.ok(block.includes('M7 Rule Reinjection'));
assert.ok(!/you may skip|restrictions lifted|continue without m7/i.test(block));

const gateState = {
  ...baseState,
  awaitingReflection: true,
  gateInstructionId: 'gate_test_123',
};
const gateBlock = buildRuleReinjectionBlock(gateState, getPhaseConfig('discovery'));
assert.ok(gateBlock.includes('gate_instruction_id'));
assert.ok(gateBlock.includes('gate_test_123'));

const appended = appendRuleReinjection('hello', block);
assert.ok(appended.includes('hello'));
assert.ok(appended.includes('M7 Rule Reinjection'));
assert.equal(appendRuleReinjection(appended, block), appended, 'no duplicate block');

resetPhaseMcpTracking(baseState);
assert.equal(baseState.phaseMcpCallCount, 0);
assert.equal(baseState.lastRuleReinjectionAt, undefined);

console.log('ruleReinjection tests: OK');
