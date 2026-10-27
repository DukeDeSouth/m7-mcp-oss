/**
 * Control channel integrity tests (Sprint 7)
 * Run: npm run build && node tests/controlChannel.test.mjs
 */
import assert from 'node:assert/strict';

const {
  CONTROL_CHANNEL_NOTICE,
  extractGateInstructionId,
  formatGateIdBlock,
  generateGateInstructionId,
  validateGateInstructionId,
} = await import('../dist/core/orchestrator/controlChannel.js');

console.log('controlChannel tests');

const id = generateGateInstructionId();
assert.ok(/^gate_\d+_[a-z0-9]+$/.test(id), `unexpected id format: ${id}`);

const block = formatGateIdBlock(id);
assert.ok(block.includes(`## Gate-ID: ${id}`));
assert.ok(block.includes('gate_instruction_id'));

const fromBlock = extractGateInstructionId(block);
assert.equal(fromBlock, id);

const jsonReflection = `\`\`\`json\n${JSON.stringify({
  gate_instruction_id: id,
  decision: 'continue',
  summary: 'ok',
})}\n\`\`\``;
assert.equal(extractGateInstructionId(jsonReflection), id);

assert.deepEqual(validateGateInstructionId(undefined, '{}'), { valid: true });
assert.deepEqual(validateGateInstructionId('gate_old', jsonReflection), {
  valid: false,
  error: `gate_instruction_id mismatch: expected gate_old, got ${id}`,
});

const missing = validateGateInstructionId(id, '{"decision":"continue"}');
assert.equal(missing.valid, false);
assert.equal(missing.error, 'missing gate_instruction_id');

assert.equal(validateGateInstructionId(id, jsonReflection).valid, true);
assert.ok(CONTROL_CHANNEL_NOTICE.includes('mcp_m7_cycle'));

console.log('controlChannel tests: OK');
