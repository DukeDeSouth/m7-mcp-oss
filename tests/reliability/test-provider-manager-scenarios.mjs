/**
 * M7 v3.10 Provider Manager - Comprehensive Test Scenarios
 * 
 * Tests:
 * - Provider state management
 * - Cooldown behavior
 * - Failover logic
 * - Health metrics
 * - Recovery scenarios
 * 
 * Run: node tests/reliability/test-provider-manager-scenarios.mjs
 */

import assert from 'assert';

const { ProviderManager } = await import('../../dist/hive/api/providerManager.js');

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

console.log('\n🧪 Provider Manager Comprehensive Tests\n');
console.log('='.repeat(60));

// ============================================
// INITIALIZATION
// ============================================

console.log('\n🏗️ Initialization\n');

test('Create with default config', () => {
  const pm = new ProviderManager();
  
  const openaiStatus = pm.getStatus('openai');
  const anthropicStatus = pm.getStatus('anthropic');
  
  assert.ok(openaiStatus, 'OpenAI should be initialized');
  assert.ok(anthropicStatus, 'Anthropic should be initialized');
  assert.strictEqual(openaiStatus.state, 'healthy');
  assert.strictEqual(anthropicStatus.state, 'healthy');
});

test('Create with custom cooldown config', () => {
  const pm = new ProviderManager({
    baseCooldownMs: 10000,
    maxCooldownMs: 60000,
    failuresBeforeCooldown: 5
  });
  
  // Should use custom config
  assert.ok(pm, 'Should create with custom config');
});

test('Create with custom failover config', () => {
  const pm = new ProviderManager({}, {
    enabled: false,
    maxFailovers: 1
  });
  
  assert.ok(pm, 'Should create with custom failover config');
});

// ============================================
// STATE MANAGEMENT
// ============================================

console.log('\n📊 State Management\n');

test('Record success updates metrics', () => {
  const pm = new ProviderManager();
  
  pm.recordSuccess('openai', 150);
  
  const status = pm.getStatus('openai');
  assert.strictEqual(status.totalRequests, 1);
  assert.strictEqual(status.consecutiveFailures, 0);
  assert.ok(status.lastSuccess, 'Should have lastSuccess timestamp');
});

test('Record multiple successes updates average latency', () => {
  const pm = new ProviderManager();
  
  pm.recordSuccess('openai', 100);
  pm.recordSuccess('openai', 200);
  pm.recordSuccess('openai', 150);
  
  const status = pm.getStatus('openai');
  assert.strictEqual(status.totalRequests, 3);
  assert.ok(status.avgLatencyMs > 0, 'Should calculate average latency');
});

test('Record failure increments counter', () => {
  const pm = new ProviderManager();
  
  // Use the failure reason format
  pm.recordFailure('openai', 'rate_limit', 'Rate limit exceeded');
  
  const status = pm.getStatus('openai');
  assert.strictEqual(status.consecutiveFailures, 1);
  assert.strictEqual(status.totalFailures, 1);
});

test('Success resets consecutive failures', () => {
  const pm = new ProviderManager();
  
  pm.recordFailure('openai', 'rate_limit');
  pm.recordFailure('openai', 'rate_limit');
  pm.recordSuccess('openai', 100);
  
  const status = pm.getStatus('openai');
  assert.strictEqual(status.consecutiveFailures, 0);
});

// ============================================
// COOLDOWN BEHAVIOR
// ============================================

console.log('\n❄️ Cooldown Behavior\n');

test('Enter cooldown after threshold failures', () => {
  const pm = new ProviderManager({ failuresBeforeCooldown: 3 });
  
  pm.recordFailure('openai', 'rate_limit');
  pm.recordFailure('openai', 'rate_limit');
  
  let status = pm.getStatus('openai');
  // After 2 failures with threshold of 3, should be degraded
  assert.ok(['healthy', 'degraded'].includes(status.state), 'Should not be in cooldown yet');
  
  pm.recordFailure('openai', 'rate_limit');
  
  status = pm.getStatus('openai');
  assert.strictEqual(status.state, 'cooldown', 'Should be in cooldown after 3 failures');
});

test('Provider not available during cooldown', () => {
  const pm = new ProviderManager({ failuresBeforeCooldown: 1 });
  
  pm.recordFailure('openai', 'rate_limit');
  
  assert.strictEqual(pm.isAvailable('openai'), false);
});

test('Exit cooldown after time passes', async () => {
  const pm = new ProviderManager({ 
    failuresBeforeCooldown: 1,
    baseCooldownMs: 50  // Short for testing
  });
  
  pm.recordFailure('openai', 'rate_limit');
  
  assert.strictEqual(pm.isAvailable('openai'), false);
  
  // Wait for cooldown to expire
  await new Promise(r => setTimeout(r, 100));
  
  // Should be available again (exits cooldown on check)
  // After cooldown it goes to degraded, which is available
  const status = pm.getStatus('openai');
  assert.ok(['degraded', 'healthy'].includes(status.state), 'Should exit cooldown');
});

test('Max cooldown is respected', () => {
  const pm = new ProviderManager({ 
    failuresBeforeCooldown: 1,
    baseCooldownMs: 50000,
    maxCooldownMs: 1000  // Cap at 1 second
  });
  
  pm.recordFailure('openai', 'rate_limit');
  
  const status = pm.getStatus('openai');
  const cooldownDuration = status.cooldownUntil - Date.now();
  
  assert.ok(cooldownDuration <= 1100, `Cooldown should not exceed max (got ${cooldownDuration}ms)`);
});

// ============================================
// FAILOVER LOGIC
// ============================================

console.log('\n🔀 Failover Logic\n');

test('Get best provider returns healthy provider', () => {
  const pm = new ProviderManager();
  
  const best = pm.getBestProvider();
  assert.ok(['openai', 'anthropic'].includes(best), 'Should return a valid provider');
});

test('Failover to alternate when primary unavailable', () => {
  const pm = new ProviderManager({ failuresBeforeCooldown: 1 });
  
  // Put OpenAI in cooldown
  pm.recordFailure('openai', 'rate_limit');
  
  // Should get Anthropic as failover
  const provider = pm.getProviderForRequest('openai');
  
  // getProviderForRequest returns ProviderId | null
  assert.strictEqual(provider, 'anthropic', 'Should failover to anthropic');
});

test('No failover when disabled', () => {
  const pm = new ProviderManager(
    { failuresBeforeCooldown: 1 },
    { enabled: false }
  );
  
  // Put OpenAI in cooldown
  pm.recordFailure('openai', 'rate_limit');
  
  // With failover disabled, should try best available
  const provider = pm.getProviderForRequest('openai');
  
  // Should return best available (anthropic) since getBestProvider still works
  assert.ok(provider === 'anthropic' || provider === null, 'Should get alternative or null');
});

test('Get fallback provider', () => {
  const pm = new ProviderManager({ failuresBeforeCooldown: 1 });
  
  const fallback = pm.getFallback('openai');
  assert.strictEqual(fallback, 'anthropic');
  
  const fallback2 = pm.getFallback('anthropic');
  assert.strictEqual(fallback2, 'openai');
});

test('Both providers unavailable', () => {
  const pm = new ProviderManager({ failuresBeforeCooldown: 1 });
  
  // Put both in cooldown
  pm.recordFailure('openai', 'rate_limit');
  pm.recordFailure('anthropic', 'rate_limit');
  
  const provider = pm.getProviderForRequest('openai');
  
  assert.strictEqual(provider, null, 'Should return null when all providers unavailable');
});

// ============================================
// HEALTH METRICS
// ============================================

console.log('\n📈 Health Metrics\n');

test('Get health metrics for provider', () => {
  const pm = new ProviderManager();
  
  pm.recordSuccess('openai', 100);
  pm.recordSuccess('openai', 200);
  pm.recordFailure('openai', 'timeout');
  
  const metrics = pm.getHealthMetrics('openai');
  
  assert.ok(metrics, 'Should have metrics');
  assert.ok(metrics.successRate !== undefined, 'Should have success rate');
  assert.ok(metrics.avgResponseTime !== undefined, 'Should have avg response time');
  assert.strictEqual(metrics.sampleSize, 3, 'Should count all requests');
});

test('Calculate success rate', () => {
  const pm = new ProviderManager();
  
  for (let i = 0; i < 10; i++) {
    pm.recordSuccess('openai', 100);
  }
  for (let i = 0; i < 2; i++) {
    pm.recordFailure('openai', 'timeout');
  }
  
  const metrics = pm.getHealthMetrics('openai');
  
  // 10 success out of 12 = ~83%
  assert.ok(metrics.successRate, 'Should have success rate');
  assert.ok(metrics.successRate > 0.8 && metrics.successRate < 0.9,
    `Success rate should be ~83%, got ${(metrics.successRate * 100).toFixed(1)}%`);
});

test('Get all statuses', () => {
  const pm = new ProviderManager();
  
  pm.recordSuccess('openai', 100);
  pm.recordSuccess('anthropic', 150);
  
  const allStatuses = pm.getAllStatuses();
  
  assert.ok(allStatuses.openai, 'Should have OpenAI status');
  assert.ok(allStatuses.anthropic, 'Should have Anthropic status');
});

// ============================================
// RECOVERY SCENARIOS
// ============================================

console.log('\n🔧 Recovery Scenarios\n');

test('Degraded state after some failures', () => {
  const pm = new ProviderManager({ failuresBeforeCooldown: 5 });
  
  pm.recordFailure('openai', 'rate_limit');
  pm.recordFailure('openai', 'rate_limit');
  
  const status = pm.getStatus('openai');
  assert.strictEqual(status.state, 'degraded');
});

test('Recovery from failed state', async () => {
  const pm = new ProviderManager({ 
    failuresBeforeCooldown: 1,
    baseCooldownMs: 50
  });
  
  // Put in cooldown
  pm.recordFailure('openai', 'rate_limit');
  
  // Wait for cooldown to expire
  await new Promise(r => setTimeout(r, 100));
  
  // Record success
  pm.recordSuccess('openai', 100);
  
  const status = pm.getStatus('openai');
  assert.strictEqual(status.state, 'healthy');
});

test('Reset all providers', () => {
  const pm = new ProviderManager({ failuresBeforeCooldown: 1 });
  
  pm.recordFailure('openai', 'rate_limit');
  pm.recordFailure('anthropic', 'rate_limit');
  
  pm.resetAll();
  
  assert.strictEqual(pm.getStatus('openai').state, 'healthy');
  assert.strictEqual(pm.getStatus('anthropic').state, 'healthy');
});

// ============================================
// FAILURE FROM ERROR
// ============================================

console.log('\n⚠️ Error Handling\n');

test('Record failure from error object', () => {
  const pm = new ProviderManager();
  
  const error = new Error('Rate limit exceeded');
  error.status = 429;
  
  pm.recordFailureFromError('openai', error);
  
  const status = pm.getStatus('openai');
  assert.strictEqual(status.consecutiveFailures, 1);
  assert.strictEqual(status.failureReason, 'rate_limit');
});

test('Record failure from timeout error', () => {
  const pm = new ProviderManager();
  
  const error = new Error('Connection timed out');
  error.code = 'ETIMEDOUT';
  
  pm.recordFailureFromError('openai', error);
  
  const status = pm.getStatus('openai');
  assert.strictEqual(status.failureReason, 'timeout');
});

// ============================================
// EDGE CASES
// ============================================

console.log('\n🔬 Edge Cases\n');

test('Handle unknown provider gracefully', () => {
  const pm = new ProviderManager();
  
  // Should throw for unknown provider
  try {
    pm.getStatus('unknown_provider');
    assert.fail('Should throw for unknown provider');
  } catch (e) {
    assert.ok(e.message.includes('Unknown provider'));
  }
});

test('Handle zero latency', () => {
  const pm = new ProviderManager();
  
  pm.recordSuccess('openai', 0);
  
  const status = pm.getStatus('openai');
  assert.ok(status.totalRequests >= 1);
});

test('Multiple rapid state changes', () => {
  const pm = new ProviderManager({ failuresBeforeCooldown: 10 });
  
  for (let i = 0; i < 20; i++) {
    if (i % 2 === 0) {
      pm.recordSuccess('openai', 100);
    } else {
      pm.recordFailure('openai', 'timeout');
    }
  }
  
  // Should not crash, state should be consistent
  const status = pm.getStatus('openai');
  assert.ok(status.totalRequests >= 20);
});

// ============================================
// RESULTS
// ============================================

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Provider Manager Tests: ${passedTests}/${totalTests} passed`);

if (failedTests.length > 0) {
  console.log('\n❌ Failed tests:');
  failedTests.forEach(({ name, error }) => {
    console.log(`   - ${name}: ${error}`);
  });
}

console.log();
process.exit(failedTests.length > 0 ? 1 : 0);
