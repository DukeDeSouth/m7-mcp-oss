import assert from 'node:assert/strict';

const { TaskResultCache } = await import('../dist/hive/cache/taskResultCache.js');

const cache = new TaskResultCache({ similarityThreshold: 1.1 });

cache.set('Исправить баг A', 'coder', 'ok-a', true, 10);
cache.set('Исправить баг B', 'coder', 'ok-b', true, 10);

assert.equal(cache.get('Исправить баг A')?.result, 'ok-a');
assert.equal(cache.get('Исправить баг B')?.result, 'ok-b');

cache.set('move A to B', 'coder', 'dir1', true, 5);
assert.equal(cache.get('move B to A'), null);

console.log('All hiveCache tests passed');
