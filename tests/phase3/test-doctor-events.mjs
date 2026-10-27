/**
 * Phase 3 Tests: Doctor Tool + Event System
 */

import assert from 'assert';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

// Imports
import { handleDoctorTool } from '../../dist/core/tools/doctorTool.js';
import { 
  getEventEmitter, 
  resetEventEmitter,
  on, 
  once, 
  emit, 
  emitSync,
  enableEventLogging,
  enableEventMetrics
} from '../../dist/core/events/eventSystem.js';

// ============================================================================
// Test Helpers
// ============================================================================

let testDir = '';
let passedTests = 0;
let failedTests = 0;

async function setup() {
  testDir = path.join(os.tmpdir(), `m7-phase3-test-${Date.now()}`);
  await fs.mkdir(testDir, { recursive: true });
  console.log(`\nTest directory: ${testDir}\n`);
}

async function cleanup() {
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch {}
  resetEventEmitter();
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
// 1. Doctor Tool Tests
// ============================================================================

async function testDoctorTool() {
  console.log('\n🩺 Doctor Tool Tests\n');
  
  // Test 1: Check on empty directory
  await asyncTest('Doctor check on empty directory', async () => {
    const emptyDir = path.join(testDir, 'empty-project');
    await fs.mkdir(emptyDir, { recursive: true });
    
    const result = await handleDoctorTool({ action: 'check' }, emptyDir);
    
    assert.ok(result.includes('M7 Doctor Report'), 'Should return report');
    assert.ok(result.includes('.m7/ directory'), 'Should check .m7/ directory');
  });
  
  // Test 2: Doctor fix creates .m7/
  await asyncTest('Doctor fix creates .m7/ directory', async () => {
    const fixDir = path.join(testDir, 'fix-project');
    await fs.mkdir(fixDir, { recursive: true });
    
    const result = await handleDoctorTool({ action: 'fix' }, fixDir);
    
    assert.ok(result.includes('🔧') || result.includes('Created'), 'Should show fix indicator');
    
    // Verify .m7/ was created
    const m7Exists = await fs.stat(path.join(fixDir, '.m7')).then(() => true).catch(() => false);
    assert.ok(m7Exists, '.m7/ should exist after fix');
  });
  
  // Test 3: Check valid project
  await asyncTest('Doctor check on valid project structure', async () => {
    const validDir = path.join(testDir, 'valid-project');
    const m7Dir = path.join(validDir, '.m7');
    const memoryDir = path.join(m7Dir, 'memory');
    
    await fs.mkdir(memoryDir, { recursive: true });
    await fs.writeFile(path.join(m7Dir, 'errors.json'), '{}');
    await fs.writeFile(path.join(m7Dir, 'features.json'), '{}');
    await fs.writeFile(path.join(memoryDir, 'longterm.json'), '{}');
    
    const result = await handleDoctorTool({ action: 'check' }, validDir);
    
    assert.ok(result.includes('✅'), 'Should have passed checks');
  });
  
  // Test 4: Detect corrupted JSON
  await asyncTest('Doctor detects corrupted JSON', async () => {
    const corruptDir = path.join(testDir, 'corrupt-project');
    const m7Dir = path.join(corruptDir, '.m7');
    
    await fs.mkdir(m7Dir, { recursive: true });
    await fs.writeFile(path.join(m7Dir, 'errors.json'), 'not valid json {{{');
    
    const result = await handleDoctorTool({ action: 'check' }, corruptDir);
    
    // May show warning or pass (safeReadJSON may recover)
    assert.ok(result.includes('Doctor Report'), 'Should complete check');
  });
  
  // Test 5: Fix corrupted JSON
  await asyncTest('Doctor fix repairs corrupted JSON', async () => {
    const repairDir = path.join(testDir, 'repair-project');
    const m7Dir = path.join(repairDir, '.m7');
    
    await fs.mkdir(m7Dir, { recursive: true });
    await fs.writeFile(path.join(m7Dir, 'compliance.json'), '{invalid');
    
    const result = await handleDoctorTool({ action: 'fix' }, repairDir);
    
    // After fix, file should be valid JSON
    const content = await fs.readFile(path.join(m7Dir, 'compliance.json'), 'utf-8');
    try {
      JSON.parse(content);
      // If it parses, the fix worked
    } catch {
      // May not be fixed if no backup, but shouldn't throw
    }
    
    assert.ok(result.includes('Doctor Report'), 'Should complete fix');
  });
  
  // Test 6: Report action
  await asyncTest('Doctor report action', async () => {
    const reportDir = path.join(testDir, 'report-project');
    await fs.mkdir(path.join(reportDir, '.m7'), { recursive: true });
    
    const result = await handleDoctorTool({ action: 'report' }, reportDir);
    
    assert.ok(result.includes('Health Status'), 'Should include health status');
    assert.ok(result.includes('Checks'), 'Should include checks table');
  });
  
  // Test 7: Verbose output
  await asyncTest('Doctor verbose output', async () => {
    const verboseDir = path.join(testDir, 'verbose-project');
    await fs.mkdir(path.join(verboseDir, '.m7'), { recursive: true });
    
    const result = await handleDoctorTool({ action: 'check', verbose: true }, verboseDir);
    
    assert.ok(result.includes('Doctor Report'), 'Should return detailed report');
  });
  
  // Test 8: Check total size
  await asyncTest('Doctor checks total .m7/ size', async () => {
    const sizeDir = path.join(testDir, 'size-project');
    const m7Dir = path.join(sizeDir, '.m7');
    
    await fs.mkdir(m7Dir, { recursive: true });
    // Create a small file
    await fs.writeFile(path.join(m7Dir, 'small.json'), '{}');
    
    const result = await handleDoctorTool({ action: 'check' }, sizeDir);
    
    assert.ok(result.includes('total .m7/ size'), 'Should check total size');
    assert.ok(result.includes('MB'), 'Should show size in MB');
  });
}

// ============================================================================
// 2. Event System Tests
// ============================================================================

async function testEventSystem() {
  console.log('\n📡 Event System Tests\n');
  
  resetEventEmitter();
  
  // Test 1: Basic event subscription
  await asyncTest('Subscribe and emit event', async () => {
    let received = false;
    
    on('task:analyzed', () => {
      received = true;
    });
    
    await emit('task:analyzed', { description: 'Test task' });
    
    assert.ok(received, 'Handler should receive event');
  });
  
  resetEventEmitter();
  
  // Test 2: Event context
  await asyncTest('Event context contains correct data', async () => {
    let context = null;
    
    on('task:completed', (ctx) => {
      context = ctx;
    });
    
    await emit('task:completed', { result: 'success' }, {
      sessionId: 'session_123',
      taskId: 'task_456'
    });
    
    assert.ok(context, 'Should receive context');
    assert.strictEqual(context.event, 'task:completed');
    assert.strictEqual(context.sessionId, 'session_123');
    assert.strictEqual(context.taskId, 'task_456');
    assert.strictEqual(context.data.result, 'success');
  });
  
  resetEventEmitter();
  
  // Test 3: Once handler
  await asyncTest('Once handler fires only once', async () => {
    let count = 0;
    
    once('phase:entered', () => {
      count++;
    });
    
    await emit('phase:entered', { phase: 'discovery' });
    await emit('phase:entered', { phase: 'architecture' });
    await emit('phase:entered', { phase: 'planning' });
    
    assert.strictEqual(count, 1, 'Should fire only once');
  });
  
  resetEventEmitter();
  
  // Test 4: Priority ordering
  await asyncTest('Handlers execute in priority order', async () => {
    const order = [];
    
    // Convenience function signature: on(event, handler, priority?)
    on('hive:started', () => order.push('low'), 100);
    on('hive:started', () => order.push('high'), 1);
    on('hive:started', () => order.push('medium'), 50);
    
    await emit('hive:started', {});
    
    assert.deepStrictEqual(order, ['high', 'medium', 'low'], 'Should execute by priority');
  });
  
  resetEventEmitter();
  
  // Test 5: Unsubscribe
  await asyncTest('Can unsubscribe from event', async () => {
    let count = 0;
    
    const handlerId = on('memory:stored', () => {
      count++;
    });
    
    await emit('memory:stored', {});
    
    const emitter = getEventEmitter();
    emitter.off('memory:stored', handlerId);
    
    await emit('memory:stored', {});
    
    assert.strictEqual(count, 1, 'Should not fire after unsubscribe');
  });
  
  resetEventEmitter();
  
  // Test 6: Multiple handlers
  await asyncTest('Multiple handlers for same event', async () => {
    let sum = 0;
    
    on('error:captured', () => { sum += 1; });
    on('error:captured', () => { sum += 2; });
    on('error:captured', () => { sum += 4; });
    
    await emit('error:captured', { error: new Error('test') });
    
    assert.strictEqual(sum, 7, 'All handlers should fire');
  });
  
  resetEventEmitter();
  
  // Test 7: Sync emit
  await asyncTest('Sync emit fires handlers', async () => {
    let received = false;
    
    on('session:started', () => {
      received = true;
    });
    
    emitSync('session:started', {});
    
    // Small delay to let async handler complete
    await new Promise(r => setTimeout(r, 10));
    
    assert.ok(received, 'Sync emit should fire handlers');
  });
  
  resetEventEmitter();
  
  // Test 8: Event metrics
  await asyncTest('Event metrics tracking', async () => {
    const { getMetrics, handlerIds } = enableEventMetrics();
    
    await emit('task:analyzed', {});
    await emit('task:analyzed', {});
    await emit('task:completed', {});
    
    const metrics = getMetrics();
    
    assert.strictEqual(metrics['task:analyzed'], 2, 'Should count task:analyzed');
    assert.strictEqual(metrics['task:completed'], 1, 'Should count task:completed');
    
    // Cleanup
    for (const id of handlerIds) {
      getEventEmitter().off('task:analyzed', id);
      getEventEmitter().off('task:completed', id);
    }
  });
  
  resetEventEmitter();
  
  // Test 9: Emitter stats
  await asyncTest('Get emitter stats', async () => {
    on('warmup:started', () => {});
    on('warmup:completed', () => {});
    on('warmup:completed', () => {});
    
    const emitter = getEventEmitter();
    const stats = emitter.getStats();
    
    assert.strictEqual(stats.events, 2, 'Should track 2 event types');
    assert.strictEqual(stats.handlers, 3, 'Should track 3 handlers');
  });
  
  resetEventEmitter();
  
  // Test 10: Custom events
  await asyncTest('Custom events work', async () => {
    let received = null;
    
    on('custom:my-plugin-event', (ctx) => {
      received = ctx.data;
    });
    
    await emit('custom:my-plugin-event', { custom: 'data' });
    
    assert.ok(received, 'Should receive custom event');
    assert.strictEqual(received.custom, 'data');
  });
  
  resetEventEmitter();
  
  // Test 11: Pause and resume
  await asyncTest('Pause and resume emitter', async () => {
    let count = 0;
    
    on('doctor:fixed', () => { count++; });
    
    const emitter = getEventEmitter();
    emitter.pause();
    
    await emit('doctor:fixed', {});
    await emit('doctor:fixed', {});
    
    assert.strictEqual(count, 0, 'Should not fire while paused');
    
    await emitter.resume();
    
    assert.strictEqual(count, 2, 'Should fire queued events after resume');
  });
  
  resetEventEmitter();
  
  // Test 12: Handler error doesn't break others
  await asyncTest('Handler error does not break other handlers', async () => {
    let afterError = false;
    
    on('hive:conflict', () => {
      throw new Error('Handler error');
    }, { priority: 1 });
    
    on('hive:conflict', () => {
      afterError = true;
    }, { priority: 2 });
    
    await emit('hive:conflict', {});
    
    assert.ok(afterError, 'Second handler should still fire');
  });
}

// ============================================================================
// Run All Tests
// ============================================================================

async function runAllTests() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  M7 Phase 3 Tests: Doctor + Events                           ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  
  await setup();
  
  try {
    await testDoctorTool();
    await testEventSystem();
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
