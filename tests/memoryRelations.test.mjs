/**
 * Memory relation types + conflicts tests (Sprint 4)
 * Run: npm run build && node tests/memoryRelations.test.mjs
 */
import assert from 'node:assert/strict';

const {
  normalizeDependencySpecs,
  applyContradictPenalties,
  getRelationType,
  collectActiveConflicts,
  CONTRADICT_CONFIDENCE_FACTOR,
} = await import('../dist/memory/memoryRelations.js');

const { buildConflictReport } = await import('../dist/memory/memoryConflicts.js');

const {
  parseAdversarialSection,
  generateAdversarialGateExtension,
} = await import('../dist/core/orchestrator/adversarialGate.js');

console.log('memoryRelations tests');

// R1 — normalize specs
const n1 = normalizeDependencySpecs(['mem_a'], [
  { id: 'mem_a', relationType: 'contradicts' },
  { id: 'mem_b', relationType: 'supports' },
]);
assert.deepEqual(n1.deps.sort(), ['mem_a', 'mem_b']);
assert.equal(n1.relations.mem_a, 'contradicts');
assert.equal(n1.relations.mem_b, 'supports');

// R2 — empty specs keeps deps only
const n2 = normalizeDependencySpecs(['mem_x'], undefined);
assert.deepEqual(n2.deps, ['mem_x']);
assert.deepEqual(n2.relations, {});

// R3 — applyContradictPenalties both sides
const recA = {
  id: 'mem_a',
  content: 'a',
  level: 'L1',
  source: 'runtime',
  contextKeys: [],
  confidence: 1.0,
  accessCount: 0,
  createdAt: new Date(),
  metadata: { type: 'runtime', source: '', tags: [], importance: 1 },
};
const recB = { ...recA, id: 'mem_b', content: 'b' };
applyContradictPenalties(recA, recB);
assert.equal(recA.confidence, CONTRADICT_CONFIDENCE_FACTOR);
assert.equal(recB.confidence, CONTRADICT_CONFIDENCE_FACTOR);
assert.equal(recA.lastValidated, 0);
assert.equal(recB.lastValidated, 0);

// R4 — getRelationType
const recRel = {
  ...recA,
  confidence: 0.8,
  dependencyRelations: { mem_b: 'refines' },
  dependencies: ['mem_b'],
};
assert.equal(getRelationType(recRel, 'mem_b'), 'refines');
assert.equal(getRelationType(recRel, 'missing'), undefined);

// R5 — collectActiveConflicts dedupes
const conflicts = collectActiveConflicts([
  {
    ...recA,
    id: 'mem_1',
    dependencyRelations: { mem_2: 'contradicts' },
    dependencies: ['mem_2'],
  },
  {
    ...recA,
    id: 'mem_3',
    dependencyRelations: { mem_2: 'contradicts' },
    dependencies: ['mem_2'],
  },
]);
assert.equal(conflicts.length, 2);

// R6 — buildConflictReport
const report = buildConflictReport(
  [{ id: 'c1', recordA: 'mem_1', recordB: 'mem_2', detectedAt: '', confidenceA: 0.6, confidenceB: 0.6 }],
  (id) => (id === 'mem_1' ? recA : id === 'mem_2' ? recB : null)
);
assert.ok(report.includes('Memory Conflicts'));
assert.ok(report.includes('mem_1'));
assert.ok(report.includes('mem_2'));

// R7 — integration: store with contradicts downgrades both
const { getMemoryCore } = await import('../dist/memory/auto/unified-memory-core.js');
const memCore = await getMemoryCore();
const base = await memCore.store('base fact', {
  level: 'L1',
  source: 'documentation',
  confidence: 0.9,
});
const contra = await memCore.store('opposite fact', {
  level: 'L1',
  source: 'runtime',
  confidence: 0.9,
  dependencySpecs: [{ id: base.id, relationType: 'contradicts' }],
});
const baseAfter = await memCore.get(base.id);
assert.ok(baseAfter);
assert.ok(contra.confidence <= 0.9 * CONTRADICT_CONFIDENCE_FACTOR + 0.001);
assert.ok(baseAfter.confidence <= 0.9 * CONTRADICT_CONFIDENCE_FACTOR + 0.001);
assert.ok(memCore.getActiveConflicts().length >= 1);

// R8 — store without relations unchanged confidence
const plain = await memCore.store('plain', { level: 'L0', confidence: 0.75 });
assert.equal(plain.confidence, 0.75);

// A1 — adversarial parse missing
const missing = parseAdversarialSection('# Solution\n\nno adversarial');
assert.equal(missing.present, false);
assert.ok(generateAdversarialGateExtension('').includes('Incomplete'));

// A2 — adversarial parse complete
const full = `## Adversarial Review
1. Counter-arguments: plan assumes wrong root cause
2. Rebuttal: verified with logs
3. Reframaming check: none — no reframing`;
const parsed = parseAdversarialSection(full);
assert.equal(parsed.present, true);
assert.ok(parsed.hasCounterArgs);
assert.ok(parsed.hasRebuttal);
assert.ok(generateAdversarialGateExtension(full).includes('strongest counter-argument'));

console.log('✅ memoryRelations tests passed');
