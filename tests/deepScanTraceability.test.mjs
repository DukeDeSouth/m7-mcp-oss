/**
 * Deep Scan traceability: KNOWN_ISSUES, the roadmap, the fix plan, the changelog,
 * the sprint notes and the acceptance suites describe the same set of items in
 * the same way. Reads files only; no build needed.
 *
 * Run: node --test tests/deepScanTraceability.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = rel => readFileSync(path.join(ROOT, rel), 'utf8');

// The 28 items of the October 2026 review, plus the defects the acceptance suites found later.
const EXPECTED_IDS = [
  'CYC-1', 'CYC-2', 'CYC-3', 'CYC-4', 'CYC-5', 'CYC-6', 'CYC-7', 'CYC-8', 'CYC-9', 'CYC-10',
  'STATE-1', 'STATE-2', 'STATE-3', 'STATE-4', 'STATE-5',
  'MEM-0', 'MEM-1', 'MEM-2', 'MEM-3', 'MEM-4', 'MEM-5', 'MEM-6', 'MEM-7',
  'GRAPH-1', 'GRAPH-2', 'GRAPH-3',
  'GATE-1', 'GATE-2', 'GATE-3',
  'HYG-1', 'HYG-2', 'HYG-3', 'HYG-4', 'HYG-5', 'HYG-6', 'HYG-7', 'HYG-8', 'HYG-9', 'HYG-10', 'HYG-11',
];
const ID_RE = /\b(?:CYC|STATE|MEM|GRAPH|GATE|HYG)-\d+\b/g;

const known = read('KNOWN_ISSUES.md');
const fixPlan = read('docs/FIX_PLAN.md');
const changelog = read('CHANGELOG.md');
const sprint = read('docs/COMMUNITY_SPRINT.md');
const suites = ['tests/deepScanAcceptance.test.mjs', 'tests/deepScanE2E.test.mjs'].map(read).join('\n');
const pkg = JSON.parse(read('package.json'));
const manifest = JSON.parse(read('mcp.json'));

function section(text, startHeading, endHeading) {
  const start = text.indexOf(startHeading);
  assert.notEqual(start, -1, `missing "${startHeading}"`);
  const end = endHeading ? text.indexOf(endHeading, start + startHeading.length) : text.length;
  assert.notEqual(end, -1, `missing "${endHeading}" after "${startHeading}"`);
  return text.slice(start, end);
}

function summaryRows() {
  const table = section(known, '## Summary', '## Roadmap');
  return table
    .split('\n')
    .filter(l => /^\| [A-Z]+-\d+ \|/.test(l))
    .map(l => {
      const [id, title, severity, stage, labels, status] = l.split(' | ').map(c => c.replace(/^\| ?| ?\|$/g, '').trim());
      return { id, title, severity, stage, labels, status };
    });
}

function detailBlocks(text) {
  const blocks = new Map();
  const order = [];
  for (const m of text.matchAll(/^### ([A-Z]+-\d+) — (.+)\n\n(.+)$/gm)) {
    blocks.set(m[1], { title: m[2], meta: m[3] });
    order.push(m[1]);
  }
  return { blocks, order };
}

const rows = summaryRows();
const rowById = new Map(rows.map(r => [r.id, r]));
const details = detailBlocks(known);

describe('KNOWN_ISSUES summary and item blocks agree', () => {
  it('summary lists exactly the expected IDs, once each, in item order', () => {
    assert.deepEqual(rows.map(r => r.id), EXPECTED_IDS);
    assert.deepEqual(details.order, EXPECTED_IDS);
  });

  it('every item block repeats its summary row (title, severity, stage, labels, status)', () => {
    for (const id of EXPECTED_IDS) {
      const row = rowById.get(id);
      const block = details.blocks.get(id);
      assert.ok(block, `${id}: no "### ${id} — …" block`);
      assert.equal(block.title, row.title, `${id}: title`);
      assert.equal(
        block.meta,
        `**Severity:** ${row.severity} · **Stage:** ${row.stage} · **Labels:** ${row.labels} · **Status:** ${row.status}`,
        `${id}: severity/stage/labels/status line`,
      );
    }
  });

  it('no item is open and every status uses one of the two fixed forms', () => {
    for (const { id, status } of rows) {
      assert.match(status, /^fixed (in #\d+|\(local v\d+\.\d+\.\d+\))$/, `${id}: "${status}"`);
    }
  });

  it('every item block has Where, Expected and Acceptance test lines', () => {
    for (const id of EXPECTED_IDS) {
      const start = known.indexOf(`### ${id} — `);
      const next = known.slice(start + 4).search(/^#{2,3} /m);
      const body = known.slice(start, next === -1 ? undefined : start + 4 + next);
      for (const field of ['**Where:**', '**Expected:**', '**Acceptance test:**']) {
        assert.ok(body.includes(field), `${id}: missing ${field}`);
      }
    }
  });
});

describe('every review finding is accounted for', () => {
  // The numbered findings of the October 2026 review: F01–F26 plus §04 and §31.
  const FINDINGS = ['§04', ...Array.from({ length: 26 }, (_, i) => `F${String(i + 1).padStart(2, '0')}`), '§31'];
  const mapping = section(known, '## Review findings', '## Not on this list');
  const notOnList = section(known, '## Not on this list', '## Maintaining this file');
  const findingRows = mapping
    .split('\n')
    .filter(l => /^\| (F\d\d|§\d\d) \|/.test(l))
    .map(l => {
      const [finding, title, items, declined] = l.split('|').slice(1, -1).map(c => c.trim());
      return {
        finding,
        title,
        items: items.match(ID_RE) ?? [],
        declined: declined ? declined.split(';').map(s => s.trim()) : [],
      };
    });
  const leads = [...notOnList.matchAll(/^- \*\*(.+?)\.?\*\*/gm)].map(m => m[1]);
  const fromNoFinding = (mapping.split('\n').find(l => l.startsWith('Items that do not come from a numbered finding:')) ?? '')
    .match(ID_RE) ?? [];

  it('the table lists each finding exactly once, in review order', () => {
    assert.deepEqual(findingRows.map(r => r.finding), FINDINGS);
  });

  it('every row has a title and either an item or a declined part', () => {
    for (const r of findingRows) {
      assert.ok(r.title, `${r.finding}: no review title`);
      assert.ok(r.items.length + r.declined.length > 0, `${r.finding}: neither an item nor a "Not on this list" entry`);
    }
  });

  it('items in the table exist in the summary', () => {
    for (const r of findingRows) {
      for (const id of r.items) assert.ok(EXPECTED_IDS.includes(id), `${r.finding}: ${id} is not in KNOWN_ISSUES`);
    }
  });

  it('declined parts name a "Not on this list" entry, and every entry is named by some finding', () => {
    assert.ok(leads.length > 0, 'no bold-lead bullets in "Not on this list"');
    const named = new Set(findingRows.flatMap(r => r.declined));
    for (const d of named) assert.ok(leads.includes(d), `"${d}" is not a "Not on this list" entry (entries: ${leads.join(', ')})`);
    for (const lead of leads) assert.ok(named.has(lead), `"Not on this list" entry "${lead}" is not tied to any finding`);
  });

  it('every item comes from a finding or is listed as not from one, never both', () => {
    const fromFindings = new Set(findingRows.flatMap(r => r.items));
    assert.equal(new Set(fromNoFinding).size, fromNoFinding.length, 'duplicate ID in the "not from a numbered finding" line');
    for (const id of EXPECTED_IDS) {
      const a = fromFindings.has(id);
      const b = fromNoFinding.includes(id);
      assert.ok(a !== b, `${id}: ${a ? 'listed both under a finding and as not from one' : 'neither under a finding nor as not from one'}`);
    }
    for (const id of fromNoFinding) assert.ok(EXPECTED_IDS.includes(id), `${id} is not in KNOWN_ISSUES`);
  });
});

describe('roadmap covers every item in its own stage', () => {
  const roadmap = section(known, '## Roadmap', '\n---\n');
  const stageOrder = n => {
    const stage = section(roadmap, `### Stage ${n}`, n < 3 ? `### Stage ${n + 1}` : undefined);
    const line = stage.split('\n').find(l => l.startsWith('Order:'));
    assert.ok(line, `Stage ${n}: no "Order:" line`);
    return line.match(ID_RE) ?? [];
  };

  for (const n of [1, 2, 3]) {
    it(`Stage ${n} order lists exactly the items marked stage ${n}`, () => {
      const listed = stageOrder(n);
      assert.equal(new Set(listed).size, listed.length, `Stage ${n}: duplicate ID in order`);
      const marked = rows.filter(r => r.stage === String(n)).map(r => r.id);
      assert.deepEqual([...listed].sort(), [...marked].sort());
    });
  }
});

describe('FIX_PLAN has one plan per item, same titles, same order', () => {
  const plan = detailBlocks(fixPlan);

  it('IDs and order match KNOWN_ISSUES', () => {
    assert.deepEqual(plan.order, EXPECTED_IDS);
  });

  it('titles match KNOWN_ISSUES', () => {
    for (const id of EXPECTED_IDS) {
      assert.equal(plan.blocks.get(id)?.title, rowById.get(id).title, id);
    }
  });
});

describe('acceptance suites cover every item', () => {
  it('every ID is tagged [ID] in a describe of the deep scan suites', () => {
    const tagged = new Set([...suites.matchAll(/describe\('([^']*)'/g)].flatMap(m => m[1].match(/\[[A-Z]+-\d+[a-d]?\]/g) ?? []).map(t => t.slice(1, -1).replace(/[a-d]$/, '')));
    for (const id of EXPECTED_IDS) assert.ok(tagged.has(id), `${id}: no [${id}] describe`);
  });

  it('suites and the mutant script reference no ID that KNOWN_ISSUES does not list', () => {
    const referenced = new Set([...suites.match(ID_RE), ...read('scripts/deep-scan-mutants.mjs').match(ID_RE)]);
    for (const id of referenced) assert.ok(EXPECTED_IDS.includes(id), `${id} is not in KNOWN_ISSUES`);
  });
});

describe('changelog and versions', () => {
  const versions = [...changelog.matchAll(/^## \[(\d+)\.(\d+)\.(\d+)\]/gm)].map(m => m.slice(1, 4).map(Number));
  const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

  it('released versions are listed newest first', () => {
    for (let i = 1; i < versions.length; i++) {
      assert.ok(cmp(versions[i - 1], versions[i]) > 0, `${versions[i - 1].join('.')} is listed above ${versions[i].join('.')}`);
    }
  });

  it('the newest changelog entry, package.json and mcp.json carry the same version', () => {
    assert.equal(versions[0].join('.'), pkg.version);
    assert.equal(manifest.version, pkg.version);
  });

  it('every item is mentioned in the changelog', () => {
    for (const id of EXPECTED_IDS) assert.match(changelog, new RegExp(`\\b${id}\\b`), id);
  });

  it('a "fixed (local vX.Y.Z)" status points at a changelog entry that names the item', () => {
    for (const { id, status } of rows) {
      const m = /^fixed \(local v(\d+\.\d+\.\d+)\)$/.exec(status);
      if (!m) continue;
      const entry = section(changelog, `## [${m[1]}]`, '\n## ');
      assert.match(entry, new RegExp(`\\b${id}\\b`), `${id}: not in the ${m[1]} entry`);
    }
  });
});

describe('sprint notes', () => {
  it('COMMUNITY_SPRINT names every item and has no stale "Still open" section', () => {
    for (const id of EXPECTED_IDS) assert.match(sprint, new RegExp(`\\b${id}\\b`), id);
    assert.doesNotMatch(sprint, /^### Still open/m);
  });
});
