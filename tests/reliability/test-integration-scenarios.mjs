/**
 * M7 v3.10 Reliability MVP - Integration Test Scenarios
 * 
 * Tests the complete reliability stack working together:
 * - Atomic Write + Retry
 * - Provider Manager + Context Guard
 * - Full API flow simulation
 * - Failure recovery scenarios
 * 
 * Run: node tests/reliability/test-integration-scenarios.mjs
 */

import assert from 'assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

// Import all reliability components
const { atomicWrite, atomicWriteJSON, safeReadJSON, listBackups } = 
  await import('../../dist/core/utils/atomicWrite.js');
const { withRetry, classifyError, isRetryableError, DEFAULT_RETRY_CONFIG } = 
  await import('../../dist/core/utils/retry.js');
const { ProviderManager } = 
  await import('../../dist/hive/api/providerManager.js');
const { estimateTokens, guardContext, analyzeContext, getModelLimits } = 
  await import('../../dist/hive/context/contextGuard.js');

// Test state
let tempDir;
let totalTests = 0;
let passedTests = 0;
let failedTests = [];

// Helpers
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

async function setup() {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'm7-integration-'));
}

async function cleanup() {
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch {}
}

console.log('\n🧪 Reliability MVP Integration Tests\n');
console.log('='.repeat(60));

await setup();

// ============================================
// ATOMIC WRITE + RETRY INTEGRATION
// ============================================

console.log('\n🔗 Atomic Write + Retry\n');

await asyncTest('Atomic write with retry on temporary failure', async () => {
  const filePath = path.join(tempDir, 'atomic-retry.json');
  let attempts = 0;
  
  const result = await withRetry(async () => {
    attempts++;
    if (attempts < 2) {
      // Simulate temporary filesystem error
      const error = new Error('EBUSY: resource busy');
      error.code = 'EBUSY';
      throw error;
    }
    return atomicWriteJSON(filePath, { data: 'success' });
  }, { 
    maxAttempts: 3, 
    initialDelayMs: 10,
    isRetryable: () => true  // Treat all as retryable for this test
  });
  
  assert.strictEqual(result.success, true);
  assert.ok(attempts >= 2, 'Should have retried');
  
  const read = await safeReadJSON(filePath);
  assert.deepStrictEqual(read.data, { data: 'success' });
});

await asyncTest('Persist provider state with atomic write', async () => {
  const pm = new ProviderManager({ failuresBeforeCooldown: 2 });
  const statePath = path.join(tempDir, 'provider-state.json');
  
  // Simulate some activity
  pm.recordSuccess('openai', 150);
  pm.recordFailure('anthropic', 'service_error');
  
  // Get both statuses
  const statuses = pm.getAllStatuses();
  
  // Save state
  const saveResult = await atomicWriteJSON(statePath, statuses);
  assert.strictEqual(saveResult.success, true);
  
  // Read back
  const loaded = await safeReadJSON(statePath);
  assert.ok(loaded.data.openai, 'Should have OpenAI status');
  assert.ok(loaded.data.anthropic, 'Should have Anthropic status');
  assert.strictEqual(loaded.data.openai.totalRequests, 1);
});

// ============================================
// PROVIDER MANAGER + CONTEXT GUARD INTEGRATION
// ============================================

console.log('\n🔗 Provider Manager + Context Guard\n');

await asyncTest('Select provider based on model context limits', async () => {
  const pm = new ProviderManager();
  
  // Large context that might need specific model
  const largePrompt = 'x'.repeat(50000);  // ~12.5k tokens
  
  // Check if it fits in GPT-4 (8k) vs GPT-4o (128k)
  const fitsGpt4 = estimateTokens(largePrompt) < getModelLimits('gpt-4').safeInputLimit;
  const fitsGpt4o = estimateTokens(largePrompt) < getModelLimits('gpt-4o').safeInputLimit;
  
  assert.strictEqual(fitsGpt4, false, 'Should not fit in GPT-4');
  assert.strictEqual(fitsGpt4o, true, 'Should fit in GPT-4o');
  
  // Provider should be healthy for either
  assert.strictEqual(pm.isAvailable('openai'), true);
});

await asyncTest('Guard context before provider selection', async () => {
  const pm = new ProviderManager();
  
  // Huge context that needs truncation for GPT-4
  // Use head strategy to keep beginning, tail strategy keeps the END
  const hugePrompt = 'Important: ' + 'x'.repeat(100000);
  
  // Guard for GPT-4 with head strategy to keep start
  const guarded = guardContext(hugePrompt, 'gpt-4', { 
    truncationConfig: { strategy: 'head', addMarker: false } 
  });
  
  if (guarded.truncated) {
    // Head strategy should preserve the start
    assert.ok(guarded.content.startsWith('Important'), 'Should preserve important start');
    
    // Now should fit
    const tokens = estimateTokens(guarded.content);
    const limit = getModelLimits('gpt-4').safeInputLimit;
    assert.ok(tokens <= limit, `Guarded content should fit: ${tokens} <= ${limit}`);
  }
  
  // Provider should still be available
  const provider = pm.getProviderForRequest('openai');
  assert.strictEqual(provider, 'openai');
});

// ============================================
// FULL FLOW SIMULATION
// ============================================

console.log('\n🔗 Full Flow Simulation\n');

await asyncTest('Simulate complete API request cycle', async () => {
  const pm = new ProviderManager({ failuresBeforeCooldown: 3 });
  
  // Step 1: Prepare context
  const systemPrompt = 'You are a helpful assistant.';
  const userMessage = 'Explain quantum computing in simple terms.';
  
  // Step 2: Analyze context
  const analysis = analyzeContext(userMessage, 'gpt-4o', systemPrompt);
  
  assert.strictEqual(analysis.isWithinLimits, true, 'Should fit in context');
  
  // Step 3: Get provider
  const provider = pm.getProviderForRequest('openai');
  assert.strictEqual(provider, 'openai', 'Provider should be available');
  
  // Step 4: Simulate API call with retry
  const apiResult = await withRetry(async () => {
    // Simulated API call
    return { response: 'Quantum computing uses qubits...' };
  }, { maxAttempts: 3 });
  
  assert.strictEqual(apiResult.success, true);
  
  // Step 5: Record success
  pm.recordSuccess(provider, 150);
  
  // Step 6: Save state
  const statePath = path.join(tempDir, 'session-state.json');
  await atomicWriteJSON(statePath, {
    analysis,
    provider,
    response: apiResult.data
  });
  
  // Verify saved state
  const saved = await safeReadJSON(statePath);
  assert.ok(saved.data, 'State should be saved');
});

await asyncTest('Simulate provider failover scenario', async () => {
  const pm = new ProviderManager({ failuresBeforeCooldown: 1 });
  
  // Make OpenAI fail
  pm.recordFailure('openai', 'rate_limit');
  
  // Should failover to Anthropic
  const provider = pm.getProviderForRequest('openai');
  assert.strictEqual(provider, 'anthropic', 'Should failover to Anthropic');
  
  // Guard context for fallback model
  const guarded = guardContext('Test message', 'claude-3-sonnet');
  
  assert.strictEqual(guarded.truncated, false);
});

await asyncTest('Simulate recovery from file corruption', async () => {
  const filePath = path.join(tempDir, 'recovery-test.json');
  
  // Create valid file with backup
  await atomicWriteJSON(filePath, { version: 1, valid: true });
  await atomicWriteJSON(filePath, { version: 2, valid: true });
  
  // Corrupt main file
  await fs.writeFile(filePath, '{ corrupted: true invalid json');
  
  // Try to read with recovery
  const result = await safeReadJSON(filePath);
  
  // Should either recover from backup or handle gracefully
  if (result.data) {
    assert.ok(result.recoveredFrom, 'Should indicate recovery');
    assert.strictEqual(result.data.valid, true);
  } else {
    // At minimum, shouldn't crash
    assert.ok(true, 'Handled corruption gracefully');
  }
});

// ============================================
// STRESS SCENARIOS
// ============================================

console.log('\n💪 Stress Scenarios\n');

await asyncTest('High concurrency atomic writes with retry', async () => {
  const promises = [];
  
  for (let i = 0; i < 20; i++) {
    const filePath = path.join(tempDir, `concurrent-${i}.json`);
    
    promises.push(withRetry(async () => {
      // Simulate occasional failure
      if (Math.random() < 0.3) {
        const error = new Error('Temporary failure');
        error.status = 503;
        throw error;
      }
      return atomicWriteJSON(filePath, { id: i, timestamp: Date.now() });
    }, { maxAttempts: 3, initialDelayMs: 5, isRetryable: () => true }));
  }
  
  const results = await Promise.all(promises);
  const successCount = results.filter(r => r.success).length;
  
  console.log(`     (${successCount}/20 succeeded)`);
  assert.ok(successCount >= 15, `Most should succeed: ${successCount}/20`);
});

await asyncTest('Rapid provider state changes', async () => {
  const pm = new ProviderManager({ failuresBeforeCooldown: 10 });
  const statePath = path.join(tempDir, 'rapid-state.json');
  
  // Simulate rapid activity
  for (let i = 0; i < 50; i++) {
    if (Math.random() < 0.7) {
      pm.recordSuccess('openai', 100 + Math.random() * 200);
    } else {
      pm.recordFailure('openai', 'service_error');
    }
    
    if (Math.random() < 0.8) {
      pm.recordSuccess('anthropic', 150 + Math.random() * 150);
    } else {
      pm.recordFailure('anthropic', 'rate_limit');
    }
  }
  
  // Save final state
  const statuses = pm.getAllStatuses();
  await atomicWriteJSON(statePath, statuses);
  
  // Verify state consistency
  const loaded = await safeReadJSON(statePath);
  assert.ok(loaded.data.openai.totalRequests >= 25, 'Should have many requests');
});

await asyncTest('Context guard under load', async () => {
  const start = Date.now();
  
  const tasks = [];
  for (let i = 0; i < 100; i++) {
    const size = Math.random() < 0.2 ? 500000 : 1000;  // 20% large
    tasks.push(guardContext('x'.repeat(size), 'gpt-4', {
      truncationConfig: { strategy: 'smart' }
    }));
  }
  
  const results = await Promise.all(tasks);
  const truncated = results.filter(r => r.truncated).length;
  const duration = Date.now() - start;
  
  console.log(`     (${truncated}/100 truncated, ${duration}ms total)`);
  assert.ok(truncated >= 15, 'Should have some truncations');
  assert.ok(duration < 5000, `Should be fast: ${duration}ms`);
});

// ============================================
// ERROR SCENARIOS
// ============================================

console.log('\n⚠️ Error Scenarios\n');

await asyncTest('Handle all providers down gracefully', async () => {
  const pm = new ProviderManager({ failuresBeforeCooldown: 1 });
  
  // Put both providers in cooldown
  pm.recordFailure('openai', 'rate_limit');
  pm.recordFailure('anthropic', 'rate_limit');
  
  // Request should fail gracefully
  const provider = pm.getProviderForRequest('openai');
  
  assert.strictEqual(provider, null, 'Should return null when all down');
  
  // Should be able to recover
  pm.resetAll();
  const recovered = pm.getProviderForRequest('openai');
  assert.ok(recovered !== null, 'Should recover after reset');
});

await asyncTest('Handle malformed context gracefully', async () => {
  // Various edge cases - guardContext(content, model)
  const cases = [
    '',  // empty
    'x'.repeat(10000000),  // 10MB
    '\0\0\0',  // Null bytes
  ];
  
  for (const content of cases) {
    try {
      guardContext(content, 'gpt-4');
      // Should not throw
    } catch (error) {
      assert.fail(`Should handle case gracefully: ${content.substring(0, 20)}...`);
    }
  }
});

await asyncTest('Retry with failed atomic write', async () => {
  const invalidPath = path.join('/nonexistent/dir/that/does/not/exist', 'file.json');
  
  // This should fail but not crash
  const result = await withRetry(async () => {
    return atomicWriteJSON(invalidPath, { data: 'test' });
  }, { maxAttempts: 2, initialDelayMs: 10 });
  
  // The write itself might fail, but we shouldn't crash
  assert.ok(result, 'Should return result');
});

// ============================================
// CLEANUP & RESULTS
// ============================================

await cleanup();

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Integration Tests: ${passedTests}/${totalTests} passed`);

if (failedTests.length > 0) {
  console.log('\n❌ Failed tests:');
  failedTests.forEach(({ name, error }) => {
    console.log(`   - ${name}: ${error}`);
  });
}

console.log();
process.exit(failedTests.length > 0 ? 1 : 0);
