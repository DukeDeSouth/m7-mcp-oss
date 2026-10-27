/**
 * Safety MCP Tool — mcp_m7_safety_verify
 *
 * Exposes the heterogeneous safety pipeline as an MCP tool.
 * Actions: scan_input | scan_output | full_check | verify_intent | catalog_stats
 */

import { z } from 'zod';
import { getSafetyEngine } from '../safety/index.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('[safetyTool]');

const SafetySchema = z.object({
  action: z.enum(['scan_input', 'scan_output', 'full_check', 'verify_intent', 'catalog_stats']),
  text: z.string().optional(),
  input: z.string().optional(),
  output: z.string().optional(),
});

function makeResponse(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

export const safetyTool = {
  name: 'mcp_m7_safety_verify',
  description: 'Safety pipeline: detect jailbreak patterns, verify intent, check outputs. Actions: scan_input | scan_output | full_check | verify_intent | catalog_stats',
  inputSchema: {
    type: 'object' as const,
    properties: {
      action: {
        type: 'string',
        enum: ['scan_input', 'scan_output', 'full_check', 'verify_intent', 'catalog_stats'],
        description: 'Action: scan_input (TRAP check input), scan_output (TRAP check output), full_check (input+output+intent), verify_intent (intent analysis only), catalog_stats (TRAP catalog info)',
      },
      text: {
        type: 'string',
        description: 'Text to analyze (for scan_input, scan_output, verify_intent)',
      },
      input: {
        type: 'string',
        description: 'User input text (for full_check)',
      },
      output: {
        type: 'string',
        description: 'Model output text (for full_check, scan_output)',
      },
    },
    required: ['action'],
  },

  async handler(args: Record<string, any>) {
    const parsed = SafetySchema.safeParse(args);
    if (!parsed.success) {
      return makeResponse(`❌ Invalid arguments: ${parsed.error.message}`);
    }

    const { action, text, input, output } = parsed.data;
    const engine = getSafetyEngine();

    try {
      switch (action) {
        case 'scan_input': {
          if (!text) return makeResponse('❌ "text" is required for scan_input');
          const result = engine.checkInput(text);
          return makeResponse(formatPipelineResult('Input Scan', result));
        }

        case 'scan_output': {
          const target = text || output;
          if (!target) return makeResponse('❌ "text" or "output" is required for scan_output');
          const result = engine.checkOutput(target);
          return makeResponse(formatPipelineResult('Output Scan', result));
        }

        case 'full_check': {
          const inputText = input || text;
          if (!inputText) return makeResponse('❌ "input" or "text" is required for full_check');
          const result = engine.fullCheck(inputText, output);
          let out = formatPipelineResult('Input', result.input);
          if (result.output) {
            out += '\n\n' + formatPipelineResult('Output', result.output);
          }
          return makeResponse(out);
        }

        case 'verify_intent': {
          if (!text) return makeResponse('❌ "text" is required for verify_intent');
          const result = engine.verifyIntent(text);
          return makeResponse(formatVerification(result));
        }

        case 'catalog_stats': {
          const stats = engine.getStats();
          return makeResponse(formatStats(stats));
        }

        default:
          return makeResponse(`❌ Unknown action: ${action}`);
      }
    } catch (err: any) {
      log.error(`Safety tool error: ${err.message}`);
      return makeResponse(`❌ Error: ${err.message}`);
    }
  },
};

function formatPipelineResult(label: string, result: import('../safety/types.js').PipelineResult): string {
  const icon = result.action === 'block' ? '🚫' : result.action === 'warn' ? '⚠️' : '✅';
  const lines: string[] = [
    `## ${icon} ${label}: ${result.action.toUpperCase()}`,
    '',
  ];

  if (result.metadata.blockedBy) {
    lines.push(`**Blocked by:** ${result.metadata.blockedBy}`);
  }
  if (result.stage) {
    lines.push(`**Stage:** ${result.stage}`);
  }

  lines.push(`**TRAPs evaluated:** ${result.metadata.trapsEvaluated}`);
  lines.push(`**Intent extracted:** ${result.metadata.intentExtracted}`);
  lines.push(`**Time:** ${result.metadata.totalTimeMs}ms`);

  if (result.details && 'verdicts' in result.details) {
    const triggered = result.details.verdicts.filter((v: any) => v.triggered);
    if (triggered.length > 0) {
      lines.push('', '### Triggered TRAPs:');
      for (const v of triggered) {
        lines.push(`- **${v.trapId}** [${v.severity}/${v.action}] — ${v.evidence.join(', ')}`);
      }
    }
  }

  if (result.details && 'violations' in result.details) {
    const violations = result.details.violations.filter((v: any) => v.violated);
    if (violations.length > 0) {
      lines.push('', '### Safety Rule Violations:');
      for (const v of violations) {
        lines.push(`- **${v.ruleId}**: ${v.reason}`);
      }
    }
  }

  return lines.join('\n');
}

function formatVerification(result: import('../safety/types.js').VerificationResult): string {
  const icon = result.action === 'block' ? '🚫' : result.action === 'warn' ? '⚠️' : '✅';
  const lines: string[] = [
    `## ${icon} Intent Verification: ${result.passed ? 'PASSED' : 'FAILED'}`,
    '',
    `**Action:** ${result.action}`,
    `**Time:** ${result.verificationTimeMs}ms`,
  ];

  if (result.violations.length > 0) {
    lines.push('', '### Violations:');
    for (const v of result.violations) {
      lines.push(`- **${v.ruleId}**: ${v.reason}`);
    }
  }

  return lines.join('\n');
}

function formatStats(stats: ReturnType<import('../safety/index.js').SafetyEngine['getStats']>): string {
  const lines: string[] = [
    '## 📊 TRAP Catalog Statistics',
    '',
    `**Total TRAPs:** ${stats.totalTraps}`,
    `**Input TRAPs:** ${stats.inputTraps}`,
    `**Output TRAPs:** ${stats.outputTraps}`,
    '',
    '### By Class:',
    ...Object.entries(stats.byClass).map(([cls, n]) => `- ${cls}: ${n}`),
    '',
    '### By Severity:',
    ...Object.entries(stats.bySeverity).map(([sev, n]) => `- ${sev}: ${n}`),
  ];

  return lines.join('\n');
}
