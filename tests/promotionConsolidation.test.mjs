/**
 * Promotion consolidation tests (Sprint 6)
 * Run: npm run build && node tests/promotionConsolidation.test.mjs
 */
import assert from 'node:assert/strict';

const {
  makeConsolidatedRecordId,
  buildConsolidationPlaceholder,
  parseConsolidatedContent,
  validateConsolidation,
  requiresConsolidation,
} = await import('../dist/memory/promotionConsolidation.js');

console.log('promotionConsolidation tests');

assert.equal(makeConsolidatedRecordId('mem_abc'), 'mem_abc__cL2');
assert.equal(requiresConsolidation('L1'), false);
assert.equal(requiresConsolidation('L2'), true);

const original = {
  id: 'mem_src',
  level: 'L1',
  content: 'A'.repeat(200),
  confidence: 0.9,
  source: 'runtime',
  needsConsolidation: false,
};

const pending = {
  id: 'mem_src__cL2',
  level: 'L2',
  content: buildConsolidationPlaceholder('mem_src', original.content),
  confidence: 0.9,
  source: 'runtime',
  needsConsolidation: true,
  consolidatedFrom: 'mem_src',
};

const validContent = [
  '## Decision Rationale',
  'Shorter summary of why this pattern matters for the project.',
  '',
  '## Citations',
  '- mem_src',
].join('\n');

const parsed = parseConsolidatedContent(validContent);
assert.ok(parsed);
assert.equal(parsed.citationIds[0], 'mem_src');
assert.ok(parsed.rationale.length >= 10);

const ok = validateConsolidation(original, pending, validContent, (id) => id === 'mem_src');
assert.equal(ok.valid, true, ok.errors?.join('; '));

const tooLong = validateConsolidation(
  original,
  pending,
  original.content,
  (id) => id === 'mem_src'
);
assert.equal(tooLong.valid, false);

const badCite = validateConsolidation(
  original,
  pending,
  validContent.replace('mem_src', 'mem_missing'),
  () => false
);
assert.equal(badCite.valid, false);

console.log('✅ promotionConsolidation tests passed');
