/**
 * M7 Cycle Tool
 * 
 * MCP tool for explicit M7 cycle orchestration.
 * This is the main interface for the "MCP as Orchestrator" pattern.
 */

import { createLogger } from '../utils/logger.js';
import { z } from 'zod';
import { getCycleOrchestrator } from '../orchestrator/cycleOrchestrator.js';
import { CycleInstruction, CycleStatus, PhaseType } from '../orchestrator/types/cycle.js';

const log = createLogger('[cycleTool]');

const CycleRequestSchema = z.object({
  task_description: z.string().optional(),
  task_id: z.string().optional(),
  artifact_content: z.string().optional(),
  summary: z.string().optional()
});

export const cycleTool = {
  name: 'mcp_m7_cycle',
  description: 'Start or continue M7 cycle with explicit phase instructions. Use for structured task development through all 7 phases: intake → discovery → architecture → solution → impact → simulation → implementation.',
  inputSchema: {
    type: 'object',
    properties: {
      task_description: {
        type: 'string',
        description: 'Task description (for starting new cycle)'
      },
      task_id: {
        type: 'string',
        description: 'Existing cycle ID (for continuing)'
      },
      artifact_content: {
        type: 'string',
        description: 'Content of completed artifact'
      },
      summary: {
        type: 'string',
        description: 'Short 4-5 word summary for CYCLE_REGISTRY (after cycle completion)'
      }
    }
  },
  handler: async (request: any) => {
    const params = CycleRequestSchema.parse(request);
    const { task_description, task_id, artifact_content, summary } = params;
    
    const orchestrator = getCycleOrchestrator();
    
    // Case 0: Register summary for completed cycle
    if (task_id && summary) {
      log.debug(`Registering summary for: ${task_id}`);
      const result = await orchestrator.registerSummary(task_id, summary);
      if (!result.success) {
        return {
          content: [{
            type: 'text',
            text: `# Error\n\n${result.error}`
          }],
          isError: true
        };
      }
      return {
        content: [{
          type: 'text',
          text: `# Summary Registered\n\n**Task:** \`${task_id}\`\n**Summary:** ${summary}\n\nEntry added to CYCLE_REGISTRY.md`
        }]
      };
    }
    
    // Case 1: Start new cycle
    if (task_description && !task_id) {
      log.debug(`Starting new cycle: ${task_description.substring(0, 50)}...`);

      try {
        const instruction = await orchestrator.startCycle(task_description);
        return {
          content: [{
            type: 'text',
            text: formatCycleResponse(instruction)
          }]
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{
            type: 'text',
            text: `# ❌ M7 Cycle Error\n\nFailed to start cycle: ${msg}`
          }],
          isError: true
        };
      }
    }
    
    // Case 2: Submit artifact or reflection
    if (task_id && artifact_content) {
      // Check if cycle is awaiting reflection (v2 gate protocol)
      const currentState = await orchestrator.getCurrentInstruction(task_id);
      const isReflectionExpected = currentState.success && 
        currentState.instruction?.gate !== undefined;
      
      let result;
      if (isReflectionExpected) {
        log.debug(`Submitting reflection for: ${task_id}`);
        result = await orchestrator.submitReflection(task_id, artifact_content);
      } else {
        log.debug(`Submitting artifact for: ${task_id}`);
        result = await orchestrator.submitArtifact(task_id, artifact_content);
      }
      
      if (!result.success) {
        return {
          content: [{
            type: 'text',
            text: `# ❌ M7 Cycle Error\n\n${result.error}`
          }],
          isError: true
        };
      }
      
      if (result.completed) {
        const status: CycleStatus = result.cycleStatus ?? 'completed';
        const stoppedAt: PhaseType = result.instruction?.phase.name ?? 'implementation';
        const completedCount = result.instruction?.progress.completed ?? 7;
        return {
          content: [{
            type: 'text',
            text: formatCompletionResponse(task_id, status, stoppedAt, completedCount)
          }]
        };
      }
      
      return {
        content: [{
          type: 'text',
          text: formatCycleResponse(result.instruction!)
        }]
      };
    }
    
    // Case 3: Get current instruction (no artifact)
    if (task_id && !artifact_content) {
      log.debug(`Getting current instruction for: ${task_id}`);
      
      const result = await orchestrator.getCurrentInstruction(task_id);
      
      if (!result.success) {
        return {
          content: [{
            type: 'text',
            text: `# ❌ M7 Cycle Error\n\n${result.error}`
          }],
          isError: true
        };
      }
      
      return {
        content: [{
          type: 'text',
          text: formatCycleResponse(result.instruction!)
        }]
      };
    }
    
    // Case 4: Invalid request - show usage
    return {
      content: [{
        type: 'text',
        text: formatUsageHelp()
      }],
      isError: true
    };
  }
};

export function formatCycleResponse(instruction: CycleInstruction): string {
  const { taskId, phase, progress, artifact, gate } = instruction;
  
  // v2: If gate is present, show gate-specific response
  const gateSection = gate ? `

---

## 🚦 Reflection Gate (${gate.weight.toUpperCase()})

${gate.prompt}
` : '';
  
  return `# 🎯 M7 CYCLE: \`${taskId}\`

## CURRENT PHASE: ${phase.name.toUpperCase()} (${phase.order}/7)

### Goal
${phase.goal}

### Non-Goals
${phase.nonGoals.map((ng: string) => `- ❌ ${ng}`).join('\n')}

### Attention Lock
${phase.attentionLock}

---

## Artifact Template: ${artifact.filename}

\`\`\`markdown
${artifact.template}
\`\`\`

---

## ▶ INSTRUCTION

${instruction.instruction}
${gateSection}
---

## Progress: ${generateVisualProgress(progress.completed, progress.total)}
`;
}

export function formatCompletionResponse(
  taskId: string,
  status: CycleStatus,
  stoppedAtPhase: PhaseType,
  completedPhaseCount = 7
): string {
  if (status === 'aborted') {
    const completed = Math.min(completedPhaseCount, 7);
    return `# M7 CYCLE ABORTED

**Task ID:** \`${taskId}\`

## Progress: ${generateVisualProgress(completed, 7)}

---

The cycle was **aborted** at phase **${stoppedAtPhase.toUpperCase()}** (${stoppedAtPhase}).

No further artifacts or reflection gates will be accepted for this task ID.

---

## OPTIONAL: Register Summary

If useful for your registry, you may still register a short summary:

\`\`\`
mcp_m7_cycle task_id="${taskId}" summary="your 4-5 word summary"
\`\`\`
`;
  }

  return `# M7 CYCLE COMPLETE

**Task ID:** \`${taskId}\`

## Progress: ${generateVisualProgress(7, 7)}

---

All 7 phases done.

---

## REQUIRED: Register Summary

Generate a **4-5 word summary** of what this cycle accomplished.
The summary should tell a future AI which folder to look in for what solution.

**Rules:**
- 4-5 words maximum
- Action-oriented (Fix, Add, Implement, Research, Refactor...)
- Include the key subject (dashboard, login, encryption, memory...)
- No IDs, no dates, no filler words

**Examples:**
- "Fix login rounded corners"
- "BTC cashout reserve rollback"
- "M7 memory bridge integration"
- "VSCodeVim undo stack fix"

**Call now:**
\`\`\`
mcp_m7_cycle task_id="${taskId}" summary="your 4-5 word summary"
\`\`\`
`;
}

function formatUsageHelp(): string {
  return `# ❌ M7 Cycle: Invalid Request

## Usage

### Start new cycle:
\`\`\`
mcp_m7_cycle task_description="описание задачи"
\`\`\`

### Continue cycle (submit artifact):
\`\`\`
mcp_m7_cycle task_id="cycle_xxx" artifact_content="содержимое файла"
\`\`\`

### Get current instruction:
\`\`\`
mcp_m7_cycle task_id="cycle_xxx"
\`\`\`
`;
}

function generateVisualProgress(completed: number, total: number): string {
  const filled = '█'.repeat(completed * 2);
  const empty = '░'.repeat((total - completed) * 2);
  return `${filled}${empty} ${completed}/${total} (${Math.round((completed / total) * 100)}%)`;
}
