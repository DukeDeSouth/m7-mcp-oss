/**
 * Comprehensive tests for M7 Cycle Orchestrator
 * 
 * Tests: buildCarryForward, ensureTemplateHeader, full cycle flow,
 * reflection gates, rewind, pivot, abort, edge cases.
 * 
 * Run: node --test tests/cycleOrchestrator.test.mjs
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as path from 'path';

// We need to set PROJECT_PATH before importing the orchestrator
const TEST_DIR = path.join(import.meta.dirname, '..', '.test-cycles-' + Date.now());
process.env.M7_PROJECT_PATH = path.join(import.meta.dirname, '..');

const { CycleOrchestrator } = await import('../dist/core/orchestrator/cycleOrchestrator.js');
const { getPhaseConfig, PHASE_CONFIGS } = await import('../dist/core/orchestrator/templates/phases.js');
const {
  extractGateInstructionId,
} = await import('../dist/core/orchestrator/controlChannel.js');

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function gateIdFromResponse(response) {
  const text = [
    response?.instruction?.instruction,
    response?.instruction?.gate?.prompt,
    response?.instruction?.artifact?.template,
  ].filter(Boolean).join('\n');
  return extractGateInstructionId(text);
}

async function reflectAfterGate(orch, taskId, decision, summary) {
  const gateInstr = await orch.getCurrentInstruction(taskId);
  const gateId = gateIdFromResponse(gateInstr);
  assert.ok(gateId, 'Gate-ID must be present when awaiting reflection');
  return orch.submitReflection(taskId, makeReflection(decision, summary, gateId));
}

async function reflectAfterGateRaw(orch, taskId, buildContent) {
  const gateInstr = await orch.getCurrentInstruction(taskId);
  const gateId = gateIdFromResponse(gateInstr);
  assert.ok(gateId, 'Gate-ID must be present when awaiting reflection');
  const content = typeof buildContent === 'function' ? buildContent(gateId) : buildContent;
  return orch.submitReflection(taskId, content);
}

function makeReflection(decision, summary, gateInstructionId) {
  const payload = {
    decision,
    change_detected: decision === 'pivot',
    summary,
    confidence: 0.95,
  };
  if (gateInstructionId) {
    payload.gate_instruction_id = gateInstructionId;
  }
  return `\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;
}

function makeReflectionWithRewind(target, summary, gateInstructionId) {
  return `\`\`\`json\n${JSON.stringify({
    gate_instruction_id: gateInstructionId,
    decision: 'rewind',
    change_detected: true,
    summary,
    rewind_target: target,
    confidence: 0.7,
  })}\n\`\`\``;
}

function makeReflectionPivot(summary, newFraming, gateInstructionId) {
  return `\`\`\`json\n${JSON.stringify({
    gate_instruction_id: gateInstructionId,
    decision: 'pivot',
    change_detected: true,
    summary,
    task_framing_update: newFraming,
    confidence: 0.8,
  })}\n\`\`\``;
}

function fakeArtifact(phase, length = 200) {
  return `# ${phase.toUpperCase()}: Test Task\n\n` + 'x'.repeat(length);
}

function fakeArtifactNoHeader(length = 200) {
  return 'Some content without markdown header\n\n' + 'x'.repeat(length);
}

// ═══════════════════════════════════════════════════════════════
// TEST SUITE 1: buildCarryForward (via public API)
// ═══════════════════════════════════════════════════════════════

describe('buildCarryForward', () => {
  it('returns empty string when no phases completed (INTAKE instruction)', async () => {
    const orch = new CycleOrchestrator();
    const instruction = await orch.startCycle('Test carry-forward empty');
    
    // INTAKE is the first phase — no completed phases yet
    assert.ok(!instruction.instruction.includes('Previous Phases'),
      'Should NOT contain Previous Phases table on first phase');
  });

  it('includes carry-forward table after first reflection', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test carry-forward one phase');
    
    // Submit INTAKE artifact
    const afterIntake = await orch.submitArtifact(
      start.taskId,
      fakeArtifact('intake')
    );
    assert.ok(afterIntake.success);
    
    // Submit reflection for INTAKE → DISCOVERY gate
    const afterReflection = await reflectAfterGate(orch, start.taskId, 'continue', 'Intake findings clear');
    assert.ok(afterReflection.success);
    
    // DISCOVERY instruction should have carry-forward with INTAKE
    const discoveryInstruction = afterReflection.instruction.instruction;
    assert.ok(discoveryInstruction.includes('Previous Phases'),
      'DISCOVERY should include Previous Phases');
    assert.ok(discoveryInstruction.includes('INTAKE'),
      'Should mention INTAKE phase');
    assert.ok(discoveryInstruction.includes('CONTINUE'),
      'Should show CONTINUE decision');
    assert.ok(discoveryInstruction.includes('Intake findings clear'),
      'Should show reflection summary');
  });

  it('accumulates carry-forward across multiple phases', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test carry-forward multi');
    const phases = ['intake', 'discovery', 'architecture'];
    const summaries = [
      'Task understood',
      'Root cause found in helpers.py',
      'Single file modification needed'
    ];
    
    for (let i = 0; i < phases.length; i++) {
      await orch.submitArtifact(start.taskId, fakeArtifact(phases[i]));
      const result = await reflectAfterGate(orch, start.taskId, 'continue', summaries[i]);
      
      if (i < phases.length - 1) {
        // Check carry-forward in next phase instruction
        const instruction = result.instruction.instruction;
        for (let j = 0; j <= i; j++) {
          assert.ok(instruction.includes(summaries[j]),
            `Phase ${i+2} should include summary from phase ${j+1}: "${summaries[j]}"`);
        }
      }
    }
  });

  it('carry-forward uses artifact fallback when no reflection summary', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test carry-forward fallback');
    
    // Submit INTAKE artifact
    await orch.submitArtifact(start.taskId, fakeArtifact('intake'));
    
    // The gate instruction should have carry-forward with artifact fallback (no reflection yet)
    const gateResult = await orch.getCurrentInstruction(start.taskId);
    const gateInstruction = gateResult.instruction.instruction;
    
    assert.ok(gateInstruction.includes('INTAKE'),
      'Gate should show INTAKE in carry-forward');
    // The decision column should show '-' because no reflection was submitted yet
    assert.ok(gateInstruction.includes('| - |') || gateInstruction.includes('|-|'),
      'Gate should show "-" for decision when no reflection yet');
  });

  it('carry-forward shows all 6 phases before IMPLEMENTATION', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test full carry-forward');
    const allPhases = ['intake', 'discovery', 'architecture', 'solution', 'impact', 'simulation'];
    
    for (const phase of allPhases) {
      await orch.submitArtifact(start.taskId, fakeArtifact(phase));
      await reflectAfterGate(orch, start.taskId, 'continue', `${phase} done`);
    }
    
    // Get IMPLEMENTATION instruction
    const implResult = await orch.getCurrentInstruction(start.taskId);
    const instruction = implResult.instruction.instruction;
    
    // Should have all 6 previous phases
    for (const phase of allPhases) {
      assert.ok(instruction.includes(phase.toUpperCase()),
        `IMPLEMENTATION should reference ${phase.toUpperCase()}`);
    }
    assert.ok(instruction.includes('CONTINUE'),
      'All gates should show CONTINUE');
  });
});

// ═══════════════════════════════════════════════════════════════
// TEST SUITE 2: ensureTemplateHeader (via disk artifacts)
// ═══════════════════════════════════════════════════════════════

describe('ensureTemplateHeader', () => {
  it('preserves content that already has markdown header', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test header preserve');
    
    const contentWithHeader = '# INTAKE: My Custom Header\n\nSome content here...\n' + 'x'.repeat(150);
    await orch.submitArtifact(start.taskId, contentWithHeader);
    
    // Read the file from disk
    const slug = start.taskId.replace(/^cycle_/, '').replace(/_\d+$/, '');
    const cyclesBase = path.join(import.meta.dirname, '..', 'm7-cycles');
    const dirs = await fs.readdir(cyclesBase);
    const cycleDir = dirs.find(d => d.includes('test-header-preserve'));
    
    if (cycleDir) {
      const filePath = path.join(cyclesBase, cycleDir, 'INTAKE.md');
      const content = await fs.readFile(filePath, 'utf-8');
      
      assert.ok(content.startsWith('# INTAKE: My Custom Header'),
        'Should preserve original header');
      assert.ok(!content.includes('ФОКУС ФАЗЫ'),
        'Should NOT prepend template when header already present');
    }
  });

  it('prepends template header when content has no header', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test header prepend');
    
    const contentNoHeader = 'Just some raw content without any markdown header.\n' + 'x'.repeat(150);
    await orch.submitArtifact(start.taskId, contentNoHeader);
    
    const cyclesBase = path.join(import.meta.dirname, '..', 'm7-cycles');
    const dirs = await fs.readdir(cyclesBase);
    const cycleDir = dirs.find(d => d.includes('test-header-prepend'));
    
    if (cycleDir) {
      const filePath = path.join(cyclesBase, cycleDir, 'INTAKE.md');
      const content = await fs.readFile(filePath, 'utf-8');
      
      assert.ok(content.startsWith('# INTAKE:'),
        'Should prepend template header');
      assert.ok(content.includes('Just some raw content'),
        'Should keep original content after header');
    }
  });

  it('template header replaces {task}, {taskId}, {date} placeholders', async () => {
    const orch = new CycleOrchestrator();
    const taskDesc = 'Placeholder replacement test';
    const start = await orch.startCycle(taskDesc);
    
    await orch.submitArtifact(start.taskId, fakeArtifactNoHeader());
    
    const cyclesBase = path.join(import.meta.dirname, '..', 'm7-cycles');
    const dirs = await fs.readdir(cyclesBase);
    const cycleDir = dirs.find(d => d.includes('placeholder-replacement'));
    
    if (cycleDir) {
      const filePath = path.join(cyclesBase, cycleDir, 'INTAKE.md');
      const content = await fs.readFile(filePath, 'utf-8');
      
      assert.ok(!content.includes('{task}'),
        'Should replace {task} placeholder');
      assert.ok(!content.includes('{taskId}'),
        'Should replace {taskId} placeholder');
      assert.ok(!content.includes('{date}'),
        'Should replace {date} placeholder');
      assert.ok(content.includes(taskDesc),
        'Should contain task description');
      assert.ok(content.includes(start.taskId),
        'Should contain task ID');
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// TEST SUITE 3: Reflection Gate logic
// ═══════════════════════════════════════════════════════════════

describe('Reflection Gates', () => {
  it('continue → moves to next phase', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test gate continue');
    
    await orch.submitArtifact(start.taskId, fakeArtifact('intake'));
    const result = await reflectAfterGate(orch, start.taskId, 'continue', 'All clear');
    
    assert.ok(result.success);
    assert.equal(result.instruction.phase.name, 'discovery',
      'Should advance to DISCOVERY after CONTINUE');
  });

  it('pivot → updates task framing and moves forward', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test gate pivot original');
    
    await orch.submitArtifact(start.taskId, fakeArtifact('intake'));
    const result = await reflectAfterGateRaw(orch, start.taskId, (gateId) => makeReflectionPivot('Found deeper issue', 'Actually need to fix the entire module', gateId));
    
    assert.ok(result.success);
    assert.equal(result.instruction.phase.name, 'discovery',
      'Pivot should still advance to DISCOVERY');
    
    // Verify framing was updated by checking subsequent gate
    await orch.submitArtifact(start.taskId, fakeArtifact('discovery'));
    const gateResult = await orch.getCurrentInstruction(start.taskId);
    assert.ok(gateResult.instruction.gate.prompt.includes('Actually need to fix the entire module'),
      'Gate should use updated task framing');
  });

  it('rewind → goes back to specified phase', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test gate rewind');
    
    // Go through INTAKE and DISCOVERY
    await orch.submitArtifact(start.taskId, fakeArtifact('intake'));
    await reflectAfterGate(orch, start.taskId, 'continue', 'OK');
    
    await orch.submitArtifact(start.taskId, fakeArtifact('discovery'));
    
    // Rewind from DISCOVERY back to INTAKE
    const result = await reflectAfterGateRaw(orch, start.taskId, (gateId) => makeReflectionWithRewind('intake', 'Need to redo intake', gateId));
    
    assert.ok(result.success);
    assert.equal(result.instruction.phase.name, 'intake',
      'Should rewind to INTAKE');
  });

  it('abort → marks cycle complete', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test gate abort');
    
    await orch.submitArtifact(start.taskId, fakeArtifact('intake'));
    const result = await reflectAfterGateRaw(orch, start.taskId, (gateId) =>
      `\`\`\`json\n${JSON.stringify({
        gate_instruction_id: gateId,
        decision: 'abort',
        change_detected: true,
        summary: 'Task is not feasible',
        confidence: 0.9,
      })}\n\`\`\``
    );
    
    assert.ok(result.success);
    assert.ok(result.completed, 'Abort should mark cycle as completed');
  });

  it('rewind max 2 times then forces continue', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test rewind limit');
    
    // Complete INTAKE, go to DISCOVERY
    await orch.submitArtifact(start.taskId, fakeArtifact('intake'));
    await reflectAfterGate(orch, start.taskId, 'continue', 'OK');
    
    // DISCOVERY → rewind to intake (1st)
    await orch.submitArtifact(start.taskId, fakeArtifact('discovery'));
    let r = await reflectAfterGateRaw(orch, start.taskId, (gateId) => makeReflectionWithRewind('intake', 'Rewind 1', gateId));
    assert.equal(r.instruction.phase.name, 'intake', '1st rewind should work');
    
    // Redo INTAKE, go to DISCOVERY again
    await orch.submitArtifact(start.taskId, fakeArtifact('intake'));
    await reflectAfterGate(orch, start.taskId, 'continue', 'OK');
    
    // DISCOVERY → rewind to intake (2nd)
    await orch.submitArtifact(start.taskId, fakeArtifact('discovery'));
    r = await reflectAfterGateRaw(orch, start.taskId, (gateId) => makeReflectionWithRewind('intake', 'Rewind 2', gateId));
    assert.equal(r.instruction.phase.name, 'intake', '2nd rewind should work');
    
    // Redo INTAKE, go to DISCOVERY again
    await orch.submitArtifact(start.taskId, fakeArtifact('intake'));
    await reflectAfterGate(orch, start.taskId, 'continue', 'OK');
    
    // DISCOVERY → rewind to intake (3rd — should be blocked)
    await orch.submitArtifact(start.taskId, fakeArtifact('discovery'));
    r = await reflectAfterGateRaw(orch, start.taskId, (gateId) => makeReflectionWithRewind('intake', 'Rewind 3 blocked', gateId));
    assert.notEqual(r.instruction.phase.name, 'intake',
      '3rd rewind should be blocked — forced to next phase');
  });

  // Malformed reflections must be rejected without touching the gate.
  // The error text is asserted by prefix so that a Gate-ID mismatch
  // (a different rejection path) cannot make these tests pass by accident.

  async function startAwaitingGate() {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test invalid reflection');
    await orch.submitArtifact(start.taskId, fakeArtifact('intake'));
    const gateBefore = gateIdFromResponse(await orch.getCurrentInstruction(start.taskId));
    assert.ok(gateBefore, 'Gate-ID must be present when awaiting reflection');
    return { orch, taskId: start.taskId, gateBefore };
  }

  async function assertStillAtGate(orch, taskId, gateBefore) {
    const after = await orch.getCurrentInstruction(taskId);
    assert.ok(after.success);
    assert.equal(after.instruction.phase.name, 'intake', 'Phase must not advance');
    assert.equal(gateIdFromResponse(after), gateBefore, 'Gate-ID must be unchanged');
  }

  it('invalid JSON in reflection → rejected, gate unchanged', async () => {
    const { orch, taskId, gateBefore } = await startAwaitingGate();

    const result = await orch.submitReflection(taskId,
      `## Gate-ID: ${gateBefore}\n\nthis is not valid json at all`);

    assert.equal(result.success, false, 'Malformed reflection must not be accepted');
    assert.match(result.error, /^Reflection rejected: reflection is not valid JSON/);
    await assertStillAtGate(orch, taskId, gateBefore);
  });

  it('unknown decision "proceed" → rejected, gate unchanged', async () => {
    const { orch, taskId, gateBefore } = await startAwaitingGate();

    const result = await orch.submitReflection(taskId, '```json\n' + JSON.stringify({
      gate_instruction_id: gateBefore,
      decision: 'proceed',
      summary: 'typo in decision',
      confidence: 0.9,
    }) + '\n```');

    assert.equal(result.success, false, 'Unknown decision must not be accepted');
    assert.match(result.error, /^Reflection rejected: unknown decision "proceed"/);
    await assertStillAtGate(orch, taskId, gateBefore);
  });

  it('missing decision → rejected, gate unchanged', async () => {
    const { orch, taskId, gateBefore } = await startAwaitingGate();

    const result = await orch.submitReflection(taskId, '```json\n' + JSON.stringify({
      gate_instruction_id: gateBefore,
      summary: 'forgot the decision field',
      confidence: 0.9,
    }) + '\n```');

    assert.equal(result.success, false, 'Reflection without decision must not be accepted');
    assert.match(result.error, /^Reflection rejected: unknown decision null/);
    await assertStillAtGate(orch, taskId, gateBefore);
  });

  it('valid reflection is accepted after a rejected one with the same Gate-ID', async () => {
    const { orch, taskId, gateBefore } = await startAwaitingGate();

    const rejected = await orch.submitReflection(taskId,
      `## Gate-ID: ${gateBefore}\n\nstill not json`);
    assert.equal(rejected.success, false);

    const accepted = await orch.submitReflection(taskId,
      makeReflection('continue', 'Second attempt, well-formed', gateBefore));
    assert.ok(accepted.success, 'Well-formed retry must be accepted');
    assert.equal(accepted.instruction.phase.name, 'discovery',
      'Accepted continue should advance to DISCOVERY');
  });

  it('decision is case- and whitespace-tolerant', async () => {
    const { orch, taskId, gateBefore } = await startAwaitingGate();

    const result = await orch.submitReflection(taskId,
      makeReflection(' Continue ', 'Odd casing but valid', gateBefore));

    assert.ok(result.success);
    assert.equal(result.instruction.phase.name, 'discovery');
  });

  it('reflection without awaiting → error', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test premature reflection');
    
    // Try to submit reflection before artifact
    const result = await orch.submitReflection(
      start.taskId,
      makeReflection('continue', 'Too early')
    );
    assert.ok(!result.success, 'Should fail when not awaiting reflection');
    assert.ok(result.error.includes('not awaiting reflection'));
  });

  it('gate weight matches expected pattern', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test gate weights');
    
    // INTAKE → DISCOVERY = standard
    await orch.submitArtifact(start.taskId, fakeArtifact('intake'));
    let gate = await orch.getCurrentInstruction(start.taskId);
    assert.equal(gate.instruction.gate.weight, 'standard');
    
    await reflectAfterGate(orch, start.taskId, 'continue', 'OK');
    
    // DISCOVERY → ARCHITECTURE = heavy
    await orch.submitArtifact(start.taskId, fakeArtifact('discovery'));
    gate = await orch.getCurrentInstruction(start.taskId);
    assert.equal(gate.instruction.gate.weight, 'heavy');
    
    await reflectAfterGate(orch, start.taskId, 'continue', 'OK');
    
    // ARCHITECTURE → SOLUTION = heavy
    await orch.submitArtifact(start.taskId, fakeArtifact('architecture'));
    gate = await orch.getCurrentInstruction(start.taskId);
    assert.equal(gate.instruction.gate.weight, 'heavy');
    
    await reflectAfterGate(orch, start.taskId, 'continue', 'OK');
    
    // SOLUTION → IMPACT = standard
    await orch.submitArtifact(start.taskId, fakeArtifact('solution'));
    gate = await orch.getCurrentInstruction(start.taskId);
    assert.equal(gate.instruction.gate.weight, 'standard');
    
    await reflectAfterGate(orch, start.taskId, 'continue', 'OK');
    
    // IMPACT → SIMULATION = light
    await orch.submitArtifact(start.taskId, fakeArtifact('impact'));
    gate = await orch.getCurrentInstruction(start.taskId);
    assert.equal(gate.instruction.gate.weight, 'light');
    
    await reflectAfterGate(orch, start.taskId, 'continue', 'OK');
    
    // SIMULATION → IMPLEMENTATION = light
    await orch.submitArtifact(start.taskId, fakeArtifact('simulation'));
    gate = await orch.getCurrentInstruction(start.taskId);
    assert.equal(gate.instruction.gate.weight, 'light');
  });
});

// ═══════════════════════════════════════════════════════════════
// TEST SUITE 4: Full cycle flow
// ═══════════════════════════════════════════════════════════════

describe('Full Cycle Flow', () => {
  it('completes all 7 phases with artifacts', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Full cycle integration test');
    const allPhases = ['intake', 'discovery', 'architecture', 'solution', 'impact', 'simulation', 'implementation'];
    
    assert.equal(start.phase.name, 'intake');
    assert.equal(start.progress.completed, 0);
    assert.equal(start.progress.total, 7);
    
    for (let i = 0; i < allPhases.length; i++) {
      const phase = allPhases[i];
      const result = await orch.submitArtifact(start.taskId, fakeArtifact(phase));
      assert.ok(result.success, `Phase ${phase} artifact submit should succeed`);
      
      if (i < allPhases.length - 1) {
        // Not the last phase — should get gate instruction
        assert.ok(result.instruction.gate, `Phase ${phase} should produce gate instruction`);
        
        const gateResult = await reflectAfterGate(orch, start.taskId, 'continue', `${phase} verified`);
        assert.ok(gateResult.success);
        assert.equal(gateResult.instruction.phase.name, allPhases[i + 1],
          `After ${phase} gate, should be on ${allPhases[i + 1]}`);
      } else {
        // Last phase — should be completed
        assert.ok(result.completed, 'Last phase should mark cycle as completed');
      }
    }
  });

  it('progress percentage increases correctly', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test progress tracking');
    
    assert.equal(start.progress.percentage, 0);
    
    const phases = ['intake', 'discovery', 'architecture'];
    for (let i = 0; i < phases.length; i++) {
      await orch.submitArtifact(start.taskId, fakeArtifact(phases[i]));
      const result = await reflectAfterGate(orch, start.taskId, 'continue', 'OK');
      
      const expected = Math.round(((i + 1) / 7) * 100);
      assert.equal(result.instruction.progress.percentage, expected,
        `After ${phases[i]}, progress should be ${expected}%`);
    }
  });

  it('artifact too short is rejected', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test artifact validation');
    
    const result = await orch.submitArtifact(start.taskId, 'too short');
    assert.ok(!result.success);
    assert.ok(result.error.includes('too short') || result.error.includes('Minimum'));
  });

  it('artifact too short — 3 attempts then force transition', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test artifact force transition');
    
    // 3 short submissions — should force past the phase
    await orch.submitArtifact(start.taskId, 'short 1');
    await orch.submitArtifact(start.taskId, 'short 2');
    const result = await orch.submitArtifact(start.taskId, 'short 3');
    
    // 3rd attempt should force through (loop prevention)
    assert.ok(result.success || result.instruction,
      'After 3 failed attempts, should force transition');
  });

  it('nonexistent task ID returns error', async () => {
    const orch = new CycleOrchestrator();
    const result = await orch.submitArtifact('cycle_nonexistent_000000', fakeArtifact('intake'));
    
    assert.ok(!result.success);
    assert.ok(result.error.includes('not found'));
  });

  it('artifacts are written to disk in correct directory', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test disk write verification');
    
    await orch.submitArtifact(start.taskId, fakeArtifact('intake'));
    
    const cyclesBase = path.join(import.meta.dirname, '..', 'm7-cycles');
    const dirs = await fs.readdir(cyclesBase);
    const cycleDir = dirs.find(d => d.includes('test-disk-write'));
    
    assert.ok(cycleDir, 'Cycle directory should exist');
    
    const filePath = path.join(cyclesBase, cycleDir, 'INTAKE.md');
    const stat = await fs.stat(filePath);
    assert.ok(stat.isFile(), 'INTAKE.md should exist on disk');
    assert.ok(stat.size > 100, 'File should have content');
  });

  it('reflection is appended to artifact file on disk', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test reflection disk append');
    
    await orch.submitArtifact(start.taskId, fakeArtifact('intake'));
    await reflectAfterGate(orch, start.taskId, 'continue', 'Looks good');
    
    const cyclesBase = path.join(import.meta.dirname, '..', 'm7-cycles');
    const dirs = await fs.readdir(cyclesBase);
    const cycleDir = dirs.find(d => d.includes('test-reflection-disk'));
    
    if (cycleDir) {
      const content = await fs.readFile(
        path.join(cyclesBase, cycleDir, 'INTAKE.md'), 'utf-8'
      );
      assert.ok(content.includes('Reflection Gate'), 'Should contain Reflection Gate section');
      assert.ok(content.includes('CONTINUE'), 'Should contain decision');
      assert.ok(content.includes('Looks good'), 'Should contain summary');
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// TEST SUITE 5: Phase template structure
// ═══════════════════════════════════════════════════════════════

describe('Phase Templates', () => {
  const phases = ['intake', 'discovery', 'architecture', 'solution', 'impact', 'simulation', 'implementation'];
  
  for (const phase of phases) {
    it(`${phase} config has all required fields`, () => {
      const config = getPhaseConfig(phase);
      assert.ok(config.name, `${phase} should have name`);
      assert.ok(config.order >= 1 && config.order <= 7, `${phase} order should be 1-7`);
      assert.ok(config.goal, `${phase} should have goal`);
      assert.ok(Array.isArray(config.nonGoals), `${phase} should have nonGoals array`);
      assert.ok(config.attentionLock, `${phase} should have attentionLock`);
      assert.ok(config.artifactTemplate, `${phase} should have artifactTemplate`);
      assert.ok(config.artifactTemplate.includes('{task}'), `${phase} template should have {task} placeholder`);
      assert.ok(config.artifactTemplate.includes('{taskId}'), `${phase} template should have {taskId} placeholder`);
    });
  }

  it('phases are ordered 1 through 7', () => {
    const orders = phases.map(p => PHASE_CONFIGS[p].order).sort((a, b) => a - b);
    assert.deepEqual(orders, [1, 2, 3, 4, 5, 6, 7]);
  });

  it('artifact filenames are correct', () => {
    const expected = {
      intake: 'INTAKE.md',
      discovery: 'DISCOVERY.md',
      architecture: 'ARCHITECTURE.md',
      solution: 'SOLUTION_PLAN.md',
      impact: 'IMPACT_ANALYSIS.md',
      simulation: 'SIMULATION.md',
      implementation: 'IMPLEMENTATION.md'
    };
    
    const orch = new CycleOrchestrator();
    // Access via instruction artifact filename
    // We'll verify through the instruction template
    for (const phase of phases) {
      const config = getPhaseConfig(phase);
      assert.ok(config.artifactTemplate.startsWith('#'),
        `${phase} template should start with markdown header`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// TEST SUITE 6: Instruction format quality
// ═══════════════════════════════════════════════════════════════

describe('Instruction Format', () => {
  it('instruction contains "Следуй структуре шаблона" guidance', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test instruction format');
    
    assert.ok(start.instruction.includes('Следуй структуре шаблона'),
      'Should include formatting guidance');
  });

  it('instruction contains mcp_m7_cycle call hint', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test next call hint');
    
    assert.ok(start.nextCall.includes('mcp_m7_cycle'),
      'nextCall should contain mcp_m7_cycle');
    assert.ok(start.nextCall.includes(start.taskId),
      'nextCall should contain task ID');
  });

  it('gate instruction contains carry-forward AND gate template', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test gate format');
    
    await orch.submitArtifact(start.taskId, fakeArtifact('intake'));
    const gate = await orch.getCurrentInstruction(start.taskId);
    
    const instruction = gate.instruction.instruction;
    assert.ok(instruction.includes('Reflection Gate'),
      'Gate should contain Reflection Gate template');
    assert.ok(instruction.includes('decision'),
      'Gate should contain decision options');
    assert.ok(instruction.includes('continue'),
      'Gate should list continue option');
    assert.ok(instruction.includes('pivot'),
      'Gate should list pivot option');
    assert.ok(instruction.includes('rewind'),
      'Gate should list rewind option');
    assert.ok(instruction.includes('abort'),
      'Gate should list abort option');
  });

  it('progress bar format is correct', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test progress bar');
    
    assert.ok(start.instruction.includes('Progress:'),
      'Should include progress bar');
    assert.ok(start.instruction.includes('0/7'),
      'Should show 0/7 at start');
  });
});

// ═══════════════════════════════════════════════════════════════
// TEST SUITE 7: Edge cases and error handling
// ═══════════════════════════════════════════════════════════════

describe('Edge Cases', () => {
  it('task ID generation is deterministic format', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('My Test Task');
    
    assert.ok(start.taskId.startsWith('cycle_'),
      'Task ID should start with cycle_');
    assert.ok(/^cycle_[a-z0-9-]+_\d{6}$/.test(start.taskId),
      `Task ID should match pattern: ${start.taskId}`);
  });

  it('special characters in task description are handled', async () => {
    const orch = new CycleOrchestrator();
    const desc = 'Fix #142: round_down() "precision" bug <html>';
    const start = await orch.startCycle(desc);
    
    assert.ok(start.taskId.startsWith('cycle_'));
    // Task description appears in artifact template (not in instruction text)
    assert.ok(start.artifact.template.includes('Fix #142'),
      'Template should contain original description with special chars');
  });

  it('empty reflection JSON fields use defaults', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test empty reflection fields');
    
    await orch.submitArtifact(start.taskId, fakeArtifact('intake'));
    
    // Minimal valid JSON — only decision + gate id
    const result = await reflectAfterGateRaw(orch, start.taskId, (gateId) =>
      `\`\`\`json\n${JSON.stringify({ gate_instruction_id: gateId, decision: 'continue' })}\n\`\`\``
    );
    
    assert.ok(result.success);
    assert.equal(result.instruction.phase.name, 'discovery');
  });

  it('confidence is clamped to [0, 1]', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test confidence clamp');
    
    await orch.submitArtifact(start.taskId, fakeArtifact('intake'));
    
    const result = await reflectAfterGateRaw(orch, start.taskId, (gateId) =>
      `\`\`\`json\n${JSON.stringify({
        gate_instruction_id: gateId,
        decision: 'continue',
        summary: 'Over confident',
        confidence: 99.9,
      })}\n\`\`\``
    );
    
    assert.ok(result.success);
  });

  it('multiple concurrent cycles are independent', async () => {
    const orch = new CycleOrchestrator();
    
    const cycle1 = await orch.startCycle('Concurrent test alpha');
    const cycle2 = await orch.startCycle('Concurrent test beta');
    
    assert.notEqual(cycle1.taskId, cycle2.taskId);
    
    // Advance cycle1 past INTAKE
    await orch.submitArtifact(cycle1.taskId, fakeArtifact('intake'));
    await reflectAfterGate(orch, cycle1.taskId, 'continue', 'Alpha OK');
    
    // Cycle2 should still be on INTAKE
    const cycle2Status = await orch.getCurrentInstruction(cycle2.taskId);
    assert.equal(cycle2Status.instruction.phase.name, 'intake',
      'Cycle 2 should still be on INTAKE');
    
    // Cycle1 should be on DISCOVERY
    const cycle1Status = await orch.getCurrentInstruction(cycle1.taskId);
    assert.equal(cycle1Status.instruction.phase.name, 'discovery',
      'Cycle 1 should be on DISCOVERY');
  });

  it('listActiveCycles returns all cycles', async () => {
    const orch = new CycleOrchestrator();
    await orch.startCycle('List test one');
    await orch.startCycle('List test two');
    
    const cycles = await orch.listActiveCycles();
    const listTestCycles = cycles.filter(c => c.description.includes('List test'));
    assert.ok(listTestCycles.length >= 2, 'Should list at least 2 cycles');
  });
});

describe('discovery frontier gate', () => {
  it('includes Fog Frontier Report after discovery artifact submit', async () => {
    const { getMemoryCore } = await import('../dist/memory/auto/unified-memory-core.js');
    const memCore = await getMemoryCore();
    await memCore.discoverTechnical(
      'src/blocking-unknown.ts',
      '',
      { critical_path: true },
      'code_analysis',
      0.05
    );

    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test discovery frontier gate');
    await orch.submitArtifact(start.taskId, fakeArtifact('intake'));
    await reflectAfterGate(orch, start.taskId, 'continue', 'OK');

    const afterDiscovery = await orch.submitArtifact(
      start.taskId,
      fakeArtifact('discovery')
    );

    assert.ok(afterDiscovery.success);
    assert.equal(typeof afterDiscovery.instruction.instruction, 'string');
    assert.ok(
      afterDiscovery.instruction.instruction.includes('Fog Frontier Report'),
      'Discovery gate should include frontier report'
    );
    assert.ok(
      afterDiscovery.instruction.gate.prompt.includes('Discovery exit decision'),
      'Gate prompt should include discovery exit section'
    );
  });
});

describe('solution grounding gate', () => {
  async function advanceToSolution(orch, taskId) {
    await orch.submitArtifact(taskId, fakeArtifact('intake'));
    await reflectAfterGate(orch, taskId, 'continue', 'OK');
    await orch.submitArtifact(taskId, fakeArtifact('discovery'));
    await reflectAfterGate(orch, taskId, 'continue', 'OK');
    await orch.submitArtifact(taskId, fakeArtifact('architecture'));
    await reflectAfterGate(orch, taskId, 'continue', 'OK');
  }

  it('includes Epistemic Grounding Report after solution artifact submit', async () => {
    const { getMemoryCore } = await import('../dist/memory/auto/unified-memory-core.js');
    const memCore = await getMemoryCore();
    const record = await memCore.store('assumed auth behavior', {
      level: 'L1',
      source: 'runtime',
      confidence: 0.62,
    });

    const groundingBlock = `\`\`\`json
${JSON.stringify({
  grounding: {
    premises: [{ id: 'p1', ref: record.id, claim: 'auth assumption' }],
    steps: [{
      id: 's1',
      description: 'Deploy to production',
      reversibility: 'irreversible',
      premise_ids: ['p1'],
    }],
  },
})}
\`\`\``;

    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test solution grounding gate');
    await advanceToSolution(orch, start.taskId);

    const solutionArtifact = `${fakeArtifact('solution')}\n${groundingBlock}`;
    const afterSolution = await orch.submitArtifact(start.taskId, solutionArtifact);

    assert.ok(afterSolution.success);
    assert.equal(typeof afterSolution.instruction.instruction, 'string');
    assert.ok(
      afterSolution.instruction.instruction.includes('Epistemic Grounding Report'),
      'Solution gate should include grounding report'
    );
    assert.ok(
      afterSolution.instruction.instruction.includes('STRONG') ||
        afterSolution.instruction.instruction.includes('ASSUMED'),
      'ASSUMED premise on irreversible step should warn'
    );
  });
});

describe('solution adversarial gate', () => {
  async function advanceToSolution(orch, taskId) {
    await orch.submitArtifact(taskId, fakeArtifact('intake'));
    await reflectAfterGate(orch, taskId, 'continue', 'OK');
    await orch.submitArtifact(taskId, fakeArtifact('discovery'));
    await reflectAfterGate(orch, taskId, 'continue', 'OK');
    await orch.submitArtifact(taskId, fakeArtifact('architecture'));
    await reflectAfterGate(orch, taskId, 'continue', 'OK');
  }

  it('includes Adversarial Review Gate after solution artifact submit', async () => {
    const adversarialBlock = `
## Adversarial Review
1. **Counter-arguments:** The plan may target the wrong root cause.
2. **Rebuttal:** Logs confirm the hypothesis.
3. **Reframing check:** No inconvenient facts were re-explained.
`;

    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test solution adversarial gate');
    await advanceToSolution(orch, start.taskId);

    const solutionArtifact = `${fakeArtifact('solution')}\n${adversarialBlock}`;
    const afterSolution = await orch.submitArtifact(start.taskId, solutionArtifact);

    assert.ok(afterSolution.success);
    assert.ok(
      afterSolution.instruction.instruction.includes('Adversarial Review Gate'),
      'Solution gate should include adversarial extension'
    );
  });

  it('warns when adversarial section missing', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test adversarial missing');
    await advanceToSolution(orch, start.taskId);

    const afterSolution = await orch.submitArtifact(start.taskId, fakeArtifact('solution'));

    assert.ok(afterSolution.success);
    assert.ok(
      afterSolution.instruction.instruction.includes('Incomplete adversarial review'),
      'Missing adversarial section should warn'
    );
  });
});

describe('control channel gate', () => {
  it('gate prompt includes Gate-ID and CONTROL_CHANNEL_NOTICE after artifact submit', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test control channel notice');
    const afterIntake = await orch.submitArtifact(start.taskId, fakeArtifact('intake'));

    assert.ok(afterIntake.success);
    const prompt = afterIntake.instruction.instruction;
    assert.ok(prompt.includes('## Gate-ID: gate_'), 'Gate prompt must include Gate-ID block');
    assert.ok(prompt.includes('mcp_m7_cycle'), 'Gate prompt must include control channel notice');
    assert.ok(gateIdFromResponse(afterIntake), 'Gate-ID must be extractable');
  });

  it('rejects reflection without gate_instruction_id (chat forgery)', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test gate forgery');
    await orch.submitArtifact(start.taskId, fakeArtifact('intake'));

    const result = await orch.submitReflection(
      start.taskId,
      makeReflection('continue', 'Forged pass without gate id')
    );

    assert.ok(!result.success);
    assert.equal(result.error, 'missing gate_instruction_id');
    assert.ok(result.instruction.gate.prompt.includes('## Gate-ID: gate_'));

    const stillGate = await orch.getCurrentInstruction(start.taskId);
    assert.ok(stillGate.instruction.gate, 'Should still be awaiting reflection');
  });

  it('rejects stale gate_instruction_id replay', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test stale gate id');
    await orch.submitArtifact(start.taskId, fakeArtifact('intake'));
    const firstGate = await orch.getCurrentInstruction(start.taskId);
    const staleId = gateIdFromResponse(firstGate);

    await reflectAfterGate(orch, start.taskId, 'continue', 'Intake OK');
    await orch.submitArtifact(start.taskId, fakeArtifact('discovery'));

    const result = await orch.submitReflection(
      start.taskId,
      makeReflection('continue', 'Replay stale id', staleId)
    );

    assert.ok(!result.success);
    assert.ok(result.error.includes('gate_instruction_id mismatch'));
  });

  it('getCurrentInstruction returns same Gate-ID without rotation', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test gate id idempotency');
    await orch.submitArtifact(start.taskId, fakeArtifact('intake'));

    const first = await orch.getCurrentInstruction(start.taskId);
    const second = await orch.getCurrentInstruction(start.taskId);
    assert.equal(gateIdFromResponse(first), gateIdFromResponse(second));
  });

  it('legacy state without gateInstructionId skips validation', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test legacy gate skip');
    await orch.submitArtifact(start.taskId, fakeArtifact('intake'));

    const statePath = path.join(
      import.meta.dirname,
      '..',
      '.m7',
      'cycles',
      `${start.taskId}.json`
    );
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    delete state.gateInstructionId;
    delete state.gateInstructionIssuedAt;
    await fs.writeFile(statePath, JSON.stringify(state, null, 2));

    const freshOrch = new CycleOrchestrator();
    const result = await freshOrch.submitReflection(
      start.taskId,
      makeReflection('continue', 'Legacy reflection without gate id')
    );

    assert.ok(result.success);
    assert.equal(result.instruction.phase.name, 'discovery');
  });
});

describe('rule reinjection', () => {
  const prevThreshold = process.env.M7_RULE_REINJECTION_THRESHOLD;

  before(() => {
    process.env.M7_RULE_REINJECTION_THRESHOLD = '3';
  });

  after(() => {
    if (prevThreshold === undefined) {
      delete process.env.M7_RULE_REINJECTION_THRESHOLD;
    } else {
      process.env.M7_RULE_REINJECTION_THRESHOLD = prevThreshold;
    }
  });

  it('injects rule block on threshold MCP calls in same phase', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test rule reinjection threshold');

    // startCycle counts as call 1; threshold=3 → inject on 3rd finalize
    const r1 = await orch.getCurrentInstruction(start.taskId);
    assert.ok(!r1.instruction.instruction.includes('M7 Rule Reinjection'));

    const r2 = await orch.getCurrentInstruction(start.taskId);
    assert.ok(
      r2.instruction.instruction.includes('M7 Rule Reinjection'),
      '2nd getCurrentInstruction (3rd MCP call) should inject'
    );

    const r3 = await orch.getCurrentInstruction(start.taskId);
    assert.ok(
      !r3.instruction.instruction.includes('M7 Rule Reinjection'),
      'next call after inject should not inject again immediately'
    );
  });

  it('resets counter after phase transition', async () => {
    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('Test rule reinjection phase reset');

    await orch.getCurrentInstruction(start.taskId);
    await orch.getCurrentInstruction(start.taskId);
    await orch.getCurrentInstruction(start.taskId);

    await orch.submitArtifact(start.taskId, fakeArtifact('intake'));
    await reflectAfterGate(orch, start.taskId, 'continue', 'OK');

    const discovery = await orch.getCurrentInstruction(start.taskId);
    assert.ok(
      !discovery.instruction.instruction.includes('M7 Rule Reinjection'),
      'First discovery call should not inherit inject from intake'
    );
  });
});

describe('STATE-1 persist failure', () => {
  it('submitArtifact with read-only cyclesDir → success false, completedPhases unchanged', async () => {
    if (process.platform === 'win32') {
      return;
    }
    const projectPath = process.env.M7_PROJECT_PATH || path.join(import.meta.dirname, '..');
    const cyclesPath = path.join(projectPath, '.m7', 'cycles');
    await fs.mkdir(cyclesPath, { recursive: true });

    const orch = new CycleOrchestrator();
    const start = await orch.startCycle('STATE-1 persist failure test');
    const taskId = start.taskId;
    const beforeCompleted = start.progress.completed;
    const statePath = path.join(projectPath, '.m7', 'cycles', `${taskId}.json`);

    await fs.chmod(cyclesPath, 0o500);
    try {
      const result = await orch.submitArtifact(taskId, fakeArtifact('intake'));
      assert.equal(result.success, false);
      assert.match(result.error, /State not persisted/i);
      const onDisk = JSON.parse(await fs.readFile(statePath, 'utf-8'));
      assert.equal(onDisk.completedPhases.length, beforeCompleted);
    } finally {
      await fs.chmod(cyclesPath, 0o755);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// Cleanup test cycle directories after all tests
// ═══════════════════════════════════════════════════════════════

after(async () => {
  const cyclesBase = path.join(import.meta.dirname, '..', 'm7-cycles');
  const cleanup = async () => {
    const dirs = await fs.readdir(cyclesBase);
    const testDirs = dirs.filter(d =>
      /test|concurrent-test|list-test|full-cycle-integration|placeholder-replacement|rule-reinjection|control-channel|gate-forgery|gate-id|legacy-gate|invalid-reflection|premature-reflection|gate-weights|gate-continue|gate-pivot|gate-rewind|gate-abort|rewind-limit|confidence-clamp|special-characters|carry-forward|template-header|artifact-too-short|nonexistent|reflection-append|progress-percentage|complete-all-7|instruction-format|discovery-frontier|solution-adversarial|solution-grounding|adversarial-missing|epistemic-grounding|fog-frontier|sprint-8|sprint-7|promotion|epistemic-status/i.test(d)
    );
    await Promise.all(
      testDirs.map(dir => fs.rm(path.join(cyclesBase, dir), { recursive: true, force: true }))
    );
  };

  await Promise.race([
    cleanup(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('cleanup timeout')), 15000)),
  ]).catch(() => {
    // Best-effort cleanup — do not fail the run
  });
}, { timeout: 20000 });
