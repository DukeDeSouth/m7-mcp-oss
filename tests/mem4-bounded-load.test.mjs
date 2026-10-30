/**
 * MEM-4 — loading >2000 longterm entries must not truncate on flush
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';

const ENTRY_COUNT = 2100;

function makeLongtermPayload(count) {
  const data = {};
  for (let i = 0; i < count; i++) {
    const key = `mem4-key-${String(i).padStart(4, '0')}`;
    data[key] = {
      data: { n: i },
      timestamp: new Date().toISOString(),
      level: 'longterm',
    };
  }
  return data;
}

describe('MEM-4 bounded load', () => {
  it('2100-entry longterm.json survives load, store, and shutdown flush', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mem4-'));
    const prev = {
      M7: process.env.M7_PROJECT_PATH,
      CURSOR: process.env.CURSOR_WORKSPACE,
    };
    process.env.M7_PROJECT_PATH = dir;
    process.env.CURSOR_WORKSPACE = dir;
    const { resetProjectPathStateForTests } = await import(
      '../dist/core/utils/projectPath.js'
    );
    resetProjectPathStateForTests();

    const memoryDir = path.join(dir, '.m7', 'memory');
    await mkdir(memoryDir, { recursive: true });
    const longtermPath = path.join(memoryDir, 'longterm.json');
    await writeFile(longtermPath, JSON.stringify(makeLongtermPayload(ENTRY_COUNT)));

    try {
      const { MemorySystem } = await import('../dist/memory/memorySystem.js');
      const ms = new MemorySystem(dir);
      await ms.ensureLoaded();

      const keys = await ms.list('longterm');
      assert.equal(keys.length, ENTRY_COUNT);

      await ms.store('mem4-key-new', { added: true }, 'longterm');
      await ms.shutdown();

      const raw = JSON.parse(await readFile(longtermPath, 'utf8'));
      assert.ok(Object.keys(raw).length >= ENTRY_COUNT + 1);
      assert.ok(raw['mem4-key-new']);
    } finally {
      process.env.M7_PROJECT_PATH = prev.M7;
      process.env.CURSOR_WORKSPACE = prev.CURSOR;
      resetProjectPathStateForTests();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
