/**
 * M7 v3.10 Context Guard - Comprehensive Test Scenarios
 * 
 * Tests:
 * - Token estimation
 * - Model limits
 * - Truncation strategies
 * - Context analysis
 * - Edge cases
 * 
 * Run: node tests/reliability/test-context-guard-scenarios.mjs
 */

import assert from 'assert';

const { 
  estimateTokens,
  getModelLimits,
  analyzeContext,
  guardContext,
  fitsInContext,
  getRemainingCapacity,
  formatAnalysis
} = await import('../../dist/hive/context/contextGuard.js');

const {
  MODEL_LIMITS,
  DEFAULT_MODEL_LIMITS
} = await import('../../dist/hive/context/types.js');

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

console.log('\n🧪 Context Guard Comprehensive Tests\n');
console.log('='.repeat(60));

// ============================================
// TOKEN ESTIMATION
// ============================================

console.log('\n🔢 Token Estimation\n');

test('Empty string returns 0 tokens', () => {
  assert.strictEqual(estimateTokens(''), 0);
  assert.strictEqual(estimateTokens(null), 0);
  assert.strictEqual(estimateTokens(undefined), 0);
});

test('Basic text estimation (~4 chars/token)', () => {
  // 20 chars ≈ 5 tokens
  const tokens = estimateTokens('Hello, how are you?');
  assert.ok(tokens >= 4 && tokens <= 8, `Expected 4-8 tokens, got ${tokens}`);
});

test('Long text estimation', () => {
  const text = 'x'.repeat(1000);
  const tokens = estimateTokens(text);
  
  // 1000 chars / 4 ≈ 250 tokens
  assert.ok(tokens >= 200 && tokens <= 300, `Expected ~250 tokens, got ${tokens}`);
});

test('Code blocks add extra tokens', () => {
  const plainText = 'function hello() { return "world"; }';
  const codeBlock = '```javascript\nfunction hello() { return "world"; }\n```';
  
  const plainTokens = estimateTokens(plainText);
  const codeTokens = estimateTokens(codeBlock);
  
  // Code block should have more tokens due to adjustment
  assert.ok(codeTokens > plainTokens, `Code block should have more tokens: ${codeTokens} vs ${plainTokens}`);
});

test('URLs add extra tokens', () => {
  const withUrl = 'Check out https://example.com/very/long/path/to/resource for more info.';
  const withoutUrl = 'Check out this link for more info.';
  
  const tokensWithUrl = estimateTokens(withUrl);
  const tokensWithoutUrl = estimateTokens(withoutUrl);
  
  assert.ok(tokensWithUrl > tokensWithoutUrl, 'URLs should add tokens');
});

test('Newlines counted', () => {
  const withNewlines = 'Line 1\nLine 2\nLine 3\nLine 4';
  const withoutNewlines = 'Line 1 Line 2 Line 3 Line 4';
  
  const tokensWithNl = estimateTokens(withNewlines);
  const tokensWithoutNl = estimateTokens(withoutNewlines);
  
  assert.ok(tokensWithNl >= tokensWithoutNl, 'Newlines should contribute to tokens');
});

test('Unicode text estimation', () => {
  const unicode = '你好世界 🎉🎉🎉 Привет мир';
  const tokens = estimateTokens(unicode);
  
  assert.ok(tokens > 0, 'Unicode should estimate tokens');
});

// ============================================
// MODEL LIMITS
// ============================================

console.log('\n📏 Model Limits\n');

test('Get GPT-4 limits', () => {
  const limits = getModelLimits('gpt-4');
  
  assert.ok(limits.maxContextTokens, 'Should have maxContextTokens');
  assert.ok(limits.maxOutputTokens, 'Should have maxOutputTokens');
  assert.ok(limits.safeInputLimit, 'Should have safeInputLimit');
});

test('Get GPT-4o limits', () => {
  const limits = getModelLimits('gpt-4o');
  
  // GPT-4o should have 128k context
  assert.ok(limits.maxContextTokens >= 100000, 'GPT-4o should have large context');
});

test('Get Claude limits', () => {
  const limits = getModelLimits('claude-3-sonnet');
  
  assert.ok(limits.maxContextTokens, 'Should have Claude limits');
});

test('Unknown model returns defaults with model name', () => {
  const limits = getModelLimits('unknown-model-xyz');
  
  // Should return default limits with model name
  assert.strictEqual(limits.model, 'unknown-model-xyz');
  assert.strictEqual(limits.maxContextTokens, DEFAULT_MODEL_LIMITS.maxContextTokens);
});

test('Prefix matching works', () => {
  const limits1 = getModelLimits('gpt-4o-2024-08-06');
  const limits2 = getModelLimits('gpt-4o');
  
  // Should get same limits via prefix match
  assert.strictEqual(limits1.maxContextTokens, limits2.maxContextTokens);
});

test('Safe input limit is less than max context', () => {
  for (const model of Object.keys(MODEL_LIMITS)) {
    const limits = MODEL_LIMITS[model];
    assert.ok(
      limits.safeInputLimit < limits.maxContextTokens,
      `${model}: safeInputLimit should be less than maxContextTokens`
    );
  }
});

// ============================================
// CONTEXT ANALYSIS
// ============================================

console.log('\n🔍 Context Analysis\n');

test('Analyze simple message', () => {
  const analysis = analyzeContext('Hello, how are you?', 'gpt-4o');
  
  assert.ok(analysis.totalTokens > 0, 'Should count tokens');
  assert.strictEqual(analysis.isWithinLimits, true, 'Simple message should fit');
});

test('Analyze with system prompt', () => {
  const analysis = analyzeContext(
    'What is 2+2?',
    'gpt-4o',
    'You are a helpful assistant.'
  );
  
  assert.ok(analysis.systemPromptTokens > 0, 'Should count system prompt');
  assert.ok(analysis.totalTokens > 0, 'Should have total tokens');
});

test('Analyze code content', () => {
  const content = '```javascript\nfunction foo() {}\n```';
  const analysis = analyzeContext(content, 'gpt-4o');
  
  assert.ok(analysis.codeTokens > 0, 'Should count code tokens');
});

test('Utilization percentage', () => {
  const analysis = analyzeContext('x'.repeat(4000), 'gpt-4o');  // ~1000 tokens
  
  assert.ok(analysis.utilizationPercent >= 0, 'Utilization should be >= 0');
  assert.ok(analysis.utilizationPercent <= 100, 'Utilization should be <= 100');
});

test('Large content exceeds limit', () => {
  const analysis = analyzeContext('x'.repeat(400000), 'gpt-4');  // ~100k tokens, gpt-4 is 8k
  
  assert.strictEqual(analysis.isWithinLimits, false, 'Large content should exceed limits');
  assert.ok(analysis.tokensOverLimit > 0, 'Should report tokens over limit');
});

// ============================================
// TRUNCATION STRATEGIES
// ============================================

console.log('\n✂️ Truncation Strategies\n');

test('Tail truncation (keep end, remove start)', () => {
  const content = 'x'.repeat(500000) + 'End';  // Will exceed gpt-4
  const result = guardContext(content, 'gpt-4', { 
    truncationConfig: { strategy: 'tail', addMarker: false } 
  });
  
  if (result.truncated) {
    // Tail truncation keeps the END (tail) of content
    assert.ok(result.content.endsWith('End'), 'Tail truncation should keep end');
    assert.ok(result.tokensRemoved > 0, 'Should have removed tokens');
  }
});

test('Head truncation (keep start, remove end)', () => {
  const content = 'Start' + 'x'.repeat(500000);
  const result = guardContext(content, 'gpt-4', { 
    truncationConfig: { strategy: 'head', addMarker: false } 
  });
  
  if (result.truncated) {
    // Head truncation keeps the HEAD (start) of content
    assert.ok(result.content.startsWith('Start'), 'Head truncation should keep start');
    assert.ok(result.tokensRemoved > 0, 'Should have removed tokens');
  }
});

test('Middle truncation (keep start and end)', () => {
  const content = 'START ' + 'x'.repeat(500000) + ' END';
  const result = guardContext(content, 'gpt-4', { 
    truncationConfig: { strategy: 'middle' } 
  });
  
  if (result.truncated) {
    assert.ok(result.content.includes('START'), 'Should keep start');
    assert.ok(result.content.includes('END'), 'Should keep end');
  }
});

test('Smart truncation processes content', () => {
  const structuredContent = `
# Introduction
This is the intro.

# Main Content
${'x'.repeat(500000)}

# Conclusion
This is important.
`;
  
  const result = guardContext(structuredContent, 'gpt-4', { 
    truncationConfig: { strategy: 'smart' } 
  });
  
  assert.ok(result.truncated, 'Should truncate large content');
  assert.ok(result.content.length > 0, 'Should have content');
});

test('No truncation when under limit', () => {
  const result = guardContext('Short message', 'gpt-4o');
  
  assert.strictEqual(result.truncated, false, 'Should not truncate small content');
  assert.strictEqual(result.content, 'Short message');
});

// ============================================
// HELPER FUNCTIONS
// ============================================

console.log('\n🛠️ Helper Functions\n');

test('fitsInContext - within limit', () => {
  const fits = fitsInContext('Hello world', 'gpt-4');
  assert.strictEqual(fits, true);
});

test('fitsInContext - exceeds limit', () => {
  const huge = 'x'.repeat(1000000);  // ~250k tokens
  const fits = fitsInContext(huge, 'gpt-4');  // 8k limit
  assert.strictEqual(fits, false);
});

test('getRemainingCapacity returns capacity info', () => {
  const result = getRemainingCapacity('Hello', 'gpt-4o');
  
  assert.ok(typeof result === 'object', 'Should return an object');
  assert.ok(typeof result.remaining === 'number', 'Should have remaining property');
  assert.ok(typeof result.percentUsed === 'number', 'Should have percentUsed property');
  assert.ok(result.remaining > 50000, `Should have lots of remaining capacity: ${result.remaining}`);
  assert.ok(result.percentUsed < 1, 'Should have low percent used');
});

test('formatAnalysis returns string', () => {
  const analysis = analyzeContext('Test message', 'gpt-4o');
  const formatted = formatAnalysis(analysis);
  
  assert.ok(typeof formatted === 'string', 'Should return string');
  assert.ok(formatted.length > 0, 'Should not be empty');
});

// ============================================
// EDGE CASES
// ============================================

console.log('\n🔬 Edge Cases\n');

test('Handle empty content', () => {
  const result = guardContext('', 'gpt-4o');
  
  assert.strictEqual(result.truncated, false);
  assert.strictEqual(result.content, '');
});

test('Very long code blocks', () => {
  const code = '```javascript\n' + 'console.log("x");\n'.repeat(10000) + '```';
  
  const result = guardContext(code, 'gpt-4', {
    truncationConfig: { strategy: 'smart' }
  });
  
  // Should handle without crashing
  assert.ok(result, 'Should handle long code blocks');
  assert.ok(result.content.length > 0, 'Should have content');
});

test('Multiple code blocks', () => {
  const content = `
\`\`\`python
def foo():
    pass
\`\`\`

Some text

\`\`\`javascript
function bar() {}
\`\`\`
`;
  
  const tokens = estimateTokens(content);
  assert.ok(tokens > 0, 'Should handle multiple code blocks');
});

test('Extreme nesting', () => {
  let nested = 'x';
  for (let i = 0; i < 100; i++) {
    nested = `{ data: ${nested} }`;
  }
  
  const tokens = estimateTokens(nested);
  assert.ok(tokens > 0, 'Should handle nested content');
});

test('Binary-like content', () => {
  const binary = Buffer.alloc(1000).toString('utf-8');
  
  const tokens = estimateTokens(binary);
  assert.ok(tokens >= 0, 'Should handle binary-like content');
});

// ============================================
// STRESS TEST
// ============================================

console.log('\n💪 Stress Test\n');

test('Many sequential analyses', () => {
  const start = Date.now();
  
  for (let i = 0; i < 1000; i++) {
    analyzeContext(`Message ${i}: ${'x'.repeat(100)}`, 'gpt-4o');
  }
  
  const duration = Date.now() - start;
  console.log(`     (1000 analyses in ${duration}ms)`);
  
  assert.ok(duration < 5000, `Should be fast, took ${duration}ms`);
});

test('Large content truncation performance', () => {
  const huge = 'x'.repeat(1000000);  // 1MB
  
  const start = Date.now();
  const result = guardContext(huge, 'gpt-4', {
    truncationConfig: { strategy: 'smart' }
  });
  const duration = Date.now() - start;
  
  console.log(`     (1MB truncation in ${duration}ms)`);
  
  assert.ok(result.truncated, 'Should truncate large content');
  assert.ok(duration < 1000, `Truncation should be fast, took ${duration}ms`);
});

// ============================================
// REAL-WORLD SCENARIOS
// ============================================

console.log('\n🌍 Real-World Scenarios\n');

test('Typical API call context', () => {
  const systemPrompt = 'You are a helpful coding assistant.';
  const userMessage = `
    I need help with this code:
    
    \`\`\`typescript
    function calculateSum(numbers: number[]): number {
      return numbers.reduce((a, b) => a + b, 0);
    }
    \`\`\`
    
    How can I optimize it?
  `;
  
  const analysis = analyzeContext(userMessage, 'gpt-4o', systemPrompt);
  
  assert.strictEqual(analysis.isWithinLimits, true);
  assert.ok(analysis.totalTokens < 500);
});

test('Large codebase context', () => {
  const codeFiles = [];
  for (let i = 0; i < 20; i++) {
    codeFiles.push(`// file${i}.ts\n${'console.log("line");\n'.repeat(50)}`);
  }
  
  const result = guardContext(
    codeFiles.join('\n\n'),
    'gpt-4',  // Smaller context
    { truncationConfig: { strategy: 'smart' } }
  );
  
  // Should either fit or truncate gracefully
  assert.ok(result.content, 'Should have content');
});

// ============================================
// RESULTS
// ============================================

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Context Guard Tests: ${passedTests}/${totalTests} passed`);

if (failedTests.length > 0) {
  console.log('\n❌ Failed tests:');
  failedTests.forEach(({ name, error }) => {
    console.log(`   - ${name}: ${error}`);
  });
}

console.log();
process.exit(failedTests.length > 0 ? 1 : 0);
