import assert from 'node:assert/strict';

const { generateIntelligentHints } = await import('../dist/core/utils/hintGenerator.js');

const hints = generateIntelligentHints({
  recentErrors: [{ category: 'runtime', count: 999 }],
  phase: 'implementation',
});

assert.ok(
  !hints.some(h => h.includes('Runtime errors increasing')),
  'cumulative error counts must not trigger misleading banner (GATE-3)',
);

console.log('All hintGenerator tests passed');
