/**
 * Fog boundary tests (Sprint 2)
 * Run: npm run build && node tests/fogBoundary.test.mjs
 */
import assert from 'node:assert/strict';

const {
  computeBoundaryStatus,
  normalizeFogEntry,
  getBlockingUnknowns,
  buildFrontierReport,
  summarizeBoundaryCounts,
} = await import('../dist/memory/fogBoundary.js');

function baseEntry(overrides = {}) {
  return {
    id: 'fow_test',
    path: 'src/foo.ts',
    discovery: 'verified auth flow',
    technical_details: {},
    dependencies: [],
    discovered_at: new Date(),
    confidence: 0.9,
    source: 'code_analysis',
    ...overrides,
  };
}

console.log('fogBoundary tests');

// B1 — explored
assert.equal(computeBoundaryStatus(baseEntry()), 'explored');

// B2 — frontier
assert.equal(
  computeBoundaryStatus(baseEntry({ confidence: 0.5, source: 'runtime' })),
  'frontier'
);

// B3 — unknown empty discovery
assert.equal(
  computeBoundaryStatus(baseEntry({ discovery: '   ' })),
  'unknown'
);

// B4 — unknown low conf
assert.equal(
  computeBoundaryStatus(baseEntry({ confidence: 0.1 })),
  'unknown'
);

// B5 — blocking via critical_path
const blockingEntry = normalizeFogEntry(
  baseEntry({
    discovery: '',
    confidence: 0.05,
    technical_details: { critical_path: true },
  })
);
assert.equal(blockingEntry.boundary_status, 'unknown');
assert.equal(blockingEntry.blocking, true);
assert.equal(getBlockingUnknowns([blockingEntry]).length, 1);

// B6 — blocking false opts out
const nonBlocking = normalizeFogEntry(
  baseEntry({
    discovery: '',
    confidence: 0.05,
    technical_details: { critical_path: true },
    blocking: false,
  })
);
assert.equal(getBlockingUnknowns([nonBlocking]).length, 0);

// B7 — backfill boundary_status
const normalized = normalizeFogEntry(baseEntry({ boundary_status: undefined }));
assert.ok(normalized.boundary_status);

// B8 — report counts
const report = buildFrontierReport([
  baseEntry(),
  baseEntry({ path: 'b.ts', confidence: 0.5, source: 'runtime' }),
  baseEntry({ path: 'c.ts', discovery: '', confidence: 0.05 }),
]);
const counts = summarizeBoundaryCounts([
  baseEntry(),
  baseEntry({ path: 'b.ts', confidence: 0.5, source: 'runtime' }),
  baseEntry({ path: 'c.ts', discovery: '', confidence: 0.05 }),
]);
assert.equal(counts.explored, 1);
assert.equal(counts.frontier, 1);
assert.equal(counts.unknown, 1);
assert.ok(report.includes('Fog Frontier Report'));
assert.ok(report.includes('| 1 | 1 | 1 |'));

// B9 — documentation explored
assert.equal(
  computeBoundaryStatus(baseEntry({ source: 'documentation', confidence: 0.85 })),
  'explored'
);

// B10 — human explored
assert.equal(
  computeBoundaryStatus(baseEntry({ source: 'human', confidence: 0.82 })),
  'explored'
);

// B11 — experiment frontier
assert.equal(
  computeBoundaryStatus(baseEntry({ source: 'experiment', confidence: 0.6 })),
  'frontier'
);

// B12 — explored never blocking
assert.equal(getBlockingUnknowns([baseEntry()]).length, 0);

console.log('All fogBoundary tests passed');
