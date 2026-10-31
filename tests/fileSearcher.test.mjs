import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { grepForKeywordTestHarness } = await import('../dist/hive/context/fileSearcher.js');

const dir = await mkdtemp(join(tmpdir(), 'm7 space dir '));
try {
  const sub = join(dir, 'sub "quote"');
  await mkdir(sub, { recursive: true });
  await writeFile(join(sub, 'needle.ts'), 'export const UNIQUE_HYG3_NEEDLE = 1;\n', 'utf8');

  const matches = await grepForKeywordTestHarness(sub, 'UNIQUE_HYG3_NEEDLE', {
    includeExtensions: ['.ts'],
    excludePatterns: ['node_modules', 'dist'],
  });

  assert.equal(matches.length, 1);
  assert.ok(matches[0].path.endsWith('needle.ts'));
  assert.ok(matches[0].matchCount >= 1);

  const none = await grepForKeywordTestHarness(sub, 'NO_SUCH_TOKEN_XYZ', {
    includeExtensions: ['.ts'],
    excludePatterns: [],
  });
  assert.equal(none.length, 0);
} finally {
  await rm(dir, { recursive: true, force: true });
}

console.log('All fileSearcher tests passed');
