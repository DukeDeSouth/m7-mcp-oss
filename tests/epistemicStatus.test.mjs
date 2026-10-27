/**
 * Epistemic status view-layer tests (Sprint 1)
 * Run: npm run build && node tests/epistemicStatus.test.mjs
 */
import assert from 'node:assert/strict';

const {
  getEpistemicStatus,
  getEffectiveConfidence,
  EPISTEMIC_KNOWN_THRESHOLD,
  EPISTEMIC_MIN_EFFECTIVE,
} = await import('../dist/memory/auto/unified-memory-core.js');

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

function baseRecord(overrides = {}) {
  const { metadata: metaOverrides, ...rest } = overrides;
  return {
    id: 'mem_test',
    content: 'verified fact about auth module',
    level: 'L1',
    source: 'code_analysis',
    contextKeys: [],
    confidence: 0.9,
    accessCount: 0,
    createdAt: new Date(NOW),
    metadata: {
      type: 'code_analysis',
      source: '',
      tags: [],
      importance: 0.9,
      ...metaOverrides,
    },
    ...rest,
  };
}

console.log('epistemicStatus tests');

// T1 — KNOWN
assert.equal(getEpistemicStatus(baseRecord(), NOW), 'KNOWN');

// T2 — ASSUMED (runtime, medium confidence)
assert.equal(
  getEpistemicStatus(baseRecord({ source: 'runtime', confidence: 0.62 }), NOW),
  'ASSUMED'
);

// T3 — runtime-guess blocks KNOWN
assert.equal(
  getEpistemicStatus(
    baseRecord({
      confidence: 0.9,
      metadata: { type: 'code_analysis', source: '', tags: ['runtime-guess'], importance: 0.9 },
    }),
    NOW
  ),
  'ASSUMED'
);

// T4 — STALE via invalidatedAt
assert.equal(
  getEpistemicStatus(baseRecord({ invalidatedAt: new Date(NOW) }), NOW),
  'STALE'
);

// T5 — STALE via decay (14d, stored 0.9)
assert.equal(
  getEpistemicStatus(
    baseRecord({ createdAt: new Date(NOW - 14 * DAY) }),
    NOW
  ),
  'STALE'
);

// T6 — UNKNOWN empty content
assert.equal(
  getEpistemicStatus(baseRecord({ content: '   ', confidence: 0.3 }), NOW),
  'UNKNOWN'
);

// T7 — UNKNOWN low effective (stored low, no decay needed)
assert.equal(
  getEpistemicStatus(baseRecord({ confidence: 0.1 }), NOW),
  'UNKNOWN'
);

// T8 — HUMAN_CONFIRMED
assert.equal(
  getEpistemicStatus(
    baseRecord({ source: 'human', confidence: 0.65 }),
    NOW
  ),
  'HUMAN_CONFIRMED'
);

// T9 — human TTL expired → not HUMAN_CONFIRMED
const expiredHuman = getEpistemicStatus(
  baseRecord({
    source: 'human',
    confidence: 0.65,
    createdAt: new Date(NOW - 31 * DAY),
  }),
  NOW
);
assert.notEqual(expiredHuman, 'HUMAN_CONFIRMED');

// T10 — HUMAN_CONFIRMED beats ASSUMED at same confidence
assert.equal(
  getEpistemicStatus(
    baseRecord({ source: 'human', confidence: 0.7 }),
    NOW
  ),
  'HUMAN_CONFIRMED'
);

// T11 — decay factor floored at 0.1 (effective = stored * 0.1 at most decay)
const effective30d = getEffectiveConfidence(
  baseRecord({ confidence: 0.5, createdAt: new Date(NOW - 30 * DAY) }),
  NOW
);
assert.ok(effective30d >= 0.5 * EPISTEMIC_MIN_EFFECTIVE);

// T11b — 30d @ 0.9 → STALE not UNKNOWN
assert.equal(
  getEpistemicStatus(
    baseRecord({ createdAt: new Date(NOW - 30 * DAY) }),
    NOW
  ),
  'STALE'
);

// Decay parity spot-check
const eff14 = getEffectiveConfidence(
  baseRecord({ createdAt: new Date(NOW - 14 * DAY) }),
  NOW
);
assert.ok(eff14 < EPISTEMIC_KNOWN_THRESHOLD);

console.log('epistemicStatus tests: OK');
