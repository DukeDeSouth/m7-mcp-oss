/**
 * Epistemic quality metrics tests (Sprint 5)
 * Run: npm run build && node tests/epistemicMetrics.test.mjs
 */
import assert from 'node:assert/strict';

const {
  computeGroundedRatio,
  computeFrontierShrinkMetrics,
  computeHypothesisRefutationRate,
} = await import('../dist/telemetry/epistemicMetrics.js');

console.log('epistemicMetrics tests');

// M1 — grounded ratio: 1 of 2 steps fully grounded
const spec = {
  premises: [
    { id: 'p1', ref: 'mem_a', claim: 'a' },
    { id: 'p2', ref: 'mem_b', claim: 'b' },
  ],
  steps: [
    { id: 's1', description: 'reversible', reversibility: 'reversible', premise_ids: ['p1'] },
    { id: 's2', description: 'deploy', reversibility: 'irreversible', premise_ids: ['p1', 'p2'] },
  ],
};
const resolved = [
  { premiseId: 'p1', ref: 'mem_a', status: 'KNOWN', found: true },
  { premiseId: 'p2', ref: 'mem_b', status: 'ASSUMED', found: true },
];
const g1 = computeGroundedRatio(spec, resolved);
assert.equal(g1.groundedSteps, 1);
assert.equal(g1.totalGroundingSteps, 2);
assert.equal(g1.groundedRatio, 0.5);

// M2 — no spec
const g2 = computeGroundedRatio(null, []);
assert.equal(g2.groundedRatio, null);

// M3 — frontier shrink
const f1 = computeFrontierShrinkMetrics(
  { explored: 1, frontier: 4, unknown: 2 },
  { explored: 2, frontier: 2, unknown: 1 }
);
assert.equal(f1.frontierDelta, 2);
assert.equal(f1.frontierShrinkRate, 0.5);
assert.equal(f1.exploredDelta, 1);

// M4 — no initial snapshot
const f2 = computeFrontierShrinkMetrics(undefined, { explored: 0, frontier: 3, unknown: 1 });
assert.equal(f2.frontierShrinkRate, null);

// M5 — hypothesis refutation via pivot/rewind
const h1 = computeHypothesisRefutationRate([
  { decision: 'continue', changeDetected: false, summary: 'ok', confidence: 1, timestamp: '' },
  { decision: 'pivot', changeDetected: true, summary: 'pivot', confidence: 0.8, timestamp: '' },
  { decision: 'rewind', changeDetected: true, summary: 'rewind', confidence: 0.7, timestamp: '' },
]);
assert.equal(h1.refutationEvents, 2);
assert.equal(h1.totalReflections, 3);
assert.ok(Math.abs(h1.hypothesisRefutationRate - 2 / 3) < 0.001);

// M6 — no reflections
const h2 = computeHypothesisRefutationRate([]);
assert.equal(h2.hypothesisRefutationRate, null);

console.log('✅ epistemicMetrics tests passed');
