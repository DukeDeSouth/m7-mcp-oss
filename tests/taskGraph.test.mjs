import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { TaskGraphManager } = await import('../dist/core/task-graph/taskGraphManager.js');
const { TransferManager } = await import('../dist/core/task-transfer/transferManager.js');

async function withTempProject(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'm7-task-graph-'));
  try {
    const mgr = new TaskGraphManager(dir);
    await mgr.initialize();
    await fn(mgr, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// GRAPH-1 — diamond: C reached with more depth budget re-expands (D included)
await withTempProject(async (mgr) => {
  const mk = async (id) =>
    mgr.createTask({ id, title: id, folder: `.m7/test/${id}` });
  await mk('A');
  await mk('B');
  await mk('C');
  await mk('D');
  await mgr.createLink('A', 'B', 'related', 'ab');
  await mgr.createLink('B', 'C', 'related', 'bc');
  await mgr.createLink('A', 'C', 'related', 'ac');
  await mgr.createLink('C', 'D', 'related', 'cd');

  const sub = await mgr.getSubgraph({ centerId: 'A', depth: 2, includeCompleted: true });
  const ids = sub.tasks.map(t => t.id).sort();
  assert.deepEqual(ids, ['A', 'B', 'C', 'D']);
});

// GRAPH-2 — duplicate createTask throws; transfer IDs stay distinct
await withTempProject(async (mgr) => {
  await mgr.createTask({ id: 't1', title: 'one', folder: '.m7/test/t1' });
  await assert.rejects(
    () => mgr.createTask({ id: 't1', title: 'dup', folder: '.m7/test/t1b' }),
    /already exists/,
  );

  const tm = new TransferManager(undefined, mgr);
  await mgr.createTask({ id: 'from', title: 'from', folder: '.m7/test/from' });
  const r1 = await tm.executeTransfer('from', 'scope_expansion', 'same desc', {
    type: 'scope_expansion',
    originalEstimate: 1,
    newEstimate: 10,
  });
  const r2 = await tm.executeTransfer('from', 'scope_expansion', 'same desc', {
    type: 'scope_expansion',
    originalEstimate: 1,
    newEstimate: 10,
  });
  assert.equal(r1.success, true);
  assert.equal(r2.success, true);
  assert.notEqual(r1.newTaskId, r2.newTaskId);
});

// GRAPH-3 — failed link rolls back new task and source status
await withTempProject(async (mgr) => {
  await mgr.createTask({ id: 'src', title: 'src', folder: '.m7/test/src' });
  const origLink = mgr.createLink.bind(mgr);
  let failOnce = true;
  mgr.createLink = async (...args) => {
    if (failOnce) {
      failOnce = false;
      throw new Error('stub link failure');
    }
    return origLink(...args);
  };

  const tm = new TransferManager(undefined, mgr);
  const before = JSON.stringify(mgr.graph ?? {});
  const result = await tm.executeTransfer('src', 'scope_expansion', 'rollback test', {
    type: 'scope_expansion',
    originalEstimate: 1,
    newEstimate: 5,
  });
  assert.equal(result.success, false);
  const src = await mgr.getTask('src');
  assert.equal(src.status, 'active');
  const stats = await mgr.getStats();
  assert.equal(stats.totalTasks, 1);
});

console.log('All taskGraph tests passed');
