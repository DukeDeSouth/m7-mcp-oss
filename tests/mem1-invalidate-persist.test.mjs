/**
 * MEM-1 — invalidate_bulk / UnifiedMemoryCore.invalidate persist to L2/L3
 * Run: npm run build && node --test --test-force-exit tests/mem1-invalidate-persist.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

const {
  resetMemoryCore,
  getMemoryCore,
  getEpistemicStatus,
} = await import('../dist/memory/auto/unified-memory-core.js');
const { flushAllWithTimeout } = await import('../dist/core/shutdown/flushOnExit.js');

describe('MEM-1 invalidate persist', () => {
  it('L2 invalidate survives reload with STALE epistemic view', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mem1-'));
    const prev = process.env.M7_PROJECT_PATH;
    process.env.M7_PROJECT_PATH = dir;
    try {
      resetMemoryCore();
      const core = await getMemoryCore(dir);
      const r = await core.store(`payload ${'x'.repeat(80)}`, {
        level: 'L2',
        confidence: 0.9,
      });
      const res = await core.invalidate(r.id);
      assert.equal(res.ok, true);
      assert.ok(Math.abs(res.record.confidence - 0.27) < 1e-9);
      assert.equal(await flushAllWithTimeout(), 'done');
      const raw = JSON.parse(
        await readFile(path.join(dir, '.m7/memory/longterm.json'), 'utf8')
      );
      assert.ok(raw[r.id]?.data?.invalidatedAt);
      assert.ok(Math.abs(raw[r.id].data.confidence - 0.27) < 1e-9);
      await core.reload();
      const got = await core.get(r.id);
      assert.ok(got);
      assert.ok(Math.abs(got.confidence - 0.27) < 1e-9);
      assert.ok(got.invalidatedAt instanceof Date);
      assert.equal(getEpistemicStatus(got, Date.now()), 'STALE');
    } finally {
      process.env.M7_PROJECT_PATH = prev;
      resetMemoryCore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('unknown id → not_found', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mem1-nf-'));
    const prev = process.env.M7_PROJECT_PATH;
    process.env.M7_PROJECT_PATH = dir;
    try {
      resetMemoryCore();
      const core = await getMemoryCore(dir);
      const res = await core.invalidate('mem_does_not_exist');
      assert.equal(res.ok, false);
      assert.equal(res.reason, 'not_found');
    } finally {
      process.env.M7_PROJECT_PATH = prev;
      resetMemoryCore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('L0 invalidate → persist_failed without mutating confidence', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mem1-l0-'));
    const prev = process.env.M7_PROJECT_PATH;
    process.env.M7_PROJECT_PATH = dir;
    try {
      resetMemoryCore();
      const core = await getMemoryCore(dir);
      const r = await core.store('surface only', { level: 'L0', confidence: 0.9 });
      const res = await core.invalidate(r.id);
      assert.equal(res.ok, false);
      assert.equal(res.reason, 'persist_failed');
      assert.match(res.error, /L2\/L3/i);
      const after = await core.get(r.id);
      assert.ok(Math.abs(after.confidence - 0.9) < 1e-9);
      assert.equal(after.invalidatedAt, undefined);
    } finally {
      process.env.M7_PROJECT_PATH = prev;
      resetMemoryCore();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('bulk invalidate counts only persisted rows', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mem1-bulk-'));
    const prev = process.env.M7_PROJECT_PATH;
    process.env.M7_PROJECT_PATH = dir;
    try {
      resetMemoryCore();
      const core = await getMemoryCore(dir);
      const a = await core.store(`a ${'p'.repeat(80)}`, { level: 'L2', confidence: 1 });
      const b = await core.store(`b ${'q'.repeat(80)}`, { level: 'L2', confidence: 1 });
      let persisted = 0;
      const notFound = [];
      for (const id of [a.id, b.id, 'mem_missing_bulk']) {
        const result = await core.invalidate(id, 0.3);
        if (result.ok) persisted++;
        else if (result.reason === 'not_found') notFound.push(id);
      }
      assert.equal(persisted, 2);
      assert.deepEqual(notFound, ['mem_missing_bulk']);
    } finally {
      process.env.M7_PROJECT_PATH = prev;
      resetMemoryCore();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
