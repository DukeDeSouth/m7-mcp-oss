/**
 * Grounding gate tests (Sprint 3)
 * Run: npm run build && node tests/groundingGate.test.mjs
 */
import assert from 'node:assert/strict';

const {
  parseGroundingSpec,
  warningSeverity,
  buildGroundingReport,
  runGroundingCheck,
} = await import('../dist/core/orchestrator/groundingGate.js');

console.log('groundingGate tests');

const VALID_SPEC_JSON = `\`\`\`json
{
  "grounding": {
    "premises": [
      { "id": "p1", "ref": "mem_test", "claim": "auth validates jwt" }
    ],
    "steps": [
      {
        "id": "s1",
        "description": "revert config",
        "reversibility": "reversible",
        "premise_ids": ["p1"]
      },
      {
        "id": "s2",
        "description": "deploy prod",
        "reversibility": "irreversible",
        "premise_ids": ["p1"]
      }
    ]
  }
}
\`\`\``;

// G1 — parse valid grounding JSON
const spec = parseGroundingSpec(VALID_SPEC_JSON);
assert.ok(spec);
assert.equal(spec.premises.length, 1);
assert.equal(spec.steps.length, 2);

// G2 — parse ignores unrelated json "operation" block
const dual = `\`\`\`json
{ "tag": "operation", "children": [] }
\`\`\`
${VALID_SPEC_JSON}`;
const spec2 = parseGroundingSpec(dual);
assert.ok(spec2);
assert.equal(spec2.premises[0].ref, 'mem_test');

// G3 — ASSUMED + reversible → soft
assert.equal(warningSeverity('ASSUMED', 'reversible'), 'soft');

// G4 — ASSUMED + irreversible → strong
assert.equal(warningSeverity('ASSUMED', 'irreversible'), 'strong');

// G5 — KNOWN → none
assert.equal(warningSeverity('KNOWN', 'irreversible'), 'none');

// G6 — HUMAN_CONFIRMED → none
assert.equal(warningSeverity('HUMAN_CONFIRMED', 'reversible'), 'none');

// G7 — missing spec
const missing = await runGroundingCheck(null, 'full');
assert.equal(missing.stats.softWarnings, 1);
assert.ok(missing.warnings[0].message.includes('No grounding JSON'));

// G8 — light mode filters to irreversible steps only
const specLight = parseGroundingSpec(VALID_SPEC_JSON);
assert.ok(specLight);
// runGroundingCheck will hit resolve - mem_test not found → warnings on irreversible step only for p1
const light = await runGroundingCheck(specLight, 'light');
assert.equal(light.stats.steps, 1);

// G9 — NOT_FOUND ref severity
assert.equal(warningSeverity('NOT_FOUND', 'irreversible'), 'strong');

// G10 — buildGroundingReport table
const report = buildGroundingReport(missing);
assert.ok(report.includes('Epistemic Grounding Report'));
assert.ok(report.includes('| 0 | 0 |'));

console.log('All groundingGate tests passed');
