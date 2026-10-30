/**
 * MEM-2 — confidence 0 round-trip after reload
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

const {
  resetMemoryCore,
  getMemoryCore,
  getEpistemicStatus,
} = await import('../dist/memory/auto/unified-memory-core.js');
const { flushAllWithTimeout } = await import('../dist/core/shutdown/flushOnExit.js');

describe('MEM-2 confidence zero load', () => {
  it('L2 confidence 0 survives reload (not 0.5)', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mem2-'));
    const prev = process.env.M7_PROJECT_PATH;
    process.env.M7_PROJECT_PATH = dir;
    try {
      resetMemoryCore();
      const core = await getMemoryCore(dir);
      const r = await core.store(`refuted fact ${'z'.repeat(80)}`, {
        level: 'L2',
        confidence: 0,
      });
      assert.equal(r.confidence, 0);
      await flushAllWithTimeout();
      await core.reload();
      const got = await core.get(r.id);
      assert.ok(got);
      assert.equal(got.confidence, 0);
      assert.equal(getEpistemicStatus(got, Date.now()), 'UNKNOWN');
    } finally {
      process.env.M7_PROJECT_PATH = prev;
      resetMemoryCore();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
