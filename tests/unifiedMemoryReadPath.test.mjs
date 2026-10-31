/**
 * MEM-0 — unified read path (resolveRecord, iterateRecords, tombstones)
 * Run: npm run build && node --test --test-force-exit tests/unifiedMemoryReadPath.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

const {
  resetMemoryCore,
  getMemoryCore,
  MIRROR_MAX_CONFIDENCE,
} = await import('../dist/memory/auto/unified-memory-core.js');
const { flushAllWithTimeout } = await import('../dist/core/shutdown/flushOnExit.js');
const { CONTRADICT_CONFIDENCE_FACTOR } = await import('../dist/memory/memoryRelations.js');

describe('MEM-0 unified read path', () => {
  it('0a delete mirror id survives restart', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mem0a-'));
    const prev = process.env.M7_PROJECT_PATH;
    process.env.M7_PROJECT_PATH = dir;
    const unique = 'UniqueMirrorSectionXYZ';
    try {
      await writeFile(
        path.join(dir, 'INDEX.md'),
        `## ${unique}\n\n${unique} alpha beta gamma content here.\n`,
        'utf8'
      );
      resetMemoryCore();
      const core = await getMemoryCore(dir);
      const hits = await core.cascadeSearch(unique);
      const mirror = hits.find(h => h.record.id.startsWith('ref_INDEX.md_'));
      assert.ok(mirror, 'expected mirror hit from INDEX.md');
      const mirrorId = mirror.record.id;
      await core.delete(mirrorId);
      const tomb = JSON.parse(
        await readFile(path.join(dir, '.m7', 'memory-tombstones.json'), 'utf8')
      );
      assert.ok(tomb.ids.includes(mirrorId));
      resetMemoryCore();
      const cold = await getMemoryCore(dir);
      assert.equal(await cold.get(mirrorId), null);
      const again = await cold.cascadeSearch(unique);
      assert.ok(!again.some(h => h.record.id === mirrorId));
    } finally {
      process.env.M7_PROJECT_PATH = prev;
      resetMemoryCore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('0b contradicts confidence stable after restart', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mem0b-'));
    const prev = process.env.M7_PROJECT_PATH;
    process.env.M7_PROJECT_PATH = dir;
    try {
      resetMemoryCore();
      const core = await getMemoryCore(dir);
      const a = await core.store('fact A ' + 'x'.repeat(40), {
        level: 'L2',
        confidence: 0.9,
      });
      const b = await core.store('fact B contradicts', {
        level: 'L2',
        confidence: 0.9,
        dependencySpecs: [{ id: a.id, relationType: 'contradicts' }],
      });
      const confA = (await core.get(a.id)).confidence;
      const confB = b.confidence;
      assert.ok(confA <= 0.9 * CONTRADICT_CONFIDENCE_FACTOR + 0.001);
      assert.ok(confB <= 0.9 * CONTRADICT_CONFIDENCE_FACTOR + 0.001);
      assert.equal(await flushAllWithTimeout(), 'done');
      resetMemoryCore();
      const cold = await getMemoryCore(dir);
      const gotA = await cold.get(a.id);
      const gotB = await cold.get(b.id);
      assert.ok(gotA);
      assert.ok(gotB);
      assert.ok(Math.abs(gotA.confidence - confA) < 1e-9);
      assert.ok(Math.abs(gotB.confidence - confB) < 1e-9);
    } finally {
      process.env.M7_PROJECT_PATH = prev;
      resetMemoryCore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('0c mirror respects level and confidence filter', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mem0c-'));
    const prev = process.env.M7_PROJECT_PATH;
    process.env.M7_PROJECT_PATH = dir;
    const token = 'FilterMirrorTokenABC';
    try {
      await writeFile(
        path.join(dir, 'INDEX.md'),
        `## ${token}\n\n${token} searchable paragraph.\n`,
        'utf8'
      );
      resetMemoryCore();
      const core = await getMemoryCore(dir);
      const hits = await core.cascadeSearch(token, {
        levels: ['L0'],
        minConfidence: 0.8,
      });
      assert.equal(hits.length, 0);
      const unfiltered = await core.cascadeSearch(token);
      const mirror = unfiltered.find(h => h.record.id.startsWith('ref_'));
      assert.ok(mirror);
      assert.ok(mirror.record.confidence <= MIRROR_MAX_CONFIDENCE + 1e-9);
    } finally {
      process.env.M7_PROJECT_PATH = prev;
      resetMemoryCore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('0d L4 project level get after restart', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mem0d-'));
    const prev = process.env.M7_PROJECT_PATH;
    process.env.M7_PROJECT_PATH = dir;
    try {
      resetMemoryCore();
      const core = await getMemoryCore(dir);
      const r = await core.store('global universal fact ' + 'z'.repeat(30), {
        level: 'L4',
        confidence: 0.85,
      });
      assert.equal(r.level, 'L4');
      assert.equal(await flushAllWithTimeout(), 'done');
      const raw = JSON.parse(
        await readFile(path.join(dir, '.m7', 'memory', 'longterm.json'), 'utf8')
      );
      assert.ok(raw[r.id]?.data?.level === 'L4');
      resetMemoryCore();
      const cold = await getMemoryCore(dir);
      const got = await cold.get(r.id);
      assert.ok(got);
      assert.equal(got.level, 'L4');
    } finally {
      process.env.M7_PROJECT_PATH = prev;
      resetMemoryCore();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
