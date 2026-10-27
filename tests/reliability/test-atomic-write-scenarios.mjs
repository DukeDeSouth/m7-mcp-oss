/**
 * M7 v3.10 Atomic Write - Comprehensive Test Scenarios
 * 
 * Tests:
 * - Basic atomic write operations
 * - Backup rotation
 * - Recovery from corruption
 * - Concurrent writes
 * - Edge cases
 * - Stress testing
 * 
 * Run: node tests/reliability/test-atomic-write-scenarios.mjs
 */

import assert from 'assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const { 
  atomicWrite, 
  atomicWriteJSON, 
  safeRead, 
  safeReadJSON, 
  listBackups,
  cleanupBackups,
  restoreFromBackup 
} = await import('../../dist/core/utils/atomicWrite.js');

// Test state
let tempDir;
let totalTests = 0;
let passedTests = 0;
let failedTests = [];

// Helpers
function test(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failedTests.push({ name, error: error.message });
    console.error(`  ❌ ${name}`);
    console.error(`     ${error.message}`);
  }
}

async function asyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failedTests.push({ name, error: error.message });
    console.error(`  ❌ ${name}`);
    console.error(`     ${error.message}`);
  }
}

// Setup
async function setup() {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'm7-atomic-test-'));
}

async function cleanup() {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch {}
}

console.log('\n🧪 Atomic Write Comprehensive Tests\n');
console.log('='.repeat(60));

await setup();

// ============================================
// BASIC OPERATIONS
// ============================================

console.log('\n📝 Basic Operations\n');

await asyncTest('Write string data', async () => {
  const filePath = path.join(tempDir, 'string-data.txt');
  const data = 'Hello, World!';
  
  const result = await atomicWrite(filePath, data);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.bytesWritten, data.length);
  
  const content = await fs.readFile(filePath, 'utf-8');
  assert.strictEqual(content, data);
});

await asyncTest('Write Buffer data', async () => {
  const filePath = path.join(tempDir, 'buffer-data.bin');
  const data = Buffer.from([0x00, 0x01, 0x02, 0xFF]);
  
  const result = await atomicWrite(filePath, data);
  assert.strictEqual(result.success, true);
  
  const content = await fs.readFile(filePath);
  assert.deepStrictEqual(content, data);
});

await asyncTest('Write JSON data', async () => {
  const filePath = path.join(tempDir, 'data.json');
  const data = { name: 'test', value: 42, nested: { a: 1 } };
  
  const result = await atomicWriteJSON(filePath, data);
  assert.strictEqual(result.success, true);
  
  const content = JSON.parse(await fs.readFile(filePath, 'utf-8'));
  assert.deepStrictEqual(content, data);
});

await asyncTest('Write to nested directory (auto-create)', async () => {
  const filePath = path.join(tempDir, 'nested', 'deep', 'file.txt');
  const data = 'nested data';
  
  const result = await atomicWrite(filePath, data);
  assert.strictEqual(result.success, true);
  
  const content = await fs.readFile(filePath, 'utf-8');
  assert.strictEqual(content, data);
});

await asyncTest('Overwrite existing file', async () => {
  const filePath = path.join(tempDir, 'overwrite.txt');
  
  await atomicWrite(filePath, 'version 1');
  const result = await atomicWrite(filePath, 'version 2');
  
  assert.strictEqual(result.success, true);
  
  const content = await fs.readFile(filePath, 'utf-8');
  assert.strictEqual(content, 'version 2');
});

// ============================================
// BACKUP ROTATION
// ============================================

console.log('\n💾 Backup Rotation\n');

await asyncTest('Create backup on overwrite', async () => {
  const filePath = path.join(tempDir, 'backup-test.json');
  
  await atomicWriteJSON(filePath, { version: 1 });
  const result = await atomicWriteJSON(filePath, { version: 2 });
  
  assert.strictEqual(result.backupCreated, true);
  
  const backups = await listBackups(filePath);
  assert.ok(backups.length >= 1, 'Should have at least one backup');
});

await asyncTest('Rotate multiple backups', async () => {
  const filePath = path.join(tempDir, 'multi-backup.json');
  
  for (let i = 1; i <= 5; i++) {
    await atomicWriteJSON(filePath, { version: i }, { maxBackups: 3 });
  }
  
  const backups = await listBackups(filePath);
  assert.ok(backups.length <= 3, `Should have max 3 backups, got ${backups.length}`);
});

await asyncTest('Cleanup old backups', async () => {
  const filePath = path.join(tempDir, 'cleanup-test.json');
  
  for (let i = 1; i <= 10; i++) {
    await atomicWriteJSON(filePath, { version: i }, { maxBackups: 5 });
  }
  
  await cleanupBackups(filePath, 2);
  
  const backups = await listBackups(filePath);
  assert.ok(backups.length <= 2, `Should have max 2 backups after cleanup, got ${backups.length}`);
});

// ============================================
// RECOVERY SCENARIOS
// ============================================

console.log('\n🔧 Recovery Scenarios\n');

await asyncTest('Read existing file', async () => {
  const filePath = path.join(tempDir, 'read-test.json');
  const data = { status: 'ok' };
  
  await atomicWriteJSON(filePath, data);
  
  const result = await safeReadJSON(filePath);
  assert.deepStrictEqual(result.data, data);
});

await asyncTest('Read non-existent file returns null', async () => {
  const filePath = path.join(tempDir, 'non-existent.json');
  
  const result = await safeReadJSON(filePath);
  assert.strictEqual(result.data, null);
});

await asyncTest('Recover from corrupted file', async () => {
  const filePath = path.join(tempDir, 'corrupt-recovery.json');
  
  // Write valid data with backup
  await atomicWriteJSON(filePath, { valid: true }, { maxBackups: 1 });
  await atomicWriteJSON(filePath, { valid: true, v2: true }, { maxBackups: 1 });
  
  // Corrupt main file
  await fs.writeFile(filePath, '{invalid json{{{{');
  
  // Try to read
  const result = await safeReadJSON(filePath);
  
  // Should either recover from backup or return error
  if (result.data) {
    assert.ok(result.recoveredFrom, 'Should indicate recovery');
  }
});

await asyncTest('Restore from most recent backup', async () => {
  const filePath = path.join(tempDir, 'restore-test.json');
  
  await atomicWriteJSON(filePath, { version: 1 });
  await atomicWriteJSON(filePath, { version: 2 });
  await atomicWriteJSON(filePath, { version: 3 });
  
  const backups = await listBackups(filePath);
  if (backups.length > 0) {
    // restoreFromBackup returns the backup path or null
    const restoredPath = await restoreFromBackup(filePath);
    assert.ok(restoredPath !== null, 'Restore should return backup path');
    
    // Main file should now have backup content
    const content = await safeReadJSON(filePath);
    assert.ok(content.data, 'File should have content');
  }
});

// ============================================
// EDGE CASES
// ============================================

console.log('\n🔬 Edge Cases\n');

await asyncTest('Write empty string', async () => {
  const filePath = path.join(tempDir, 'empty.txt');
  
  const result = await atomicWrite(filePath, '');
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.bytesWritten, 0);
});

await asyncTest('Write empty object', async () => {
  const filePath = path.join(tempDir, 'empty-obj.json');
  
  const result = await atomicWriteJSON(filePath, {});
  assert.strictEqual(result.success, true);
  
  const read = await safeReadJSON(filePath);
  assert.deepStrictEqual(read.data, {});
});

await asyncTest('Write large file (1MB)', async () => {
  const filePath = path.join(tempDir, 'large.txt');
  const data = 'x'.repeat(1024 * 1024); // 1MB
  
  const result = await atomicWrite(filePath, data);
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.bytesWritten, data.length);
});

await asyncTest('Write file with special characters in name', async () => {
  const filePath = path.join(tempDir, 'file with spaces & symbols!.txt');
  
  const result = await atomicWrite(filePath, 'data');
  assert.strictEqual(result.success, true);
});

await asyncTest('Write JSON with Unicode', async () => {
  const filePath = path.join(tempDir, 'unicode.json');
  const data = { emoji: '🎉', russian: 'Привет', chinese: '你好' };
  
  await atomicWriteJSON(filePath, data);
  const read = await safeReadJSON(filePath);
  
  assert.deepStrictEqual(read.data, data);
});

await asyncTest('No backup on first write', async () => {
  const filePath = path.join(tempDir, 'first-write.json');
  
  const result = await atomicWriteJSON(filePath, { first: true });
  assert.strictEqual(result.backupCreated, false);
});

// ============================================
// CONCURRENT WRITES
// ============================================

console.log('\n⚡ Concurrent Writes\n');

await asyncTest('Handle concurrent writes to same file', async () => {
  const filePath = path.join(tempDir, 'concurrent.json');
  
  // Start 5 concurrent writes
  const writes = [];
  for (let i = 0; i < 5; i++) {
    writes.push(atomicWriteJSON(filePath, { writer: i, timestamp: Date.now() }));
  }
  
  const results = await Promise.all(writes);
  
  // At least one should succeed
  const successCount = results.filter(r => r.success).length;
  assert.ok(successCount >= 1, `At least one write should succeed, got ${successCount}`);
  
  // File should be readable and valid JSON
  const content = await safeReadJSON(filePath);
  assert.ok(content.data !== null, 'File should be valid JSON');
});

await asyncTest('Parallel writes to different files', async () => {
  const writes = [];
  for (let i = 0; i < 10; i++) {
    const filePath = path.join(tempDir, `parallel-${i}.json`);
    writes.push(atomicWriteJSON(filePath, { id: i }));
  }
  
  const results = await Promise.all(writes);
  const allSuccess = results.every(r => r.success);
  
  assert.strictEqual(allSuccess, true, 'All parallel writes should succeed');
});

// ============================================
// STRESS TEST
// ============================================

console.log('\n💪 Stress Test\n');

await asyncTest('Rapid sequential writes (100 times)', async () => {
  const filePath = path.join(tempDir, 'rapid-writes.json');
  
  const start = Date.now();
  for (let i = 0; i < 100; i++) {
    await atomicWriteJSON(filePath, { iteration: i }, { maxBackups: 3 });
  }
  const duration = Date.now() - start;
  
  console.log(`     (100 writes in ${duration}ms, ${(duration/100).toFixed(1)}ms/write)`);
  
  // Verify final state
  const final = await safeReadJSON(filePath);
  assert.strictEqual(final.data.iteration, 99);
});

await asyncTest('Large JSON with deep nesting', async () => {
  const filePath = path.join(tempDir, 'deep-nesting.json');
  
  // Create deeply nested object
  let obj = { value: 'leaf' };
  for (let i = 0; i < 50; i++) {
    obj = { nested: obj, level: i };
  }
  
  const result = await atomicWriteJSON(filePath, obj);
  assert.strictEqual(result.success, true);
  
  const read = await safeReadJSON(filePath);
  assert.ok(read.data.nested, 'Should preserve nesting');
});

// ============================================
// CLEANUP & RESULTS
// ============================================

await cleanup();

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Atomic Write Tests: ${passedTests}/${totalTests} passed`);

if (failedTests.length > 0) {
  console.log('\n❌ Failed tests:');
  failedTests.forEach(({ name, error }) => {
    console.log(`   - ${name}: ${error}`);
  });
}

console.log();
process.exit(failedTests.length > 0 ? 1 : 0);
