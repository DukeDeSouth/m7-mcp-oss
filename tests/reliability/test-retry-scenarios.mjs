/**
 * M7 v3.10 Retry System - Comprehensive Test Scenarios
 * 
 * Tests:
 * - Error classification
 * - Exponential backoff
 * - Jitter distribution
 * - Retry behavior
 * - Edge cases
 * 
 * Run: node tests/reliability/test-retry-scenarios.mjs
 */

import assert from 'assert';

const { 
  withRetry, 
  classifyError, 
  calculateDelay, 
  isRetryableError,
  formatRetryResult,
  DEFAULT_RETRY_CONFIG 
} = await import('../../dist/core/utils/retry.js');

// Test state
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

console.log('\n🧪 Retry System Comprehensive Tests\n');
console.log('='.repeat(60));

// ============================================
// ERROR CLASSIFICATION
// ============================================

console.log('\n🏷️ Error Classification\n');

test('Classify 429 as RATE_LIMIT', () => {
  const error = new Error('Too many requests');
  error.status = 429;
  
  const classified = classifyError(error);
  assert.strictEqual(classified.code, 'RATE_LIMIT');
  assert.strictEqual(classified.isRetryable, true);
});

test('Classify 503 as SERVICE_UNAVAILABLE', () => {
  const error = new Error('Service unavailable');
  error.status = 503;
  
  const classified = classifyError(error);
  assert.strictEqual(classified.code, 'SERVICE_UNAVAILABLE');
  assert.strictEqual(classified.isRetryable, true);
});

test('Classify 504 as GATEWAY_TIMEOUT', () => {
  const error = new Error('Gateway timeout');
  error.status = 504;
  
  const classified = classifyError(error);
  assert.strictEqual(classified.code, 'GATEWAY_TIMEOUT');
  assert.strictEqual(classified.isRetryable, true);
});

test('Classify 500 as INTERNAL_ERROR', () => {
  const error = new Error('Internal server error');
  error.status = 500;
  
  const classified = classifyError(error);
  assert.strictEqual(classified.code, 'INTERNAL_ERROR');
  assert.strictEqual(classified.isRetryable, true);
});

test('Classify 401 as AUTHENTICATION (not retryable)', () => {
  const error = new Error('Unauthorized');
  error.status = 401;
  
  const classified = classifyError(error);
  assert.strictEqual(classified.code, 'AUTHENTICATION');
  assert.strictEqual(classified.isRetryable, false);
});

test('Classify 403 as PERMISSION_DENIED (not retryable)', () => {
  const error = new Error('Forbidden');
  error.status = 403;
  
  const classified = classifyError(error);
  assert.strictEqual(classified.code, 'PERMISSION_DENIED');
  assert.strictEqual(classified.isRetryable, false);
});

test('Classify 400 as INVALID_REQUEST (not retryable)', () => {
  const error = new Error('Bad request');
  error.status = 400;
  
  const classified = classifyError(error);
  assert.strictEqual(classified.code, 'INVALID_REQUEST');
  assert.strictEqual(classified.isRetryable, false);
});

test('Classify ECONNRESET as CONNECTION_RESET', () => {
  const error = new Error('Connection reset');
  error.code = 'ECONNRESET';
  
  const classified = classifyError(error);
  assert.strictEqual(classified.code, 'CONNECTION_RESET');
  assert.strictEqual(classified.isRetryable, true);
});

test('Classify ETIMEDOUT as TIMEOUT', () => {
  const error = new Error('Connection timed out');
  error.code = 'ETIMEDOUT';
  
  const classified = classifyError(error);
  assert.strictEqual(classified.code, 'TIMEOUT');
  assert.strictEqual(classified.isRetryable, true);
});

test('Classify network error by code', () => {
  const error = new Error('Network request failed');
  error.code = 'ENOTFOUND';
  
  const classified = classifyError(error);
  assert.strictEqual(classified.code, 'NETWORK_ERROR');
  assert.strictEqual(classified.isRetryable, true);
});

test('Extract Retry-After header', () => {
  const error = new Error('Rate limited');
  error.status = 429;
  error.headers = { 'retry-after': '60' };
  
  const classified = classifyError(error);
  assert.strictEqual(classified.retryAfter, 60);
});

// ============================================
// DELAY CALCULATION
// ============================================

console.log('\n⏱️ Delay Calculation\n');

// Helper to create full config
const makeConfig = (overrides = {}) => ({
  ...DEFAULT_RETRY_CONFIG,
  ...overrides
});

test('Calculate base delay for attempt 0', () => {
  const delay = calculateDelay(0, makeConfig({ initialDelayMs: 1000, backoffMultiplier: 2, jitter: 0 }));
  assert.strictEqual(delay, 1000);
});

test('Calculate exponential delay for attempt 1', () => {
  const delay = calculateDelay(1, makeConfig({ initialDelayMs: 1000, backoffMultiplier: 2, jitter: 0 }));
  assert.strictEqual(delay, 2000);
});

test('Calculate exponential delay for attempt 2', () => {
  const delay = calculateDelay(2, makeConfig({ initialDelayMs: 1000, backoffMultiplier: 2, jitter: 0 }));
  assert.strictEqual(delay, 4000);
});

test('Respect maxDelayMs', () => {
  const delay = calculateDelay(10, makeConfig({ 
    initialDelayMs: 1000, 
    backoffMultiplier: 2, 
    maxDelayMs: 5000,
    jitter: 0 
  }));
  assert.strictEqual(delay, 5000);
});

test('Apply jitter (within range)', () => {
  const delays = [];
  for (let i = 0; i < 100; i++) {
    delays.push(calculateDelay(0, makeConfig({ initialDelayMs: 1000, backoffMultiplier: 2, jitter: 0.2 })));
  }
  
  const min = Math.min(...delays);
  const max = Math.max(...delays);
  
  // With 20% jitter, delays should be between 800-1200
  assert.ok(min >= 800, `Min delay ${min} should be >= 800`);
  assert.ok(max <= 1200, `Max delay ${max} should be <= 1200`);
});

test('Jitter distribution is varied', () => {
  const delays = new Set();
  for (let i = 0; i < 50; i++) {
    delays.add(calculateDelay(0, makeConfig({ initialDelayMs: 1000, backoffMultiplier: 2, jitter: 0.2 })));
  }
  
  // Should have multiple different values (not all same)
  assert.ok(delays.size > 10, `Should have varied delays, got ${delays.size} unique values`);
});

// ============================================
// RETRY BEHAVIOR
// ============================================

console.log('\n🔄 Retry Behavior\n');

await asyncTest('Succeed on first attempt', async () => {
  let attempts = 0;
  
  const result = await withRetry(async () => {
    attempts++;
    return 'success';
  }, { maxAttempts: 3 });
  
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.data, 'success');
  assert.strictEqual(result.attempts, 1);
  assert.strictEqual(attempts, 1);
});

await asyncTest('Succeed after retries', async () => {
  let attempts = 0;
  
  const result = await withRetry(async () => {
    attempts++;
    if (attempts < 3) {
      const error = new Error('Temporary failure');
      error.status = 503;
      throw error;
    }
    return 'success after retry';
  }, { maxAttempts: 5, initialDelayMs: 10 });
  
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.data, 'success after retry');
  assert.strictEqual(result.attempts, 3);
});

await asyncTest('Fail after max attempts', async () => {
  let attempts = 0;
  
  const result = await withRetry(async () => {
    attempts++;
    const error = new Error('Always fails');
    error.status = 503;
    throw error;
  }, { maxAttempts: 3, initialDelayMs: 10 });
  
  assert.strictEqual(result.success, false);
  assert.strictEqual(result.attempts, 3);
  assert.ok(result.error, 'Should have error info');
});

await asyncTest('Do not retry fatal errors', async () => {
  let attempts = 0;
  
  const result = await withRetry(async () => {
    attempts++;
    const error = new Error('Invalid API key');
    error.status = 401;
    throw error;
  }, { maxAttempts: 5, initialDelayMs: 10 });
  
  assert.strictEqual(result.success, false);
  assert.strictEqual(attempts, 1, 'Should not retry auth error');
});

await asyncTest('Use custom isRetryable function', async () => {
  let attempts = 0;
  
  const result = await withRetry(async () => {
    attempts++;
    throw new Error('Custom error that should retry');
  }, { 
    maxAttempts: 3, 
    initialDelayMs: 10,
    isRetryable: () => true  // Always retry
  });
  
  assert.strictEqual(result.success, false);
  assert.strictEqual(attempts, 3, 'Should retry with custom function');
});

await asyncTest('Call onRetry callback', async () => {
  const retryLog = [];
  
  await withRetry(async () => {
    const error = new Error('Fail');
    error.status = 503;
    throw error;
  }, { 
    maxAttempts: 3, 
    initialDelayMs: 10,
    onRetry: (attempt, error, delay) => {
      retryLog.push({ attempt, delay });
    }
  });
  
  // Should have called onRetry twice (before attempt 2 and 3)
  assert.strictEqual(retryLog.length, 2);
  assert.strictEqual(retryLog[0].attempt, 1);
  assert.strictEqual(retryLog[1].attempt, 2);
});

await asyncTest('Track total delay time', async () => {
  const start = Date.now();
  
  const result = await withRetry(async () => {
    const error = new Error('Fail');
    error.status = 503;
    throw error;
  }, { maxAttempts: 3, initialDelayMs: 50, backoffMultiplier: 2, jitter: 0 });
  
  const elapsed = Date.now() - start;
  
  // Should have delays: 50ms + 100ms = 150ms (plus execution time)
  assert.ok(elapsed >= 100, `Should wait at least 100ms, got ${elapsed}ms`);
  assert.ok(result.totalDelayMs >= 100, `totalDelayMs should be >= 100, got ${result.totalDelayMs}`);
});

// ============================================
// EDGE CASES
// ============================================

console.log('\n🔬 Edge Cases\n');

await asyncTest('Handle non-Error objects', async () => {
  const result = await withRetry(async () => {
    throw 'string error';
  }, { maxAttempts: 2, initialDelayMs: 10 });
  
  assert.strictEqual(result.success, false);
  assert.ok(result.error, 'Should capture error');
});

await asyncTest('Handle null/undefined throws', async () => {
  const result = await withRetry(async () => {
    throw null;
  }, { maxAttempts: 2, initialDelayMs: 10 });
  
  assert.strictEqual(result.success, false);
});

await asyncTest('Return async result', async () => {
  const result = await withRetry(async () => {
    await new Promise(r => setTimeout(r, 10));
    return { async: true };
  });
  
  assert.strictEqual(result.success, true);
  assert.deepStrictEqual(result.data, { async: true });
});

await asyncTest('Attempt history is recorded', async () => {
  let callNum = 0;
  
  const result = await withRetry(async () => {
    callNum++;
    if (callNum < 3) {
      const error = new Error(`Fail ${callNum}`);
      error.status = 503;
      throw error;
    }
    return 'done';
  }, { maxAttempts: 5, initialDelayMs: 10 });
  
  assert.ok(result.attemptHistory, 'Should have attempt history');
  assert.strictEqual(result.attemptHistory.length, 3);
  
  // First two should be failures
  assert.ok(result.attemptHistory[0].error, 'Attempt 1 should have error');
  assert.ok(result.attemptHistory[1].error, 'Attempt 2 should have error');
  
  // Last should not have error (success)
  assert.ok(!result.attemptHistory[2].error, 'Attempt 3 should not have error');
});

test('isRetryableError helper', () => {
  const retryable = new Error('Rate limit');
  retryable.status = 429;
  
  const fatal = new Error('Auth failed');
  fatal.status = 401;
  
  assert.strictEqual(isRetryableError(retryable), true);
  assert.strictEqual(isRetryableError(fatal), false);
});

test('formatRetryResult output', () => {
  const result = {
    success: true,
    data: 'test',
    attempts: 2,
    totalDelayMs: 500,
    attemptHistory: []
  };
  
  const formatted = formatRetryResult(result);
  assert.ok(formatted.includes('2'), 'Should include attempt count');
});

// ============================================
// STRESS TEST
// ============================================

console.log('\n💪 Stress Test\n');

await asyncTest('Many parallel retries', async () => {
  const promises = [];
  
  for (let i = 0; i < 20; i++) {
    promises.push(withRetry(async () => {
      if (Math.random() < 0.5) {
        const error = new Error('Random fail');
        error.status = 503;
        throw error;
      }
      return i;
    }, { maxAttempts: 3, initialDelayMs: 5 }));
  }
  
  const results = await Promise.all(promises);
  
  // Most should eventually succeed
  const successCount = results.filter(r => r.success).length;
  console.log(`     (${successCount}/20 succeeded)`);
  
  assert.ok(successCount > 10, 'Most parallel retries should succeed');
});

// ============================================
// RESULTS
// ============================================

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Retry System Tests: ${passedTests}/${totalTests} passed`);

if (failedTests.length > 0) {
  console.log('\n❌ Failed tests:');
  failedTests.forEach(({ name, error }) => {
    console.log(`   - ${name}: ${error}`);
  });
}

console.log();
process.exit(failedTests.length > 0 ? 1 : 0);
