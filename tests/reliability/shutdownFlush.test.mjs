/**
 * MEM-3 — shutdown flush for debounced memory writes
 *
 * Run: npm run build && node --test --test-force-exit tests/reliability/shutdownFlush.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, access } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

describe('MEM-3 shutdown flush', () => {
  it('L2 store + flushAllWithTimeout writes longterm.json before debounce', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'm7-mem3-'));
    const prevPath = process.env.M7_PROJECT_PATH;
    process.env.M7_PROJECT_PATH = dir;

    try {
      const { resetMemoryCore, getMemoryCore } = await import(
        '../../dist/memory/auto/unified-memory-core.js'
      );
      const { flushAllWithTimeout } = await import('../../dist/core/shutdown/flushOnExit.js');

      resetMemoryCore();
      const core = await getMemoryCore(dir);
      const content = `MEM-3 shutdown flush test payload ${'x'.repeat(80)}`;
      const record = await core.store(content, { level: 'L2', source: 'test' });

      const longtermPath = path.join(dir, '.m7/memory/longterm.json');
      await assert.rejects(
        access(longtermPath),
        'longterm.json should not exist before flush while debounce pending'
      );

      const result = await flushAllWithTimeout();
      assert.equal(result, 'done');

      const raw = JSON.parse(await readFile(longtermPath, 'utf8'));
      assert.ok(raw[record.id], 'record must be on disk after shutdown flush');
      assert.equal(raw[record.id].data.content, content);
    } finally {
      process.env.M7_PROJECT_PATH = prevPath;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
