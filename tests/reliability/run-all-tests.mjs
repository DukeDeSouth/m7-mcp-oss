#!/usr/bin/env node

/**
 * M7 v3.10 Reliability MVP - Complete Test Suite Runner
 * 
 * Runs all tests for:
 * - Atomic Write
 * - Retry System
 * - Provider Manager
 * - Context Guard
 * - Integration Tests
 * 
 * Run: node tests/reliability/run-all-tests.mjs
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const tests = [
  { name: 'Atomic Write', file: 'test-atomic-write-scenarios.mjs' },
  { name: 'Retry System', file: 'test-retry-scenarios.mjs' },
  { name: 'Provider Manager', file: 'test-provider-manager-scenarios.mjs' },
  { name: 'Context Guard', file: 'test-context-guard-scenarios.mjs' },
  { name: 'Integration', file: 'test-integration-scenarios.mjs' },
];

const results = [];

console.log(`
╔══════════════════════════════════════════════════════════════╗
║  M7 v3.10 Reliability MVP - Complete Test Suite              ║
╚══════════════════════════════════════════════════════════════╝
`);

async function runTest(test) {
  return new Promise((resolve) => {
    const testPath = path.join(__dirname, test.file);
    const start = Date.now();
    
    console.log(`\n🚀 Running: ${test.name}`);
    console.log('━'.repeat(60));
    
    const child = spawn('node', [testPath], {
      cwd: path.join(__dirname, '..', '..'),
      stdio: 'inherit'
    });
    
    child.on('close', (code) => {
      const duration = Date.now() - start;
      results.push({
        name: test.name,
        passed: code === 0,
        duration,
        exitCode: code
      });
      resolve();
    });
    
    child.on('error', (err) => {
      console.error(`Error running ${test.name}: ${err.message}`);
      results.push({
        name: test.name,
        passed: false,
        duration: Date.now() - start,
        error: err.message
      });
      resolve();
    });
  });
}

// Run all tests sequentially
const startTime = Date.now();

for (const test of tests) {
  await runTest(test);
}

const totalDuration = Date.now() - startTime;

// Summary
console.log(`
╔══════════════════════════════════════════════════════════════╗
║  TEST RESULTS SUMMARY                                        ║
╚══════════════════════════════════════════════════════════════╝
`);

const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;

results.forEach(r => {
  const icon = r.passed ? '✅' : '❌';
  const time = `${(r.duration / 1000).toFixed(1)}s`;
  console.log(`  ${icon} ${r.name.padEnd(20)} ${time.padStart(8)}`);
});

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Total: ${results.length} suites
  Passed: ${passed}
  Failed: ${failed}
  Duration: ${(totalDuration / 1000).toFixed(1)}s
`);

if (failed > 0) {
  console.log('❌ SOME TESTS FAILED\n');
  
  console.log('Failed suites:');
  results.filter(r => !r.passed).forEach(r => {
    console.log(`  - ${r.name}${r.error ? `: ${r.error}` : ''}`);
  });
  console.log();
  
  process.exit(1);
} else {
  console.log('✅ ALL TESTS PASSED\n');
  process.exit(0);
}
