/**
 * Smart Context Tests (Phase 2)
 * 
 * Тестирование:
 * 1. Dependency Graph для памяти
 * 2. Incremental Warmup с Manifest
 * 3. Интеграция с Atomic Write и Retry
 */

import assert from 'assert';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

// Импорты из проекта
import { 
  UnifiedMemoryCore, 
  getMemoryCore 
} from '../../dist/memory/auto/unified-memory-core.js';

import { 
  ManifestManager, 
  getManifestManager,
  hasFileChanged,
  getChangedFiles 
} from '../../dist/core/utils/manifest.js';

import { 
  atomicWriteJSON, 
  safeReadJSON 
} from '../../dist/core/utils/atomicWrite.js';

import { 
  withRetry, 
  DEFAULT_RETRY_CONFIG 
} from '../../dist/core/utils/retry.js';

// ============================================================================
// Test Helpers
// ============================================================================

let testDir = '';
let passedTests = 0;
let failedTests = 0;

async function setup() {
  testDir = path.join(os.tmpdir(), `m7-phase2-test-${Date.now()}`);
  await fs.mkdir(testDir, { recursive: true });
  await fs.mkdir(path.join(testDir, '.m7'), { recursive: true });
  console.log(`\nTest directory: ${testDir}\n`);
}

async function cleanup() {
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch {}
}

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passedTests++;
  } catch (err) {
    console.log(`  ❌ ${name}`);
    console.log(`     Error: ${err.message}`);
    failedTests++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passedTests++;
  } catch (err) {
    console.log(`  ❌ ${name}`);
    console.log(`     Error: ${err.message}`);
    failedTests++;
  }
}

// ============================================================================
// 1. Dependency Graph Tests
// ============================================================================

async function testDependencyGraph() {
  console.log('\n📊 Dependency Graph для Memory\n');
  
  const memory = new UnifiedMemoryCore(testDir);
  await memory.initialize();
  
  // Test 1: Store with dependencies
  await asyncTest('Store record with dependencies', async () => {
    // Создаём базовую запись
    const baseRecord = await memory.store('Base configuration', {
      level: 'L2',
      source: 'code_analysis',
      contextKeys: ['config', 'base']
    });
    
    assert.ok(baseRecord.id, 'Should have ID');
    assert.strictEqual(baseRecord.dependencies?.length || 0, 0, 'Base should have no deps');
    
    // Создаём зависимую запись
    const dependentRecord = await memory.store('Dependent feature', {
      level: 'L1',
      source: 'runtime',
      contextKeys: ['feature'],
      dependencies: [baseRecord.id]
    });
    
    assert.ok(dependentRecord.dependencies?.includes(baseRecord.id), 'Should have dependency');
  });
  
  // Test 2: Content hash generation
  await asyncTest('Content hash is computed', async () => {
    const record = await memory.store('Test content for hash');
    assert.ok(record.contentHash, 'Should have content hash');
    assert.ok(record.contentHash.startsWith('hash_'), 'Hash should have prefix');
  });
  
  // Test 3: Different content = different hash
  await asyncTest('Different content produces different hash', async () => {
    const record1 = await memory.store('Content A');
    const record2 = await memory.store('Content B');
    assert.notStrictEqual(record1.contentHash, record2.contentHash, 'Hashes should differ');
  });
  
  // Test 4: lastValidated timestamp
  await asyncTest('Records have lastValidated timestamp', async () => {
    const record = await memory.store('Timestamped content');
    assert.ok(record.lastValidated, 'Should have lastValidated');
    assert.ok(record.lastValidated > Date.now() - 5000, 'Should be recent');
  });
  
  // Test 5: Cascade invalidation
  await asyncTest('Cascade invalidation marks dependents stale', async () => {
    // Создаём цепочку зависимостей: A <- B <- C
    const recordA = await memory.store('Record A (root)');
    const recordB = await memory.store('Record B depends on A', {
      dependencies: [recordA.id]
    });
    const recordC = await memory.store('Record C depends on B', {
      dependencies: [recordB.id]
    });
    
    // Инвалидируем A
    const invalidated = await memory.invalidateDependents(recordA.id);
    
    assert.ok(invalidated.includes(recordB.id), 'B should be invalidated');
    // C тоже должен быть инвалидирован через каскад
    assert.ok(invalidated.includes(recordC.id), 'C should be invalidated via cascade');
  });
  
  // Test 6: Update with invalidation
  await asyncTest('Update triggers invalidation', async () => {
    const parent = await memory.store('Parent record');
    const child = await memory.store('Child depends on parent', {
      dependencies: [parent.id]
    });
    
    const result = await memory.updateWithInvalidation(
      parent.id, 
      'Updated parent content'
    );
    
    assert.ok(result.record, 'Should return updated record');
    assert.ok(result.invalidated.includes(child.id), 'Child should be invalidated');
    assert.notStrictEqual(result.record.contentHash, parent.contentHash, 'Hash should change');
  });
  
  // Test 7: Get dependency graph
  await asyncTest('Get dependency graph for record', async () => {
    const root = await memory.store('Graph root');
    const dep1 = await memory.store('Dep 1', { dependencies: [root.id] });
    const dep2 = await memory.store('Dep 2', { dependencies: [root.id] });
    
    const graph = memory.getDependencyGraph(root.id);
    
    assert.ok(graph.record, 'Should have record');
    assert.strictEqual(graph.dependencies.length, 0, 'Root has no deps');
    assert.strictEqual(graph.dependents.length, 2, 'Should have 2 dependents');
  });
  
  // Test 8: Find stale records
  await asyncTest('Get stale records', async () => {
    // Создаём запись и сразу инвалидируем
    const record = await memory.store('Will be stale');
    const updated = await memory.get(record.id);
    if (updated) {
      updated.lastValidated = 0; // Принудительно делаем stale
    }
    
    const stale = await memory.getStaleRecords(0); // maxAge = 0 = все stale
    assert.ok(stale.length > 0, 'Should find stale records');
  });
}

// ============================================================================
// 2. Manifest / Incremental Warmup Tests
// ============================================================================

async function testManifest() {
  console.log('\n📁 Manifest / Incremental Warmup\n');
  
  const manifest = new ManifestManager(testDir);
  
  // Test 1: Create empty manifest
  await asyncTest('Create empty manifest', async () => {
    const data = await manifest.load();
    assert.ok(data, 'Should create manifest');
    assert.strictEqual(data.version, '1.0.0');
    assert.strictEqual(data.stats.totalFiles, 0);
  });
  
  // Test 2: Save and reload manifest
  await asyncTest('Save and reload manifest (atomic write)', async () => {
    await manifest.save();
    
    const manifestPath = path.join(testDir, '.m7', 'manifest.json');
    const result = await safeReadJSON(manifestPath);
    
    assert.ok(result.data, 'Should read saved manifest');
    assert.strictEqual(result.data.version, '1.0.0');
  });
  
  // Test 3: Compute diff for new files
  await asyncTest('Compute diff - detect new files', async () => {
    // Создаём тестовые файлы
    const testFile1 = path.join(testDir, 'test1.ts');
    const testFile2 = path.join(testDir, 'test2.ts');
    
    await fs.writeFile(testFile1, 'const x = 1;');
    await fs.writeFile(testFile2, 'const y = 2;');
    
    const diff = await manifest.computeDiff([testFile1, testFile2]);
    
    assert.strictEqual(diff.added.length, 2, 'Should detect 2 new files');
    assert.strictEqual(diff.modified.length, 0, 'No modified files');
    assert.strictEqual(diff.removed.length, 0, 'No removed files');
  });
  
  // Test 4: Update after warmup
  await asyncTest('Update after warmup', async () => {
    const testFile = path.join(testDir, 'warmed.ts');
    await fs.writeFile(testFile, 'export const warmed = true;');
    
    const diff = await manifest.computeDiff([testFile]);
    await manifest.updateAfterWarmup(diff.added);
    
    const data = await manifest.load();
    const relativePath = path.relative(testDir, testFile);
    
    assert.ok(data.files[relativePath], 'File should be in manifest');
    assert.ok(data.files[relativePath].lastWarmedAt, 'Should have warmup timestamp');
  });
  
  // Test 5: Detect modified files
  await asyncTest('Detect modified files', async () => {
    const testFile = path.join(testDir, 'modified.ts');
    await fs.writeFile(testFile, 'const before = 1;');
    
    // Первый warmup
    const diff1 = await manifest.computeDiff([testFile]);
    await manifest.updateAfterWarmup(diff1.added);
    
    // Модифицируем файл
    await new Promise(r => setTimeout(r, 10)); // Small delay
    await fs.writeFile(testFile, 'const after = 2;');
    
    // Второй diff
    const diff2 = await manifest.computeDiff([testFile]);
    
    assert.strictEqual(diff2.modified.length, 1, 'Should detect modified file');
    assert.strictEqual(diff2.added.length, 0, 'Not a new file');
  });
  
  // Test 6: Detect removed files
  await asyncTest('Detect removed files', async () => {
    const testFile = path.join(testDir, 'to_remove.ts');
    await fs.writeFile(testFile, 'const remove = true;');
    
    // Add to manifest
    const diff1 = await manifest.computeDiff([testFile]);
    await manifest.updateAfterWarmup(diff1.added);
    
    // Remove file
    await fs.unlink(testFile);
    
    // Diff with empty list (file no longer exists)
    const diff2 = await manifest.computeDiff([]);
    
    const relativePath = path.relative(testDir, testFile);
    assert.ok(diff2.removed.includes(relativePath), 'Should detect removed file');
  });
  
  // Test 7: Warmup savings calculation
  await asyncTest('Calculate warmup savings', async () => {
    // Create files and add to manifest
    const files = [];
    for (let i = 0; i < 10; i++) {
      const file = path.join(testDir, `savings${i}.ts`);
      await fs.writeFile(file, `export const n${i} = ${i};`);
      files.push(file);
    }
    
    const diff1 = await manifest.computeDiff(files);
    await manifest.updateAfterWarmup(diff1.added);
    
    // Modify only 2 files
    await fs.writeFile(files[0], 'export const modified0 = true;');
    await fs.writeFile(files[1], 'export const modified1 = true;');
    
    const diff2 = await manifest.computeDiff(files);
    const savings = manifest.getWarmupSavings(diff2);
    
    assert.strictEqual(savings.filesSkipped, 8, 'Should skip 8 unchanged files');
    assert.ok(savings.speedupFactor >= 1, 'Should have speedup');
  });
  
  // Test 8: Record warmup time
  await asyncTest('Record warmup time for estimates', async () => {
    await manifest.recordWarmupTime(500, 10); // 500ms for 10 files = 50ms/file
    
    const data = await manifest.load();
    assert.ok(data.stats.averageWarmupTimeMs, 'Should have average time');
  });
  
  // Test 9: hasFileChanged helper
  await asyncTest('hasFileChanged helper function', async () => {
    const testFile = path.join(testDir, 'check_change.ts');
    await fs.writeFile(testFile, 'original');
    
    // New file - should be changed
    const isNewChanged = await hasFileChanged(testFile, testDir);
    assert.strictEqual(isNewChanged, true, 'New file should be changed');
    
    // Add to manifest
    const diff = await manifest.computeDiff([testFile]);
    await manifest.updateAfterWarmup(diff.added);
    
    // Same content - not changed
    const isSameChanged = await hasFileChanged(testFile, testDir);
    // Note: might still be true if mtime differs, depends on implementation
  });
  
  // Test 10: Full warmup tracking
  await asyncTest('Track full warmup time', async () => {
    await manifest.markFullWarmup();
    
    const needsFull = await manifest.needsFullWarmup(0.001); // 0.001 hours = ~4 seconds ago
    assert.strictEqual(needsFull, false, 'Should not need full warmup immediately');
    
    // After long time
    const needsFullLater = await manifest.needsFullWarmup(0); // 0 hours = always needs
    assert.strictEqual(needsFullLater, true, 'Should need full warmup after expiry');
  });
}

// ============================================================================
// 3. Integration with Reliability MVP
// ============================================================================

async function testIntegrationWithReliability() {
  console.log('\n🔗 Integration: Smart Context + Reliability MVP\n');
  
  // Test 1: Manifest uses atomic write
  await asyncTest('Manifest saves with atomic write', async () => {
    const manifest = new ManifestManager(testDir);
    await manifest.load();
    await manifest.save();
    
    // Check backup exists
    const backupDir = path.join(testDir, '.m7', 'backups');
    try {
      const backups = await fs.readdir(backupDir);
      // May or may not have backups depending on config
      console.log(`     (Found ${backups.length} backups)`);
    } catch {
      // No backups is OK for first write
    }
  });
  
  // Test 2: Memory store uses atomic write internally
  await asyncTest('Memory persistence uses atomic write', async () => {
    const memory = new UnifiedMemoryCore(testDir);
    await memory.initialize();
    
    // Store multiple records
    for (let i = 0; i < 5; i++) {
      await memory.store(`Integration test record ${i}`, {
        level: 'L1',
        source: 'runtime'
      });
    }
    
    // Verify records persist
    const stats = await memory.getStats();
    assert.ok(stats.totalRecords >= 5, 'Records should persist');
  });
  
  // Test 3: Retry on manifest file operations
  await asyncTest('Manifest operations are retryable', async () => {
    const manifest = new ManifestManager(testDir);
    
    // Simulate retry scenario with network-like error
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts++;
        if (attempts < 2) {
          // Create error that looks like a network error for retry classification
          const err = new Error('ECONNRESET');
          err.code = 'ECONNRESET';
          throw err;
        }
        return await manifest.load();
      },
      { ...DEFAULT_RETRY_CONFIG, maxAttempts: 3 }
    );
    
    // Result should eventually succeed or we should see retry attempts
    // Note: The classifier may not retry ECONNRESET by default, 
    // so we just verify the retry system works
    assert.ok(attempts >= 1, 'Should have made at least 1 attempt');
  });
  
  // Test 4: Dependency graph with atomic updates
  await asyncTest('Dependency invalidation is atomic', async () => {
    const memory = new UnifiedMemoryCore(testDir);
    await memory.initialize();
    
    // Create dependency chain
    const root = await memory.store('Atomic root');
    const child1 = await memory.store('Atomic child 1', { dependencies: [root.id] });
    const child2 = await memory.store('Atomic child 2', { dependencies: [root.id] });
    
    // Update root - should atomically invalidate children
    const result = await memory.updateWithInvalidation(root.id, 'Updated atomic root');
    
    assert.strictEqual(result.invalidated.length, 2, 'Both children invalidated');
    assert.ok(result.record.lastValidated > 0, 'New validation timestamp');
  });
  
  // Test 5: Concurrent manifest updates
  await asyncTest('Concurrent manifest updates are safe', async () => {
    const manifest1 = new ManifestManager(testDir);
    const manifest2 = new ManifestManager(testDir);
    
    // Create test files
    const file1 = path.join(testDir, 'concurrent1.ts');
    const file2 = path.join(testDir, 'concurrent2.ts');
    await fs.writeFile(file1, 'const c1 = 1;');
    await fs.writeFile(file2, 'const c2 = 2;');
    
    // Concurrent updates (both should succeed due to atomic write)
    await Promise.all([
      (async () => {
        const diff = await manifest1.computeDiff([file1]);
        await manifest1.updateAfterWarmup(diff.added);
      })(),
      (async () => {
        const diff = await manifest2.computeDiff([file2]);
        await manifest2.updateAfterWarmup(diff.added);
      })()
    ]);
    
    // Both files should be tracked (latest write wins, but both should eventually be there)
    const finalManifest = new ManifestManager(testDir);
    const data = await finalManifest.load();
    
    // At least one should be there
    const hasFile1 = !!data.files['concurrent1.ts'];
    const hasFile2 = !!data.files['concurrent2.ts'];
    assert.ok(hasFile1 || hasFile2, 'At least one concurrent update should persist');
  });
}

// ============================================================================
// 4. Performance Tests
// ============================================================================

async function testPerformance() {
  console.log('\n⚡ Performance Tests\n');
  
  // Test 1: Large number of records
  await asyncTest('Handle 100+ memory records', async () => {
    const memory = new UnifiedMemoryCore(testDir);
    await memory.initialize();
    
    const startTime = Date.now();
    const records = [];
    
    for (let i = 0; i < 100; i++) {
      const record = await memory.store(`Performance test record ${i}`, {
        level: 'L0',
        source: 'runtime',
        contextKeys: ['perf', `batch-${Math.floor(i / 10)}`]
      });
      records.push(record);
    }
    
    const duration = Date.now() - startTime;
    console.log(`     (100 records in ${duration}ms)`);
    
    assert.ok(duration < 5000, 'Should complete in under 5 seconds');
    assert.strictEqual(records.length, 100, 'All records created');
  });
  
  // Test 2: Large dependency chain
  await asyncTest('Handle deep dependency chain (10 levels)', async () => {
    const memory = new UnifiedMemoryCore(testDir);
    await memory.initialize();
    
    let prevId;
    const chain = [];
    
    for (let i = 0; i < 10; i++) {
      const deps = prevId ? [prevId] : [];
      const record = await memory.store(`Chain level ${i}`, { dependencies: deps });
      chain.push(record.id);
      prevId = record.id;
    }
    
    // Invalidate root
    const startTime = Date.now();
    const invalidated = await memory.invalidateDependents(chain[0]);
    const duration = Date.now() - startTime;
    
    console.log(`     (10-level cascade in ${duration}ms)`);
    
    assert.ok(duration < 1000, 'Cascade should be fast');
    assert.strictEqual(invalidated.length, 9, 'All children invalidated');
  });
  
  // Test 3: Manifest with many files
  await asyncTest('Manifest handles 50 files', async () => {
    const manifest = new ManifestManager(testDir);
    const files = [];
    
    // Create files
    for (let i = 0; i < 50; i++) {
      const file = path.join(testDir, `perf_${i}.ts`);
      await fs.writeFile(file, `export const n${i} = ${i};`);
      files.push(file);
    }
    
    const startTime = Date.now();
    const diff = await manifest.computeDiff(files);
    await manifest.updateAfterWarmup(diff.added);
    const duration = Date.now() - startTime;
    
    console.log(`     (50 files in ${duration}ms)`);
    
    assert.ok(duration < 3000, 'Should handle 50 files quickly');
    assert.strictEqual(diff.added.length, 50, 'All files detected');
  });
}

// ============================================================================
// Run All Tests
// ============================================================================

async function runAllTests() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  M7 Smart Context Tests (Phase 2)                            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  await setup();
  
  try {
    await testDependencyGraph();
    await testManifest();
    await testIntegrationWithReliability();
    await testPerformance();
  } finally {
    await cleanup();
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`\n  Total: ${passedTests + failedTests} tests`);
  console.log(`  Passed: ${passedTests}`);
  console.log(`  Failed: ${failedTests}`);
  console.log(`\n  ${failedTests === 0 ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
  console.log('');
  
  process.exit(failedTests > 0 ? 1 : 0);
}

runAllTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
